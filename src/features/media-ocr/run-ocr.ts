// 画像ブロックに対して端末内 OCR を実行するヘルパー。
//
// 保存済みの画像はプロバイダ内部スキーム（local-media:// 等）で保存されており、
// <img src> でも fetch でも直接は読めない。Tesseract は文字列ソースを fetch する
// ため、OCR に渡す前に必ず解決する（pdf-viewer / image ブロックと同じ経路）。

import { getActiveProvider } from "../../lib/storage/registry";
import {
  recognizeImage,
  DEFAULT_OCR_LANG,
  type OcrProgress,
} from "../../lib/ocr";
import type { MediaOcrEntry } from "../../lib/document-types";

/**
 * プロバイダ内部スキームの URL を、fetch / <img src> で読める URL に解決する。
 * データ URL・blob URL・通常の http URL はそのまま返す。
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!url) return "";
  const provider = getActiveProvider();
  const fileId = provider.extractFileId(url);
  if (!fileId) return url;
  return provider.getMediaBlobUrl(fileId);
}

/**
 * 画像 URL から文字を抽出し、保存用のエントリを組み立てる。
 * 画像は端末内だけで処理され、外部サーバーへ送信されない
 * （wasm と言語データのみ CDN から取得する）。
 */
export async function runOcrForImage(
  source: string | File | Blob,
  opts: { langs?: string; onProgress?: (p: OcrProgress) => void } = {},
): Promise<MediaOcrEntry> {
  const langs = opts.langs || DEFAULT_OCR_LANG;
  // File / Blob はそのまま渡す（アップロード直後など、手元に実体がある経路）。
  // 文字列はプロバイダ内部スキームを解決してから渡す。
  const input =
    typeof source === "string" ? await resolveMediaUrl(source) : source;
  if (!input) throw new Error("画像を解決できませんでした");

  const { text, confidence } = await recognizeImage(input, {
    langs,
    onProgress: opts.onProgress,
  });

  return {
    text: text.trim(),
    confidence,
    lang: langs,
    extractedAt: new Date().toISOString(),
  };
}
