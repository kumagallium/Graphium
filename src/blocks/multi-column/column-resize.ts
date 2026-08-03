// カラム境界のドラッグで隣接 2 カラムの幅比率（width prop）を変更する拡張。
//
// 設計上の制約 2 つに合わせた作りになっている:
//
// 1. event.target ベースにできない — カラム間の gap には BlockNote のサイド
//    メニュー（ドラッグハンドル。body ポータルで描画）が重なることがあり、
//    その場合イベントの target がエディタ DOM 外になって PM の
//    handleDOMEvents には届かない。そこで document への capture リスナー +
//    座標ヒットテストで境界を判定する。
//
// 2. DOM 要素の参照を保持できない — ProseMirror は編集のたびに toDOM ベースの
//    ノード DOM を差し替えることがあり（実測でドラッグ中にも起きる）、掴んだ
//    要素への style 書き込みは捨てられる。そこでカラムは data-id で追跡し、
//    ライブプレビューは <style> 要素の CSS ルール（[data-id] セレクタ）で行う。
//    確定時も data-id で現在の DOM を引き直して PM 位置を解決する。
//
// 確定は ProseMirror トランザクション 1 回（setNodeMarkup ×2）。undo も 1 回。
// タッチは対象外（モバイル・狭幅では CSS の flex-wrap で縦積みになる）。
// メイン / SidePeek はそれぞれ独立にこのプラグインを持つ。ヒットテストは
// 自分の view.dom 配下の columnList に限定するので相互干渉しない。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("columnResize");

// 境界ヒット領域: gap（12px）の両側に少し余裕を持たせる
const HIT_RADIUS = 6;
// カラムの最小幅比率（flex-grow の下限）
const MIN_WIDTH = 0.2;
// body に付けるカーソル用クラス（app.css とペア）
const BODY_CURSOR_CLASS = "gph-col-resize-cursor";
// body に付けるドラッグ中クラス（テキスト選択の抑止。app.css とペア）
const BODY_DRAGGING_CLASS = "gph-col-resizing";

type Hit = {
  leftId: string;
  rightId: string;
  leftPx: number;
  rightPx: number;
};

/** clientX/Y がこの view 内のカラム境界（gap 帯）にあるか座標で判定する */
function hitTestBoundary(view: EditorView, x: number, y: number): Hit | null {
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
          let dragging: {
            hit: Hit;
            startX: number;
            leftStart: number; // flex-grow 開始値
            rightStart: number;
            current: { left: number; right: number };
          } | null = null;
          // ライブプレビュー用の <style>。DOM 差し替えに耐えるよう、要素の
          // style 属性ではなく data-id セレクタの CSS ルールで幅を当てる
          let previewStyle: HTMLStyleElement | null = null;

          const setPreview = (left: number, right: number) => {
            if (!previewStyle) {
              previewStyle = document.createElement("style");
              previewStyle.setAttribute("data-gph-column-resize", "");
              document.head.appendChild(previewStyle);
            }
            if (!dragging) return;
            previewStyle.textContent =
              `[data-node-type="column"][data-id="${CSS.escape(dragging.hit.leftId)}"]{flex-grow:${left} !important;}` +
              `[data-node-type="column"][data-id="${CSS.escape(dragging.hit.rightId)}"]{flex-grow:${right} !important;}`;
          };

          const clearPreview = () => {
            previewStyle?.remove();
            previewStyle = null;
          };

          const onHoverMove = (e: MouseEvent) => {
            if (dragging) return;
            const hit = view.editable ? hitTestBoundary(view, e.clientX, e.clientY) : null;
            document.body.classList.toggle(BODY_CURSOR_CLASS, !!hit);
          };

          const onDragMove = (e: MouseEvent) => {
            if (!dragging) return;
            const dx = e.clientX - dragging.startX;
            // ピクセル幅の増減を flex-grow 比率に換算する。
            // 2 カラム合計の grow / 合計 px = 単位 px あたりの grow
            const totalGrow = dragging.leftStart + dragging.rightStart;
            const totalPx = dragging.hit.leftPx + dragging.hit.rightPx;
            if (totalPx <= 0) return;
            const growPerPx = totalGrow / totalPx;
            let newLeft = dragging.leftStart + dx * growPerPx;
            let newRight = dragging.rightStart - dx * growPerPx;
            if (newLeft < MIN_WIDTH) {
              newRight -= MIN_WIDTH - newLeft;
              newLeft = MIN_WIDTH;
            }
            if (newRight < MIN_WIDTH) {
              newLeft -= MIN_WIDTH - newRight;
              newRight = MIN_WIDTH;
            }
            dragging.current = { left: newLeft, right: newRight };
            setPreview(newLeft, newRight);
          };

          const onDragUp = () => {
            document.removeEventListener("mousemove", onDragMove, true);
            document.removeEventListener("mouseup", onDragUp, true);
            document.body.classList.remove(BODY_DRAGGING_CLASS);
            document.body.classList.remove(BODY_CURSOR_CLASS);
            if (!dragging) {
              clearPreview();
              return;
            }
            const { hit, current } = dragging;
            dragging = null;

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
            if (!view.editable || e.button !== 0 || dragging) return;
            const hit = hitTestBoundary(view, e.clientX, e.clientY);
            if (!hit) return;

            // サイドメニューのクリック・PM の選択開始より先に境界ドラッグを取る
            e.preventDefault();
            e.stopPropagation();

            // 開始値は PM ノードの width から読む（DOM の style は差し替えで
            // 消えている可能性があるため信用しない）
            const leftPos = findColumnPosById(view, hit.leftId);
            const rightPos = findColumnPosById(view, hit.rightId);
            if (leftPos == null || rightPos == null) return;
            const leftStart = readWidthByPos(view, leftPos);
            const rightStart = readWidthByPos(view, rightPos);

            dragging = {
              hit,
              startX: e.clientX,
              leftStart,
              rightStart,
              current: { left: leftStart, right: rightStart },
            };
            document.body.classList.add(BODY_DRAGGING_CLASS);
            document.body.classList.add(BODY_CURSOR_CLASS);
            // capture: 途中の要素が mousemove を stopPropagation しても追従する
            document.addEventListener("mousemove", onDragMove, true);
            document.addEventListener("mouseup", onDragUp, true);
          };

          // capture: サイドメニュー（body ポータル）が gap に被っていても先に取る
          document.addEventListener("mousemove", onHoverMove, true);
          document.addEventListener("mousedown", onMouseDown, true);

          return {
            destroy() {
              document.removeEventListener("mousemove", onHoverMove, true);
              document.removeEventListener("mousedown", onMouseDown, true);
              document.removeEventListener("mousemove", onDragMove, true);
              document.removeEventListener("mouseup", onDragUp, true);
              document.body.classList.remove(BODY_CURSOR_CLASS);
              document.body.classList.remove(BODY_DRAGGING_CLASS);
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
