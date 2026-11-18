// mediaOcr サイドストアからの読み出しユーティリティ（純関数）。
//
// 索引構築（index-file.ts）と PROV 生成（prov-generator）から使う。
// React に依存しないよう store.tsx とは別ファイルに置く。

import type { MediaOcrEntry } from "../../lib/document-types";
import { MAX_ALT_TEXT_CHARS, sanitizeAltText } from "../../lib/ocr-alt";

/** OCR テキストを収集できるブロック種別（現状は画像のみ） */
export const OCR_CAPABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["image"]);

/**
 * ページの mediaOcr から、横断検索用の「別の読み」（altText）を組み立てる（改行区切り）。
 * 探すための経路にだけ使う。表示・AI への本文・書き出しには渡さない。
 */
export function collectOcrAltText(
  mediaOcr: Record<string, MediaOcrEntry> | undefined,
): string | undefined {
  if (!mediaOcr) return undefined;
  const texts = Object.values(mediaOcr)
    .map((e) => sanitizeAltText(e?.altText))
    .filter((t): t is string => !!t);
  // 画像が多くても索引へ入る総量は 1 つ分の上限に収める
  return texts.length > 0 ? texts.join("\n").slice(0, MAX_ALT_TEXT_CHARS) : undefined;
}

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
