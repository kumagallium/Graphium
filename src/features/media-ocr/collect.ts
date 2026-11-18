// mediaOcr サイドストアからの読み出しユーティリティ（純関数）。
//
// 索引構築（index-file.ts）と PROV 生成（prov-generator）から使う。
// React に依存しないよう store.tsx とは別ファイルに置く。
// mediaOcr は共有フォルダの他人のノートからも来るので、型が違っても投げない。

import type { MediaOcrEntry } from "../../lib/document-types";
import {
  MAX_ALT_TEXT_CHARS,
  cutAt,
  ocrEntriesOf,
  sanitizeAltText,
  sanitizeOcrText,
} from "../../lib/ocr-text";

/** OCR テキストを収集できるブロック種別（現状は画像のみ） */
export const OCR_CAPABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["image"]);

/** 1 ページ分の読み（text）を連結した総量の上限。画像が極端に多くても索引へ入る量を抑える */
export const MAX_OCR_TEXT_TOTAL_CHARS = 500_000;

/**
 * ページの mediaOcr から、横断検索用の「別の読み」（altText）を組み立てる（改行区切り）。
 * 探すための経路にだけ使う。表示・AI への本文・書き出しには渡さない。
 */
export function collectOcrAltText(
  mediaOcr: Record<string, MediaOcrEntry> | undefined,
): string | undefined {
  const texts = ocrEntriesOf(mediaOcr)
    .map((e) => sanitizeAltText(e.altText))
    .filter((t): t is string => !!t);
  // 画像が多くても索引へ入る総量は 1 つ分の上限に収める
  return texts.length > 0 ? cutAt(texts.join("\n"), MAX_ALT_TEXT_CHARS) : undefined;
}

/**
 * ページの mediaOcr から、横断検索用のテキストを組み立てる（改行区切り）。
 * 空文字しか無い場合は undefined を返し、索引に無駄なキーを残さない。
 */
export function collectOcrText(
  mediaOcr: Record<string, MediaOcrEntry> | undefined,
): string | undefined {
  const texts = ocrEntriesOf(mediaOcr)
    .map((e) => sanitizeOcrText(e.text))
    .filter((t): t is string => !!t);
  if (texts.length === 0) return undefined;
  return cutAt(texts.join("\n"), MAX_OCR_TEXT_TOTAL_CHARS);
}
