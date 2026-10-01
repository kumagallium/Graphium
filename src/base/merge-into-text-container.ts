// 複数行のブロックを引用・Callout の「中」へ入れる拡張（貼り付け・ドラッグ&ドロップ）
//
// 引用（quote）と Callout は 1 ブロック = インライン本文 1 つで、複数行は
// 改行（hardBreak）で持つ。ところが段落を複数まとめて貼り付けたりドロップすると、
// ProseMirror は段落の境目でブロックを割るので、1 行目だけが中に入り、2 行目以降は
// 引用の外に段落として出てしまう（ハンドルでのドラッグは前後への並べ替えにしかならない）。
//
// ここでは「行どうしを改行でつないだインライン本文」に変換してから入れる:
//   - 貼り付け: キャレット（選択）が引用・Callout の本文にあり、2 行以上なら合流
//   - テキスト選択のドラッグ: 落とした位置が引用・Callout の本文で、2 行以上なら合流
//   - ハンドル（⠿）のドラッグ: 引用・Callout の本体の上（上下の端を除く）に落とすと
//     本文の末尾へ合流し、元のブロックは消える。上下の端・ブロックの間は従来どおり
//     前後への並べ替え、左右端はカラム化（drop-to-columns.ts が先に判定する）
//
// 画像・表など文字にできないブロックが混ざっていたら何もしない（既定の挙動に任せる）。
// 文字の装飾（太字・リンク・@メンション等）はインラインのまま残る。

import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Fragment, Slice, type Node as PMNode, type Schema } from "prosemirror-model";
import { createExtension, getNodeById } from "@blocknote/core";
import type { DropCursorOptions } from "@blocknote/core";
import { computeColumnDropZone } from "../blocks/multi-column/drop-to-columns";

type ComputeDropPosition = NonNullable<
  NonNullable<DropCursorOptions["hooks"]>["computeDropPosition"]
>;
type ComputeDropPositionContext = Parameters<ComputeDropPosition>[0];
type DropCursorPosition = NonNullable<ReturnType<ComputeDropPosition>>;

/** 中へ合流できるブロック（インライン本文 1 つで、改行で複数行を持つもの） */
export const MERGE_TARGET_TYPES: ReadonlySet<string> = new Set(["quote", "callout"]);

const pluginKey = new PluginKey("mergeIntoTextContainer");

// ── 純関数（ユニットテスト対象） ─────────────────────────────────────

/**
 * ブロック群（PM の Fragment）を「改行でつないだインライン本文」に変換する。
 * 文字にできないブロック（画像・表などの内容なしブロック）が混ざっていたら null。
 *
 * 子ブロック（入れ子の箇条書き等）も文書順に 1 行ずつ並べる。
 * 先頭・末尾の空行は落とす（コピー範囲の端に付いてくる空段落で余計な改行が入らないように）。
 */
export function flattenToInlineLines(
  fragment: Fragment,
  schema: Schema,
): { content: Fragment; lines: number } | null {
  const hardBreak = schema.nodes.hardBreak;
  if (!hardBreak) return null;
  const lines: PMNode[][] = [];
  let current: PMNode[] | null = null; // 開いたスライスの先頭に来るインラインの受け皿
  let ok = true;

  const walk = (frag: Fragment) => {
    frag.forEach((node) => {
      if (!ok) return;
      if (node.isTextblock) {
        const line: PMNode[] = [];
        node.content.forEach((child) => line.push(child));
        lines.push(line);
        current = null;
        return;
      }
      if (node.isInline) {
        if (!current) {
          current = [];
          lines.push(current);
        }
        current.push(node);
        return;
      }
      // 表は中のセルが textblock でも行として並べると意味が壊れる
      if (node.isLeaf || node.type.spec.content === "tableRow+") {
        ok = false;
        return;
      }
      walk(node.content);
    });
  };
  walk(fragment);
  if (!ok) return null;

  while (lines.length > 0 && lines[0].length === 0) lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop();
  if (lines.length === 0) return null;

  const nodes: PMNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) nodes.push(hardBreak.create());
    nodes.push(...line);
  });
  return { content: Fragment.from(nodes), lines: lines.length };
}

/** 位置が引用・Callout の本文の中か */
function isInMergeTarget(parent: PMNode): boolean {
  return MERGE_TARGET_TYPES.has(parent.type.name);
}

