// ドラッグ&ドロップでのカラム生成
//
// BlockNote のドラッグハンドルでブロックを掴み、別ブロックの左右端に落とすと
// 2 カラムに、既存カラムの左右端・カラム間の gap に落とすと新しいカラムに
// なる。core (MPL-2.0) の分担は:
//   - DropCursor 拡張が縦カーソルの「描画」と computeDropPosition フックを提供
//   - SideMenu の dragstart が blocknote/html + view.dragging(move) を設定
//   - drop 時のトランザクションは core に存在しない → ここで handleDrop を実装
//
// 実装方針: ドロップの適用は純関数 applyColumnDrop によるページ JSON 変換
// （ドラッグ元の除去 → カラム構造の正規化 → wrap / カラム追加）で行い、
// editor.replaceBlocks 一発で置き換える。
//   - 1 トランザクション = undo 1 回
//   - ブロック id は JSON に載って保存されるので、PROV・ラベル・リンク・
//     メモアンカーはすべて無傷（id ベースのサイドストアが生きる）
//   - 純関数なのでユニットテストで網羅できる

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Slice } from "prosemirror-model";
import { createExtension, getNodeById } from "@blocknote/core";
import type { DropCursorOptions } from "@blocknote/core";
import { COLUMN_MIN_WIDTH_PX, COLUMN_GAP_PX } from "./nodes";

// DropCursorPosition / ComputeDropPositionContext はパッケージルートから
// export されていないため、公開されている DropCursorOptions から型導出する
type ComputeDropPosition = NonNullable<
  NonNullable<DropCursorOptions["hooks"]>["computeDropPosition"]
>;
type ComputeDropPositionContext = Parameters<ComputeDropPosition>[0];
type DropCursorPosition = NonNullable<ReturnType<ComputeDropPosition>>;

const pluginKey = new PluginKey("dropToColumns");

// ブロック左右端の「カラム化ゾーン」の幅。狭いブロックでは狭く、広い
// ブロックでも大きくなりすぎないようにクランプする
function edgeZoneWidth(rectWidth: number): number {
  return Math.max(24, Math.min(80, rectWidth * 0.2));
}

export type ColumnDropZone =
  | {
      /** 通常ブロックの左右端 → そのブロックとドラッグ中ブロックを 2 カラム化 */
      kind: "wrap";
      targetId: string;
      side: "left" | "right";
      /** DropCursor 用: 対象ノード直前の PM 位置 */
      cursorPos: number;
    }
  | {
      /** カラムの左右端 / カラム間 gap → 隣に新しいカラムを追加 */
      kind: "add-column";
      refColumnId: string;
      side: "left" | "right";
      cursorPos: number;
    };

/** ドラッグ中ブロックの id 一覧を PM slice（blocknote/html 由来）から得る */
function draggedIdsFromSlice(slice: Slice): string[] {
  const ids: string[] = [];
  let unsupported = false;
  slice.content.forEach((node) => {
    // カラム系ノード自体のドラッグは対象外（現状ドラッグハンドルでは掴めない）
    if (node.type.name === "column" || node.type.name === "columnList") {
      unsupported = true;
      return;
    }
    const id = node.attrs?.id;
    if (typeof id === "string" && id) ids.push(id);
  });
  return unsupported ? [] : ids;
}

/** view.dragging からドラッグ中 id を得る（dragover 中のカーソル抑制用） */
function draggedIdsFromView(view: EditorView): Set<string> {
  const dragging = (view as any).dragging;
  if (!dragging?.slice) return new Set();
  return new Set(draggedIdsFromSlice(dragging.slice));
}

/** カラム 2 本を横に並べるのに必要な最小幅。
 *  これ未満の幅で wrap しても即座に縦積みになるだけなので、ゾーンを出さない */
const MIN_WRAP_WIDTH = COLUMN_MIN_WIDTH_PX * 2 + COLUMN_GAP_PX;

/** columnList が折返し（縦積み）状態か: 隣接カラムのどこかが横に並んでいない */
function isColumnListStacked(listEl: HTMLElement): boolean {
  const columns = Array.from(
    listEl.querySelectorAll<HTMLElement>(':scope > [data-node-type="column"]'),
  );
  for (let i = 0; i < columns.length - 1; i++) {
    if (columns[i + 1].getBoundingClientRect().left < columns[i].getBoundingClientRect().right) {
      return true;
    }
  }
  return false;
}

