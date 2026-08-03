// カラム境界のドラッグで隣接 2 カラムの幅比率（width prop）を変更する拡張。
//
// 設計上の制約 2 つに合わせた作りになっている:
//
// 1. event.target ベースにできない — カラム間の gap には BlockNote のサイド
//    メニュー（ドラッグハンドル。body ポータルで描画）が重なることがあり、
//    その場合イベントの target がエディタ DOM 外になって PM の
//    handleDOMEvents には届かない。そこで document への capture リスナー +
//    座標ヒットテストで境界を判定する。ただし座標だけだと前面のモーダル /
//    オーバーレイ越しに背後のカラムを掴んでしまうため、elementFromPoint の
//    最前面要素が「自エディタ内 or BlockNote サイドメニュー」の場合だけ
//    ヒットを有効にする（遮蔽判定）。
//
// 2. DOM 要素の参照を保持できない — ProseMirror は編集のたびに toDOM ベースの
//    ノード DOM を差し替えることがあり（実測でドラッグ中にも起きる）、掴んだ
//    要素への style 書き込みは捨てられる。そこでカラムは data-id で追跡し、
//    ライブプレビューは <style> 要素の CSS ルール（[data-id] セレクタ）で行う。
//    確定時も data-id で現在の DOM を引き直して PM 位置を解決する。
//
// 確定は ProseMirror トランザクション 1 回（setNodeMarkup ×2）。undo も 1 回。
// 変化ゼロ（単クリック）は dispatch しない（no-op undo と dirty 化を避ける）。
// タッチは対象外（モバイル・狭幅では CSS の flex-wrap で縦積みになる）。
//
// メイン / SidePeek / Storybook はそれぞれ独立にこのプラグインを持つ。
// ヒットテストは自分の view.dom 配下の columnList に限定するが、body の
// カーソルクラスは全インスタンス共有の資源なので、モジュールスコープの
// 集合（hoverClaims）の論理和で付け外しする（last-write-wins の toggle だと
// 後着インスタンスが他方のホバー表示を打ち消す）。ドラッグはモジュール
// スコープのロック（activeDrag）で同時 1 件に限定する。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createExtension } from "@blocknote/core";
import { COLUMN_MIN_WIDTH_PX } from "./nodes";

const pluginKey = new PluginKey("columnResize");

// 境界ヒット領域: gap（12px）の両側に少し余裕を持たせる
const HIT_RADIUS = 6;
// body に付けるカーソル用クラス（app.css とペア）
const BODY_CURSOR_CLASS = "gph-col-resize-cursor";
// body に付けるドラッグ中クラス（テキスト選択の抑止。app.css とペア）
const BODY_DRAGGING_CLASS = "gph-col-resizing";

// ── モジュールスコープの共有状態（複数エディタ間の調停） ──
// ホバー中インスタンスの集合。body クラスは集合の空/非空で決める
const hoverClaims = new Set<symbol>();
// ドラッグ中インスタンス（同時に 1 件だけ）
let activeDrag: symbol | null = null;

function syncBodyCursor() {
  document.body.classList.toggle(
    BODY_CURSOR_CLASS,
    hoverClaims.size > 0 || activeDrag !== null,
  );
}

type Hit = {
  leftId: string;
  rightId: string;
  leftPx: number;
  rightPx: number;
};

/** 最前面要素から見て、この座標でリサイズを始めてよいか（遮蔽判定 + 調停）。
 *
 * カラム内ブロックのサイドメニュー（+ / ⠿）は core の仕様で gap 上に浮かび、
 * ホバー行ではハンドルボタン（24px）が gap（12px）を完全に覆う — 実測で
 * elementFromPoint(gap 中央) はハンドルの SVG を返す。ここでリサイズが
 * mousedown を横取りすると、カラム内ブロックの並べ替え・ブロックメニューが
 * 使えなくなる（実機で報告あり）。そこで調停は「ボタンの上ではボタン優先、
 * それ以外の gap はリサイズ」とする。リサイズはメニューが浮いていない行の
 * gap（複数ブロックのカラムや高さの違うカラムでは大半）で引き続き掴める。
 *
 * それ以外の前面層（設定モーダル・overlay SidePeek 等）越しのヒットも弾く。 */
function isPointReachable(view: EditorView, x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  // サイドメニュー / ドラッグハンドルメニューの上ではボタン操作を優先する
  if (el.closest(".bn-side-menu, .bn-drag-handle-menu")) return false;
  return view.dom.contains(el);
}

