// mediaOcr サイドストアからの読み出しユーティリティ（純関数）。
//
// 索引構築（index-file.ts）と PROV 生成（prov-generator）から使う。
// React に依存しないよう store.tsx とは別ファイルに置く。

import type { MediaOcrEntry } from "../../lib/document-types";

/** OCR テキストを収集できるブロック種別（現状は画像のみ） */
export const OCR_CAPABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["image"]);

/**
 * ページの mediaOcr から、横断検索用のテキストを組み立てる（改行区切り）。
 * 空文字しか無い場合は undefined を返し、索引に無駄なキーを残さない。
 */
export function collectOcrText(
  mediaOcr: Record<string, MediaOcrEntry> | undefined,
): string | undefined {
  if (!mediaOcr) return undefined;
  const texts = Object.values(mediaOcr)
    .map((e) => e?.text?.trim())
    .filter((t): t is string => !!t);
  return texts.length > 0 ? texts.join("\n") : undefined;
}
