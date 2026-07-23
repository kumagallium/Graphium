// docx 埋め込み画像の「表示可能判定」と「非対応形式の変換」を一元化する。
// import.ts（ノート化）と extract-images.ts（素材抽出）の両方から使う。
// 従来は両ファイルに RENDERABLE_IMAGE_EXTS が重複コピーされていた。

import { convertEmfToImageFile, isEmfMime } from "./emf-to-image";
import { convertTiffToImageFile, isTiffMime } from "./tiff-to-image";

/** ブラウザで表示できる画像 MIME → 拡張子。リスト外は「非対応」として扱う */
export const RENDERABLE_IMAGE_EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

/** ブラウザで表示できる画像か（EMF/WMF/TIFF など `<img>` で映らない形式は false） */
export function isRenderableImageMime(mime: string): boolean {
  return mime.toLowerCase() in RENDERABLE_IMAGE_EXTS;
}

/**
 * ブラウザで表示できない画像形式を、表示可能な File（PNG / SVG）へ変換する。
 * - EMF → PNG（bitmap ラップ型）/ SVG（ベクター型）: emf-to-image.ts
 * - TIFF → PNG: tiff-to-image.ts
 * 対応外の形式・変換失敗は null（呼び出し側は従来どおりスキップする）。
 */
export async function convertNonRenderableImage(
  mime: string,
  buf: ArrayBuffer,
  baseName: string,
): Promise<File | null> {
  if (isEmfMime(mime)) return convertEmfToImageFile(buf, baseName);
  if (isTiffMime(mime)) return convertTiffToImageFile(buf, baseName);
  return null;
}