/** コピー修飾（mac: Alt / それ以外: Ctrl。PM の dragCopyModifier と同じ判定） */
function isCopyModifier(event: { altKey?: boolean; ctrlKey?: boolean }): boolean {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return Boolean(isMac ? event.altKey : event.ctrlKey);
}

/**
 * ドロップ座標から「カラム化ゾーン」を判定する。
 * ゾーン外・編集不可・カラム化できないドラッグは null。
 *
 * handleDrop（実行側）と columnDropCursorPosition（表示側）の両方がこの
 * 関数を通るため、棄却条件はここに集約する — 表示と実挙動がズレると
 * 「縦カーソルが出たのにカラム化されない」という約束違反になる。
 */
export function computeColumnDropZone(
  view: EditorView,
  event: {
    clientX: number;
    clientY: number;
    dataTransfer?: DataTransfer | null;
    altKey?: boolean;
    ctrlKey?: boolean;
  },
): ColumnDropZone | null {
  if (!view.editable) return null;
  // SideMenu はエディタ外（ガター/余白）へのドロップを clientX を clamp した
  // synthetic イベントとして再送出する（core SideMenu.dispatchSyntheticEvent）。
  // clamp 後の座標は必ずブロック左端 = wrap の left ゾーンに入ってしまうので、
  // synthetic は「エディタ外ドロップ = 通常の挿入」として PM 既定に委ねる
  if ((event as { synthetic?: boolean }).synthetic) return null;
  // 外部ファイルのドラッグは対象外（画像アップロード等の既存経路に委ねる）。
  // dragover 中は protected mode で dataTransfer.files が常に空なので、
  // dragover でも読める types で判定する（"Files" は OS ファイルドラッグ固有）
  if (event.dataTransfer?.types?.includes("Files")) return null;
  if (event.dataTransfer?.files?.length) return null;
  // コピー修飾ドラッグはカラム化しない（handleDrop 側は moved=false で棄却
  // される — カーソルだけ出て実行されない不一致をここで防ぐ）
  if (isCopyModifier(event)) return null;

  // ブロックのハンドルドラッグ以外（テキスト選択・URL・外部 HTML）や、
  // 別エディタ発のドラッグ（id がこのドキュメントに無い）はカラム化できない。
  // SideMenu は dragstart で全エディタの view.dragging に slice を注入するため、
  // id がこのドキュメントで解決できるかまで確認する
  const draggedIds = draggedIdsFromView(view);
  if (draggedIds.size === 0) return null;
  for (const id of draggedIds) {
    if (!getNodeById(id, view.state.doc)) return null;
  }

  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el || !view.dom.contains(el)) return null;

  const blockOuter = el.closest<HTMLElement>('[data-node-type="blockOuter"]');
  const columnEl = el.closest<HTMLElement>('[data-node-type="column"]');

  if (blockOuter) {
    const rect = blockOuter.getBoundingClientRect();
    const zone = edgeZoneWidth(rect.width);
    const side =
      event.clientX <= rect.left + zone
        ? ("left" as const)
        : event.clientX >= rect.right - zone
          ? ("right" as const)
          : null;
    if (!side) return null;

    if (columnEl) {
      // カラム内のブロック端 → その「カラム」の隣に新しいカラムを足す。
      // 折返し（縦積み）中のリストは横方向の意味が薄いので対象外
      const listEl = columnEl.closest<HTMLElement>('[data-node-type="columnList"]');
      if (!listEl || isColumnListStacked(listEl)) return null;
      const refColumnId = columnEl.getAttribute("data-id");
      if (!refColumnId) return null;
      const posInfo = getNodeById(refColumnId, view.state.doc);
      if (!posInfo) return null;
      return { kind: "add-column", refColumnId, side, cursorPos: posInfo.posBeforeNode };
    }

    // 2 カラムを表示できない幅では wrap しても即縦積みになるだけ
    if (rect.width < MIN_WRAP_WIDTH) return null;
    const targetId = blockOuter.getAttribute("data-id");
    if (!targetId || draggedIds.has(targetId)) return null;
    const posInfo = getNodeById(targetId, view.state.doc);
    if (!posInfo) return null;
    return { kind: "wrap", targetId, side, cursorPos: posInfo.posBeforeNode };
  }

  // ブロック外だが columnList の上（カラム間の gap）→ その境界にカラム追加
  const listEl = el.closest<HTMLElement>('[data-node-type="columnList"]');
  if (listEl) {
    const columns = Array.from(
      listEl.querySelectorAll<HTMLElement>(':scope > [data-node-type="column"]'),
    );
    for (let i = 0; i < columns.length - 1; i++) {
      const leftRect = columns[i].getBoundingClientRect();
      const rightRect = columns[i + 1].getBoundingClientRect();
      if (rightRect.left < leftRect.right) continue; // 縦積み時は対象外
      // 同じ行にあるか（部分折返しで別の行のペアにマッチしないように）
      if (event.clientY < leftRect.top || event.clientY > leftRect.bottom) continue;
      if (event.clientX >= leftRect.right && event.clientX <= rightRect.left) {
        const refColumnId = columns[i].getAttribute("data-id");
        if (!refColumnId) return null;
        const posInfo = getNodeById(refColumnId, view.state.doc);
        if (!posInfo) return null;
        return { kind: "add-column", refColumnId, side: "right", cursorPos: posInfo.posBeforeNode };
      }
    }
  }
  return null;
}

