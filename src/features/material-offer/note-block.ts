// 承認した素材を、ノートの末尾に置くブロック。
// 種類の分け方は、素材の一覧から挿入するとき（note-app の handleMediaSelect）と同じ:
//   PDF → pdf ブロック、画像・動画・音声 → 同名のブロック、それ以外 → file ブロック

import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumDocument } from "../../lib/document-types";

export type MaterialBlock = {
  id: string;
  type: "pdf" | "image" | "video" | "audio" | "file";
  props: { url: string; name: string };
  children: [];
};

export function materialBlockFor(entry: Pick<MediaIndexEntry, "type" | "url" | "name">, id: string = crypto.randomUUID()): MaterialBlock {
  const type =
    entry.type === "pdf"
      ? "pdf"
      : entry.type === "image" || entry.type === "video" || entry.type === "audio"
        ? entry.type
        : "file";
  return { id, type, props: { url: entry.url, name: entry.name }, children: [] };
}

/**
 * 閉じているノートの末尾にブロックを足した文書を返す（保存はしない）。
 * 末尾が空の段落なら、その手前に入れる（Web クリップの追記と同じ）。ページが無ければ null
 */
export function appendBlockToDoc(
  doc: GraphiumDocument,
  block: MaterialBlock,
  now: string = new Date().toISOString(),
): GraphiumDocument | null {
  const page = doc.pages[0];
  if (!page) return null;
  const blocks = [...(page.blocks ?? [])];
  const last = blocks[blocks.length - 1] as { type?: string; content?: unknown; children?: unknown } | undefined;
  const lastIsEmptyParagraph =
    last?.type === "paragraph" &&
    (!Array.isArray(last.content) || last.content.length === 0) &&
    (!Array.isArray(last.children) || last.children.length === 0);
  if (lastIsEmptyParagraph) blocks.splice(blocks.length - 1, 0, block);
  else blocks.push(block);
  return { ...doc, modifiedAt: now, pages: [{ ...page, blocks }, ...doc.pages.slice(1)] };
}
