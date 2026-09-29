// 本文の画像ブロックから素材のサイドピークを開くための、エディタ単位の登録口と判定。
//
// 素材のサイドピーク（MaterialSidePeek）は @素材・素材一覧・グラフ・表のセル内の画像から
// 開けるが、本文の画像ブロックからは開けなかった。入口はツールバーのボタンと画像の
// ダブルクリックの 2 つで、どちらもここを通る。
//
// 置き場所が blocks なのは、base/editor.tsx（ダブルクリック）から features へ
// 依存させないため（lint:deps の base-not-to-features）。
// 登録はブックマークのサイドピーク（blocks/bookmark/callbacks.ts）と同じ形で、
// エディタをキーにした WeakMap に置く。メインのエディタにだけ登録するので、
// サイドピークの中・共有ノートの閲覧・テンプレートのプレビューでは
// 入口が出ない（開き手が無い）。

import { getActiveProvider } from "../lib/storage/registry";
import { getLatestMediaIndex } from "../features/asset-browser/media-index";

// 画像（素材 ID）をサイドピークで開く開き手。エディタ単位で登録する
// 開き手は「実際に開けたか」を返す（索引の源のずれなどで開けないとき false）
const imagePeekCallbacks = new WeakMap<object, (fileId: string) => boolean>();

export function setImagePeekCallback(editor: any, cb: ((fileId: string) => boolean) | null) {
  if (!editor) return;
  if (cb) imagePeekCallbacks.set(editor, cb);
  else imagePeekCallbacks.delete(editor);
}

/** このエディタに開き手が登録されているか */
export function hasImagePeek(editor: any): boolean {
  return Boolean(editor) && imagePeekCallbacks.has(editor);
}

/** 登録済みで実際に開けたら true。未登録・開き手が開けなかったときは false（何もしない） */
export function openImagePeek(editor: any, fileId: string): boolean {
  if (!editor || !fileId) return false;
  const cb = imagePeekCallbacks.get(editor);
  if (!cb) return false;
  return cb(fileId);
}

type ImagePeekTargetInput = {
  /** 画像ブロックの props.url */
  url: unknown;
  /** このエディタに開き手が登録されているか */
  registered: boolean;
  /** プロバイダの url → fileId（外部 URL は null） */
  extractFileId: (url: string) => string | null | undefined;
  /** 素材の索引（まだ読み込まれていなければ null） */
  mediaIndex: { media: readonly { fileId: string }[] } | null | undefined;
};

/**
 * 画像ブロックの url から、サイドピークで開ける素材 ID を返す（開けなければ null）。
 *
 * 押して何も起きない入口を作らないための判定。次のどれかなら null:
 * - 開き手が無いエディタ
 * - url が無い（アップロード前）
 * - fileId が取れない（外部 URL の画像）
 * - 素材の索引にその fileId の項目が無い（開き先の entry が解決できず、何も起きない）
 */
export function pickImagePeekFileId(input: ImagePeekTargetInput): string | null {
  if (!input.registered) return null;
  if (typeof input.url !== "string" || !input.url) return null;
  let fileId: string | null | undefined;
  try {
    fileId = input.extractFileId(input.url);
  } catch {
    // プロバイダ未初期化（テスト・Storybook）では素材として扱わない
    return null;
  }
  if (!fileId) return null;
  if (!input.mediaIndex?.media.some((m) => m.fileId === fileId)) return null;
  return fileId;
}

/** 実際のプロバイダと索引で {@link pickImagePeekFileId} を評価する */
export function resolveImagePeekFileId(editor: any, url: unknown): string | null {
  return pickImagePeekFileId({
    url,
    registered: hasImagePeek(editor),
    extractFileId: (u) => getActiveProvider().extractFileId(u),
    mediaIndex: getLatestMediaIndex(),
  });
}

/**
 * 画像ブロックのダブルクリックを処理する（editor.tsx の dblclick ハンドラの本体）。
 * サイドピークを開いて既定の動作を止めたら true。それ以外は何もせず false。
 *
 * 対象は画像ブロックの img だけ。次は除外する:
 * - img でない要素（リサイズハンドル・キャプション・読み込み中のプレースホルダ等）
 * - 表のセル内の画像（inline-image。自前のクリックで開く別実装がある）
 * - リサイズハンドルの中
 * 開けない画像（外部 URL・索引に無い・開き手が無いエディタ）でも false で、既定の動作を残す。
 */
export function handleImageDblclick(event: any, editor: any): boolean {
  try {
    const el = event?.target as HTMLElement | null;
    if (!el?.closest || el.tagName !== "IMG") return false;
    if (el.closest('[data-test="inline-image"]')) return false;
    if (el.closest(".bn-resize-handle")) return false;
    const container = el.closest('[data-node-type="blockContainer"]');
    const blockId = container?.getAttribute("data-id");
    const block = blockId ? editor?.getBlock?.(blockId) : null;
    if (block?.type !== "image") return false;
    const fileId = resolveImagePeekFileId(editor, block.props?.url);
    if (!fileId) return false;
    if (!openImagePeek(editor, fileId)) return false;
    event.preventDefault();
    return true;
  } catch {
    // 入口の補助。失敗しても既定の動作は邪魔しない
    return false;
  }
}