// ── ドロップ先の判定 ─────────────────────────────────────────────────

export type MergeDropTarget =
  | {
      /** ハンドルでつかんだブロックを、対象ブロックの本文末尾へ合流 */
      kind: "block";
      targetId: string;
      draggedIds: string[];
      content: Fragment;
      rect: DOMRect;
    }
  | {
      /** テキスト選択のドラッグを、落とした位置へ合流 */
      kind: "text";
      pos: number;
      content: Fragment;
    };

/** 本体の上下でこの幅（px）は「前後への並べ替え」に残す */
const EDGE_BAND_PX = 8;

/** コピー修飾（mac: Alt / それ以外: Ctrl。PM の dragCopyModifier と同じ判定） */
function isCopyModifier(event: { altKey?: boolean; ctrlKey?: boolean }): boolean {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return Boolean(isMac ? event.altKey : event.ctrlKey);
}

/** ハンドルドラッグの slice から、このドキュメントにあるブロック id を得る（無ければ null） */
function draggedBlockIds(view: EditorView, slice: Slice): string[] | null {
  const ids: string[] = [];
  let allBlocks = slice.content.childCount > 0;
  slice.content.forEach((node) => {
    const id = node.type.name === "blockContainer" ? node.attrs?.id : null;
    if (typeof id === "string" && id && getNodeById(id, view.state.doc)) ids.push(id);
    else allBlocks = false;
  });
  return allBlocks ? ids : null;
}

/**
 * ドロップ座標から「引用・Callout への合流」を判定する。合流しないなら null。
 * handleDrop（実行側）とドロップカーソルのフック（表示側）の両方がここを通る。
 */
export function computeMergeDropTarget(
  view: EditorView,
  event: {
    clientX: number;
    clientY: number;
    dataTransfer?: DataTransfer | null;
    altKey?: boolean;
    ctrlKey?: boolean;
  },
): MergeDropTarget | null {
  if (!view.editable) return null;
  // エディタ外ドロップの再送（SideMenu の synthetic）は通常の挿入に任せる
  if ((event as { synthetic?: boolean }).synthetic) return null;
  if (event.dataTransfer?.types?.includes("Files")) return null;
  if (isCopyModifier(event)) return null;
  const slice: Slice | undefined = (view as any).dragging?.slice;
  if (!slice) return null;

  const ids = draggedBlockIds(view, slice);
  if (ids) {
    // 左右端はカラム化ゾーン（そちらを優先）
    if (computeColumnDropZone(view, event)) return null;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || !view.dom.contains(el)) return null;
    const blockOuter = el.closest<HTMLElement>('[data-node-type="blockOuter"]');
    if (!blockOuter) return null;
    // 文書順で最初の .bn-block-content = このブロック自身の本体（子ブロックは後ろ）
    const content = blockOuter.querySelector<HTMLElement>(".bn-block-content");
    const type = content?.getAttribute("data-content-type");
    if (!content || !type || !MERGE_TARGET_TYPES.has(type)) return null;
    const rect = content.getBoundingClientRect();
    const band = Math.min(EDGE_BAND_PX, rect.height / 4);
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top + band ||
      event.clientY > rect.bottom - band
    ) {
      return null;
    }
    const targetId = blockOuter.getAttribute("data-id");
    if (!targetId || ids.includes(targetId)) return null;
    const target = getNodeById(targetId, view.state.doc);
    if (!target) return null;
    // 対象がドラッグ中ブロックの子孫なら、元を消すと対象も消える
    for (const id of ids) {
      const info = getNodeById(id, view.state.doc);
      if (!info) return null;
      const end = info.posBeforeNode + info.node.nodeSize;
      if (target.posBeforeNode > info.posBeforeNode && target.posBeforeNode < end) return null;
    }
    const flat = flattenToInlineLines(slice.content, view.state.schema);
    if (!flat) return null;
    return { kind: "block", targetId, draggedIds: ids, content: flat.content, rect };
  }

  // テキスト選択のドラッグ: 落とした位置そのものへ。1 行なら既定の挿入で中に入る
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  if (!isInMergeTarget($pos.parent)) return null;
  const flat = flattenToInlineLines(slice.content, view.state.schema);
  if (!flat || flat.lines < 2) return null;
  return { kind: "text", pos: hit.pos, content: flat.content };
}

