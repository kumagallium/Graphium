// 書式ツールバーの「メモ」ボタンが呼び出す、エディタ単位の登録口と判定。
//
// ボタンは 2 つの場面で出る:
// - 文字を選んだとき: 選んだ文にメモ（ブロック紐付きのメモを書くダイアログ）
// - 素材ブロック（画像・動画・PDF）を選んだとき: その素材のメモの小窓
//
// どちらの開き手も、メインのノート編集のエディタにだけ登録する（画像のサイドピークの
// blocks/image-peek.ts と同じ形。エディタをキーにした WeakMap）。サイドピーク内・共有ノートの
// 閲覧・テンプレート編集のエディタには登録されないので、ボタンも出ない（開き手が無い）。

import { toMemoExcerpt } from "../mobile-capture/memo-target";
import { MEMO_ANCHOR_BLOCK_TYPES, resolveBlockMaterial, type BlockLike } from "./block-material";
import { getLatestMediaIndex } from "./media-index";

/** 選んだ文にメモを書くダイアログを開く。blockText は選んだ文字の抜粋 */
export type SelectionMemoOpener = (params: { blockId: string; blockText: string }) => void;
/** 素材ブロックのメモの小窓を開く。開けたら true */
export type MaterialMemoOpener = (blockId: string) => boolean;

const selectionOpeners = new WeakMap<object, SelectionMemoOpener>();
const materialOpeners = new WeakMap<object, MaterialMemoOpener>();

export function setSelectionMemoOpener(editor: any, cb: SelectionMemoOpener | null) {
  if (!editor) return;
  if (cb) selectionOpeners.set(editor, cb);
  else selectionOpeners.delete(editor);
}

export function hasSelectionMemoOpener(editor: any): boolean {
  return Boolean(editor) && selectionOpeners.has(editor);
}

/**
 * 選んだ文にメモを書くダイアログを開く。開いたら true。
 * 開き手が無い・選択の先頭ブロックが取れないときは false（何もしない）。
 */
export function openSelectionMemo(editor: any): boolean {
  const cb = editor ? selectionOpeners.get(editor) : undefined;
  if (!cb) return false;
  const blockId = getSelectionStartBlockId(editor);
  if (!blockId) return false;
  let text = "";
  try {
    text = editor.getSelectedText?.() ?? "";
  } catch {
    // 抜粋は見せ方の補助。取れなくても、ブロックに付けるメモは書ける
  }
  cb({ blockId, blockText: toMemoExcerpt(text) });
  return true;
}

export function setMaterialMemoOpener(editor: any, cb: MaterialMemoOpener | null) {
  if (!editor) return;
  if (cb) materialOpeners.set(editor, cb);
  else materialOpeners.delete(editor);
}

export function hasMaterialMemoOpener(editor: any): boolean {
  return Boolean(editor) && materialOpeners.has(editor);
}

/** 素材ブロックのメモの小窓を開く。開けたら true */
export function openMaterialMemo(editor: any, blockId: string): boolean {
  const cb = editor ? materialOpeners.get(editor) : undefined;
  if (!cb || !blockId) return false;
  return cb(blockId);
}

/**
 * 選択の先頭（from）があるブロックの ID。文字を複数ブロックにまたいで選んでも、
 * メモは選び始めたブロックに付ける。取れなければ null。
 */
export function getSelectionStartBlockId(editor: any): string | null {
  try {
    const $from = editor?._tiptapEditor?.state?.selection?.$from;
    if (!$from) return null;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node?.type?.name === "blockContainer" && node.attrs?.id) return node.attrs.id as string;
    }
  } catch {
    // 取れなければ null
  }
  return null;
}

/**
 * ツールバーに「メモ」ボタンを出せる素材ブロックか。
 * 開き手の登録されたエディタで、画像・動画・PDF のブロックが素材に引けるときだけ true
 * （MemoBlockLayer が印を出す条件と同じ。押して何も起きないボタンを作らない）。
 */
export function canOpenMaterialMemo(
  editor: any,
  block: BlockLike | null | undefined,
  mediaIndex: Parameters<typeof resolveBlockMaterial>[1] = getLatestMediaIndex(),
  extractFileId?: (url: string) => string | null | undefined,
): boolean {
  if (!hasMaterialMemoOpener(editor)) return false;
  if (!block?.type || !MEMO_ANCHOR_BLOCK_TYPES.has(block.type)) return false;
  return resolveBlockMaterial(block, mediaIndex, extractFileId) !== null;
}
