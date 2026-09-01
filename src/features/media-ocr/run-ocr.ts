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
import { isLocalMediaRef } from "../asset-browser/local-media-ref";
import type { MediaOcrEntry } from "../../lib/document-types";

/**
 * プロバイダ内部スキームの URL を、fetch / <img src> で読める URL に解決する。
 * データ URL・blob URL はそのまま返す。
 *
 * 外部ホストの URL は空文字を返して読み取りを止める。Tesseract は渡された文字列を
 * 自分で fetch するので、そのまま渡すと本文のブロックが描画をブロックしていても
 * OCR 経由でその URL へ要求が出てしまう（ブロックの描画とは別経路）。
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!url) return "";
  const provider = getActiveProvider();
  const fileId = provider.extractFileId(url);
  if (fileId) return provider.getMediaBlobUrl(fileId);
  return isLocalMediaRef(url) ? url : "";
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