/**
 * DropCursor の computeDropPosition フック。
 * カラム化ゾーンでは縦カーソル（block-vertical-left/right）、それ以外は
 * core の既定位置をそのまま使う。
 */
export function columnDropCursorPosition(
  ctx: ComputeDropPositionContext,
): DropCursorPosition | null {
  const zone = computeColumnDropZone(ctx.view, ctx.event);
  if (!zone) return ctx.defaultPosition;
  return {
    pos: zone.cursorPos,
    orientation: zone.side === "left" ? "block-vertical-left" : "block-vertical-right",
  };
}

// ── ここから純関数（ユニットテスト対象） ──────────────────────────────

const isColumnType = (b: any) => b?.type === "column" || b?.type === "columnList";

/**
 * ドロップの適用をページ JSON の変換として行う。
 *  1. draggedIds のブロックを（children ごと）ツリーから抜き取る
 *  2. zone に従って挿入する（wrap = 対象と 2 カラム化 / add-column = 隣に追加）
 *  3. 空になったカラム・1 本以下になった columnList を正規化する
 *
 * 順序が重要: 正規化を挿入の「後」に置くことで、2 カラムの一方の唯一の
 * ブロックをもう一方の隣に落とす「列の入れ替え」ジェスチャが成立する
 * （先に正規化すると ref カラムごとリストが解消されて挿入先を見失う）。
 *
 * 適用できない場合（dragged が見つからない、対象が消えた等）は null を返し、
 * 呼び出し側は PM の既定ドロップに委ねる。
 */
