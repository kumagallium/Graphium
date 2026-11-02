// ノートの素材ブロック（画像・動画・PDF）から、それが指す素材（MediaIndexEntry）を引く。
// 素材に付いたメモの印（MemoBlockLayer）が、どのブロックに印を出すかの判定に使う。
//
// 引き方は画像のサイドピーク（blocks/image-peek.ts の resolveImagePeekFileId）と同じ:
//   block.props.url → プロバイダの extractFileId → 素材の索引（getLatestMediaIndex）
// 素材に引けないもの（外部 URL・shared-blob:・別プロバイダのスキーム・同意前の外部画像・
// アップロード前の空 url・索引に無い fileId）は null で、印を出さない。

import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndex, MediaIndexEntry } from "./media-index";

/** メモの印を出すブロック型。audio / file / bookmark は 1 行の帯で絵が無く、重ねる場所が無いので対象外 */
export const MEMO_ANCHOR_BLOCK_TYPES: ReadonlySet<string> = new Set(["image", "video", "pdf"]);

export type BlockLike = {
  type?: string;
  props?: { url?: unknown } | null;
};

/** プロバイダの url → fileId（取れなければ null。プロバイダ未初期化も null） */
function defaultExtractFileId(url: string): string | null {
  try {
    return getActiveProvider().extractFileId(url) ?? null;
  } catch {
    // プロバイダ未設定（テスト・Storybook）では素材として扱わない
    return null;
  }
}

/**
 * 素材ブロックが指す素材を返す。引けなければ null。
 * 同じ素材を同じノートに複数回貼っても、ブロックごとに自分の url から引く
 * （usedIn の blockId は同じ url で 1 つしか残らないので使わない）。
 */
export function resolveBlockMaterial(
  block: BlockLike | null | undefined,
  mediaIndex: Pick<MediaIndex, "media"> | null | undefined,
  extractFileId: (url: string) => string | null | undefined = defaultExtractFileId,
): MediaIndexEntry | null {
  if (!block || !block.type || !MEMO_ANCHOR_BLOCK_TYPES.has(block.type)) return null;
  const url = block.props?.url;
  if (typeof url !== "string" || !url) return null;
  let fileId: string | null | undefined;
  try {
    fileId = extractFileId(url);
  } catch {
    return null;
  }
  if (!fileId) return null;
  return lookupMedia(mediaIndex?.media, fileId);
}

// 素材の索引（media 配列）ごとに fileId の引き表を 1 つ持つ。索引の更新は配列を作り直す
// （map / filter で新しい配列にする）ので、参照が変わったときだけ作り直される。
// 素材が数千件でも、描画のたびに線形探索を素材ブロックの数だけ回さない。
const mediaLookupCache = new WeakMap<readonly MediaIndexEntry[], Map<string, MediaIndexEntry>>();

function lookupMedia(
  media: readonly MediaIndexEntry[] | null | undefined,
  fileId: string,
): MediaIndexEntry | null {
  if (!media) return null;
  let table = mediaLookupCache.get(media);
  if (!table) {
    table = new Map();
    // 同じ fileId が複数あれば先頭を採る（find と同じ）
    for (const m of media) if (!table.has(m.fileId)) table.set(m.fileId, m);
    mediaLookupCache.set(media, table);
  }
  return table.get(fileId) ?? null;
}

/**
 * エディタの文書を 1 回だけ走査して、素材ブロック（画像・動画・PDF）の id → ブロックの形を返す。
 * ブロックごとに editor.getBlock を呼ぶと、そのつど文書の先頭から探し直すので、
 * 入力のたびに「素材の数 × 文書の大きさ」になる。取れなければ null（呼び出し側が getBlock に戻す）。
 */
export function collectMaterialBlocks(editor: any): Map<string, BlockLike> | null {
  const doc = editor?._tiptapEditor?.state?.doc;
  if (!doc || typeof doc.descendants !== "function") return null;
  const blocks = new Map<string, BlockLike>();
  try {
    doc.descendants((node: any) => {
      if (node.type?.name === "blockContainer" && node.attrs?.id) {
        const content = node.firstChild;
        const type = content?.type?.name;
        if (type && MEMO_ANCHOR_BLOCK_TYPES.has(type)) {
          blocks.set(node.attrs.id, { type, props: { url: content.attrs?.url } });
        }
      }
      return true;
    });
  } catch {
    return null;
  }
  return blocks;
}