/** clientX/Y がこの view 内のカラム境界（gap 帯）にあるか座標で判定する */
function hitTestBoundary(view: EditorView, x: number, y: number): Hit | null {
  // 粗い事前判定: エディタ矩形の外なら querySelectorAll を走らせない
  // （document mousemove ごとに呼ばれるため）
  const viewRect = view.dom.getBoundingClientRect();
  if (
    x < viewRect.left - HIT_RADIUS ||
    x > viewRect.right + HIT_RADIUS ||
    y < viewRect.top ||
    y > viewRect.bottom
  ) {
    return null;
  }

  const lists = view.dom.querySelectorAll<HTMLElement>('[data-node-type="columnList"]');
  for (const list of lists) {
    const listRect = list.getBoundingClientRect();
    if (y < listRect.top || y > listRect.bottom) continue;
    if (x < listRect.left || x > listRect.right) continue;
    const columns = Array.from(
      list.querySelectorAll<HTMLElement>(':scope > [data-node-type="column"]'),
    );
    for (let i = 0; i < columns.length - 1; i++) {
      const leftRect = columns[i].getBoundingClientRect();
      const rightRect = columns[i + 1].getBoundingClientRect();
      // flex-wrap で縦積み（横に隣接していない）場合は境界ドラッグの対象外
      if (rightRect.left < leftRect.right) continue;
      // 同じ行にあるか（縦積みの折返し行をまたがない）
      if (y < leftRect.top || y > leftRect.bottom) continue;
      if (x >= leftRect.right - HIT_RADIUS && x <= rightRect.left + HIT_RADIUS) {
        if (!isPointReachable(view, x, y)) return null;
        const leftId = columns[i].getAttribute("data-id");
        const rightId = columns[i + 1].getAttribute("data-id");
        if (!leftId || !rightId) return null;
        return { leftId, rightId, leftPx: leftRect.width, rightPx: rightRect.width };
      }
    }
  }
  return null;
}

/** data-id からカラムの PM ドキュメント位置を得る（DOM 差し替えに耐える） */
function findColumnPosById(view: EditorView, id: string): number | null {
  const dom = view.dom.querySelector<HTMLElement>(
    `[data-node-type="column"][data-id="${CSS.escape(id)}"]`,
  );
  if (!dom) return null;
  try {
    // posAtDOM は要素「内」の位置を返すので、resolve して column ノードまで遡る
    const inside = view.posAtDOM(dom, 0);
    const $pos = view.state.doc.resolve(inside);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === "column") {
        return $pos.before(d);
      }
    }
  } catch {
    /* DOM が既にドキュメント外の場合など */
  }
  return null;
}