export function applyColumnDrop(
  blocks: any[],
  draggedIds: string[],
  zone:
    | { kind: "wrap"; targetId: string; side: "left" | "right" }
    | { kind: "add-column"; refColumnId: string; side: "left" | "right" },
): any[] | null {
  const idSet = new Set(draggedIds);
  const dragged: any[] = [];

  // 1. 抜き取りのみ（文書順）。空カラム等はこの段階では残す
  const extract = (bs: any[]): any[] => {
    const out: any[] = [];
    for (const b of bs ?? []) {
      if (idSet.has(b.id)) {
        dragged.push(b); // children ごと丸ごと移動（id も保存される）
        continue;
      }
      const children = b.children?.length ? extract(b.children) : b.children;
      out.push({ ...b, children });
    }
    return out;
  };

  const removed = extract(blocks);
  if (dragged.length === 0) return null;
  // カラム系ノードそのものは移動対象にしない（スキーマ違反になる）
  if (dragged.some(isColumnType)) return null;

  // 3. 正規化（挿入後に適用）: 空カラムを消し、1 本以下の columnList を解消
  const normalize = (bs: any[]): any[] => {
    const out: any[] = [];
    for (const b of bs ?? []) {
      const children = b.children?.length ? normalize(b.children) : b.children;
      if (b.type === "column") {
        if (!children || children.length === 0) continue;
        out.push({ ...b, children });
        continue;
      }
      if (b.type === "columnList") {
        const cols = (children ?? []).filter((c: any) => c.type === "column");
        if (cols.length >= 2) out.push({ ...b, children: cols });
        else if (cols.length === 1) out.push(...(cols[0].children ?? []));
        // 0 本なら columnList ごと消す
        continue;
      }
      out.push({ ...b, children });
    }
    return out;
  };

  // 2. 挿入
  if (zone.kind === "wrap") {
    let found = false;
    const wrap = (bs: any[]): any[] =>
      bs.map((b: any) => {
        if (b.id === zone.targetId) {
          // 対象がカラム系ならここでは扱わない（zone 判定側で除外済みのはず）
          if (isColumnType(b)) return b;
          found = true;
          const draggedColumn = { type: "column", children: dragged };
          const targetColumn = { type: "column", children: [b] };
          return {
            type: "columnList",
            children:
              zone.side === "left"
                ? [draggedColumn, targetColumn]
                : [targetColumn, draggedColumn],
          };
        }
        // wrap 対象がカラムの中に居ることは無い（zone 判定で add-column になる）
        // が、step 等のネストは辿る
        if (!isColumnType(b) && b.children?.length) {
          return { ...b, children: wrap(b.children) };
        }
        return b;
      });
    const result = wrap(removed);
    return found ? normalize(result) : null;
  }

  // add-column: refColumnId の隣に新しいカラムを挿し込む
  {
    let found = false;
    const insert = (bs: any[]): any[] =>
      bs.map((b: any) => {
        if (b.type === "columnList" && b.children?.some((c: any) => c.id === zone.refColumnId)) {
          found = true;
          const newColumn = { type: "column", children: dragged };
          const idx = b.children.findIndex((c: any) => c.id === zone.refColumnId);
          const children = [...b.children];
          children.splice(zone.side === "left" ? idx : idx + 1, 0, newColumn);
          return { ...b, children };
        }
        if (b.children?.length) return { ...b, children: insert(b.children) };
        return b;
      });
    const result = insert(removed);
    return found ? normalize(result) : null;
  }
}

// ── 拡張本体 ─────────────────────────────────────────────────────────

export const dropToColumnsExtension = createExtension(({ editor }) => ({
  key: "dropToColumns",
  prosemirrorPlugins: [
    new Plugin({
      key: pluginKey,
      props: {
        handleDrop(view, event, slice, moved) {
          // コピー修飾ドラッグ（moved=false）は PM 既定に委ねる
          // （元を残して複製し、UniqueID が重複 id を再採番する既存挙動）
          if (!moved) return false;

          const zone = computeColumnDropZone(view, event as DragEvent);
          if (!zone) return false;

          const ids = draggedIdsFromSlice(slice);
          if (ids.length === 0) return false;
          // 別エディタ発のドラッグ（このドキュメントに id が無い）は既定に委ねる
          if (ids.some((id) => !editor.getBlock(id))) return false;

          const next = applyColumnDrop(
            editor.document as any[],
            ids,
            zone.kind === "wrap"
              ? { kind: "wrap", targetId: zone.targetId, side: zone.side }
              : { kind: "add-column", refColumnId: zone.refColumnId, side: zone.side },
          );
          if (!next) return false;

          event.preventDefault();
          // 1 回の置換 = 1 undo。id が保存されるため PROV・ラベル・リンク・
          // メモアンカー等の id ベースのサイドストアはすべて無傷
          editor.replaceBlocks(editor.document, next as any);
          // 全置換で選択が位置マッピングに失敗しノート末尾へ落ちるため、
          // ドラッグしたブロックへキャレットを戻す（PM 既定ドロップは
          // ドロップ先を選択+focus するので、それに合わせた挙動）。
          // content: "none" のブロック等で失敗しても致命的でないので握りつぶす
          try {
            editor.setTextCursorPosition(ids[0], "start");
            editor.focus();
          } catch {
            /* キャレット復元は best-effort */
          }
          return true;
        },
      },
    }),
  ],
}));