// ── 合流先の表示 ─────────────────────────────────────────────────────
// 線（ドロップカーソル）では「中に入る」が伝わらないので、対象の本体を面で囲む。
// drop-zone-overlay.ts と同じく body 直下の固定配置で、PM の DOM には触らない。

let overlay: HTMLElement | null = null;
let lastKey = "";

function hideOverlay() {
  if (!overlay) return;
  overlay.style.display = "none";
  lastKey = "";
  window.removeEventListener("dragend", hideOverlay, true);
  window.removeEventListener("drop", hideOverlay, true);
}

function showOverlay(rect: DOMRect) {
  const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  if (key === lastKey) return;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-merge-drop-target", "");
    document.body.appendChild(overlay);
  }
  if (!lastKey) {
    window.addEventListener("dragend", hideOverlay, true);
    window.addEventListener("drop", hideOverlay, true);
  }
  lastKey = key;
  overlay.style.display = "block";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

/**
 * DropCursor の computeDropPosition フックを包む。合流するときは線を消して
 * 対象を囲み（ハンドル）／文字位置にキャレット線を出す（テキスト）。
 * それ以外は fallback（カラム化の判定）に任せる。
 */
export function withMergeDropCursor(fallback: ComputeDropPosition): ComputeDropPosition {
  return (ctx: ComputeDropPositionContext): DropCursorPosition | null => {
    const target = computeMergeDropTarget(ctx.view, ctx.event);
    if (!target) {
      hideOverlay();
      return fallback(ctx);
    }
    if (target.kind === "text") {
      hideOverlay();
      return { pos: target.pos, orientation: "inline" };
    }
    showOverlay(target.rect);
    return null;
  };
}

// ── 拡張本体 ─────────────────────────────────────────────────────────

export const mergeIntoTextContainerExtension = createExtension(({ editor }) => ({
  key: "mergeIntoTextContainer",
  prosemirrorPlugins: [
    new Plugin({
      key: pluginKey,
      props: {
        handlePaste(view, _event, slice) {
          const { $from, $to } = view.state.selection;
          if (!isInMergeTarget($from.parent) || $from.parent !== $to.parent) return false;
          const flat = flattenToInlineLines(slice.content, view.state.schema);
          // 1 行なら既定の貼り付けでそのまま中に入る
          if (!flat || flat.lines < 2) return false;
          const tr = view.state.tr.replaceSelection(new Slice(flat.content, 0, 0));
          view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
          return true;
        },

        handleDrop(view, event, slice, moved) {
          const target = computeMergeDropTarget(view, event as DragEvent);
          hideOverlay();
          if (!target) return false;

          if (target.kind === "text") {
            const { from, to } = view.state.selection;
            // 自分の選択範囲の中へ落とすのは何もしない操作
            if (moved && target.pos >= from && target.pos <= to) return false;
            const tr = view.state.tr;
            if (moved) tr.deleteSelection();
            const pos = tr.mapping.map(target.pos);
            tr.insert(pos, target.content);
            tr.setSelection(TextSelection.create(tr.doc, pos + target.content.size));
            event.preventDefault();
            view.focus();
            view.dispatch(tr.setMeta("uiEvent", "drop"));
            return true;
          }

          // ハンドルのドラッグ。コピー修飾（moved=false）は既定に任せる
          if (!moved) return false;
          event.preventDefault();
          editor.transact((tr) => {
            const info = getNodeById(target.targetId, tr.doc);
            if (!info) return;
            const blockContent = info.node.firstChild!;
            const endOfText = info.posBeforeNode + 1 + blockContent.nodeSize - 1;
            const content =
              blockContent.content.size > 0
                ? Fragment.from(view.state.schema.nodes.hardBreak.create()).append(target.content)
                : target.content;
            tr.insert(endOfText, content);
            // 元のブロックを消す（1 トランザクション = undo 1 回）
            editor.removeBlocks(target.draggedIds);
            // drop-to-columns の後始末（空になった列の解消）を走らせる目印
            tr.setMeta("uiEvent", "drop");
          });
          try {
            editor.setTextCursorPosition(target.targetId, "end");
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