/** 現在の width（flex-grow）を PM ノードから読む（DOM の style に頼らない） */
function readWidthByPos(view: EditorView, pos: number): number {
  const node = view.state.doc.nodeAt(pos);
  const w = node?.attrs?.width;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

const tiptapExt = TiptapExtension.create({
  name: "columnResize",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        view(view) {
          // このインスタンスの識別子（hoverClaims / activeDrag の調停用）
          const self = Symbol("columnResize");
          let dragging: {
            hit: Hit;
            startX: number;
            leftStart: number; // flex-grow 開始値
            rightStart: number;
            current: { left: number; right: number };
            moved: boolean;
          } | null = null;
          // ライブプレビュー用の <style>。DOM 差し替えに耐えるよう、要素の
          // style 属性ではなく data-id セレクタの CSS ルールで幅を当てる
          let previewStyle: HTMLStyleElement | null = null;

          const setPreview = (left: number, right: number) => {
            if (!dragging) return;
            if (!previewStyle) {
              previewStyle = document.createElement("style");
              previewStyle.setAttribute("data-gph-column-resize", "");
              document.head.appendChild(previewStyle);
            }
            previewStyle.textContent =
              `[data-node-type="column"][data-id="${CSS.escape(dragging.hit.leftId)}"]{flex-grow:${left} !important;}` +
              `[data-node-type="column"][data-id="${CSS.escape(dragging.hit.rightId)}"]{flex-grow:${right} !important;}`;
          };

          const clearPreview = () => {
            previewStyle?.remove();
            previewStyle = null;
          };

          const setHoverClaim = (hit: boolean) => {
            const had = hoverClaims.has(self);
            if (hit === had) return; // 状態が変わった時だけ触る（綱引き防止）
            if (hit) hoverClaims.add(self);
            else hoverClaims.delete(self);
            syncBodyCursor();
          };

          const onHoverMove = (e: MouseEvent) => {
            if (dragging || activeDrag) return; // 誰かがドラッグ中は触らない
            const hit = view.editable ? hitTestBoundary(view, e.clientX, e.clientY) : null;
            setHoverClaim(!!hit);
          };

          const onDragMove = (e: MouseEvent) => {
            if (!dragging) return;
            // mouseup を取り逃した（ウィンドウ外で離した等）場合の固着防止
            if (e.buttons === 0) {
              onDragUp();
              return;
            }
            // ドラッグ量を「隣接 2 カラムが CSS の min-width（220px）を割らない」
            // 範囲にピクセルでクランプする。grow の比率だけで下限を切ると、
            // 縮む側が min-width の床に当たった瞬間に flexbox が余剰を残りの
            // カラム全体へ比例配分し、触っていない 3 列目の幅まで動いてしまう
            // （実機で報告あり）。ピクセルで止めれば床に当たらないので、
            // 境界の両隣以外のカラムは 1px も動かない。
            const rawDx = e.clientX - dragging.startX;
            const maxShrinkLeft = Math.max(0, dragging.hit.leftPx - COLUMN_MIN_WIDTH_PX);
            const maxShrinkRight = Math.max(0, dragging.hit.rightPx - COLUMN_MIN_WIDTH_PX);
            const dx = Math.min(Math.max(rawDx, -maxShrinkLeft), maxShrinkRight);
            // ピクセル幅の増減を flex-grow 比率に換算する。
            // 2 カラム合計の grow / 合計 px = 単位 px あたりの grow
            const totalGrow = dragging.leftStart + dragging.rightStart;
            const totalPx = dragging.hit.leftPx + dragging.hit.rightPx;
            if (totalPx <= 0) return;
            const growPerPx = totalGrow / totalPx;
            const newLeft = dragging.leftStart + dx * growPerPx;
            const newRight = dragging.rightStart - dx * growPerPx;
            dragging.current = { left: newLeft, right: newRight };
            dragging.moved = true;
            setPreview(newLeft, newRight);
          };

          const teardownDrag = () => {
            document.removeEventListener("mousemove", onDragMove, true);
            document.removeEventListener("mouseup", onDragUp, true);
            window.removeEventListener("blur", onWindowBlur);
            document.body.classList.remove(BODY_DRAGGING_CLASS);
            if (activeDrag === self) activeDrag = null;
            syncBodyCursor();
          };

          // ウィンドウがフォーカスを失ったらドラッグを取り消す（確定しない）
          const onWindowBlur = () => {
            teardownDrag();
            dragging = null;
            clearPreview();
          };

          const onDragUp = () => {
            teardownDrag();
            if (!dragging) {
              clearPreview();
              return;
            }
            const { hit, current, leftStart, rightStart, moved } = dragging;
            dragging = null;

            // 変化なし（単クリック / 元の位置に戻した）なら dispatch しない
            // （no-op の undo ステップと dirty/自動保存を発生させない）
            if (!moved || (current.left === leftStart && current.right === rightStart)) {
              clearPreview();
              return;
            }

            // data-id で現在の DOM から PM 位置を引き直す（掴んだ要素は
            // ドラッグ中に差し替えられている可能性がある）
            const leftPos = findColumnPosById(view, hit.leftId);
            const rightPos = findColumnPosById(view, hit.rightId);
            if (leftPos == null || rightPos == null) {
              clearPreview();
              return;
            }

            // 1 トランザクションで両カラムの width を確定（undo 1 回で戻せる）
            const { tr, doc } = view.state;
            const leftNode = doc.nodeAt(leftPos);
            const rightNode = doc.nodeAt(rightPos);
            if (leftNode?.type.name !== "column" || rightNode?.type.name !== "column") {
              clearPreview();
              return;
            }
            tr.setNodeMarkup(leftPos, undefined, { ...leftNode.attrs, width: current.left });
            tr.setNodeMarkup(rightPos, undefined, { ...rightNode.attrs, width: current.right });
            view.dispatch(tr);
            // 確定後: renderHTML が新しい width で flex-grow を出すので
            // プレビューはもう不要（残すと以後の undo が見た目に反映されない）
            clearPreview();
          };

          const onMouseDown = (e: MouseEvent) => {
            if (!view.editable || e.button !== 0 || dragging || activeDrag) return;
            const hit = hitTestBoundary(view, e.clientX, e.clientY);
            if (!hit) return;

            // サイドメニューのクリック・PM の選択開始・他インスタンスより先に取る
            e.preventDefault();
            e.stopImmediatePropagation();

            // 開始値は PM ノードの width から読む（DOM の style は差し替えで
            // 消えている可能性があるため信用しない）
            const leftPos = findColumnPosById(view, hit.leftId);
            const rightPos = findColumnPosById(view, hit.rightId);
            if (leftPos == null || rightPos == null) return;
            const leftStart = readWidthByPos(view, leftPos);
            const rightStart = readWidthByPos(view, rightPos);

            activeDrag = self;
            setHoverClaim(false);
            dragging = {
              hit,
              startX: e.clientX,
              leftStart,
              rightStart,
              current: { left: leftStart, right: rightStart },
              moved: false,
            };
            document.body.classList.add(BODY_DRAGGING_CLASS);
            syncBodyCursor();
            // capture: 途中の要素が mousemove を stopPropagation しても追従する
            document.addEventListener("mousemove", onDragMove, true);
            document.addEventListener("mouseup", onDragUp, true);
            window.addEventListener("blur", onWindowBlur);
          };

          // capture: サイドメニュー（body ポータル）が gap に被っていても先に取る
          document.addEventListener("mousemove", onHoverMove, true);
          document.addEventListener("mousedown", onMouseDown, true);

          return {
            destroy() {
              document.removeEventListener("mousemove", onHoverMove, true);
              document.removeEventListener("mousedown", onMouseDown, true);
              teardownDrag();
              setHoverClaim(false);
              clearPreview();
              dragging = null;
            },
          };
        },
      }),
    ];
  },
});

export const columnResizeExtension = createExtension({
  key: "columnResize",
  tiptapExtensions: [tiptapExt],
});
