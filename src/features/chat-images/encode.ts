// チャットに貼った画像を、AI に送る形（縮小した JPEG の data URL）にする。
//
// - 長辺 CHAT_IMAGE_MAX_EDGE に縮める。各社とも長辺 1568px 前後を超えると内部で縮小
//   するだけでトークンが増えるので、送る前に揃える（Anthropic の推奨値に合わせた）
// - 形式は JPEG に揃える。WebP・PNG はプロバイダ（特に OpenAI 互換・Copilot）に
//   よって受けないことがあり、PNG はスクリーンショット以外で肥大しやすい
// - 透過は白で塗ってから描く（JPEG に透過は無く、黒く潰れると図が読めない）
// - 再エンコードを挟むので EXIF（撮影位置など）も落ちる

/** 縮小後の長辺（px） */
export const CHAT_IMAGE_MAX_EDGE = 1568;

/** 1 通に添えられる枚数の上限 */
export const MAX_IMAGES_PER_MESSAGE = 4;

/** デコード前に断る元画像の大きさ。巨大な画像のデコードで固まらせない */
export const MAX_CHAT_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;

const JPEG_QUALITY = 0.85;

export type EncodedChatImage = {
  dataUrl: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

export type EncodeFailure = "not-image" | "too-large" | "unreadable";

/** 画像ファイルとして受け付けるか（SVG は描画にスクリプトを含められるので断る） */
export function isAcceptableImageFile(file: { type: string }): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.type);
}

/**
 * 画像を縮小して JPEG の data URL にする。
 * createImageBitmap / canvas が無い環境（jsdom）では "unreadable" を返す。
 */
export async function encodeChatImage(
  file: Blob,
): Promise<EncodedChatImage | EncodeFailure> {
  if (!isAcceptableImageFile(file)) return "not-image";
  if (file.size > MAX_CHAT_IMAGE_SOURCE_BYTES) return "too-large";
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return "unreadable";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "unreadable"; // HEIC を描けない環境・壊れた画像
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest === 0) return "unreadable";
    const scale = Math.min(1, CHAT_IMAGE_MAX_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "unreadable";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!dataUrl.startsWith("data:image/jpeg")) return "unreadable";
    return { dataUrl, mimeType: "image/jpeg", width, height };
  } catch {
    return "unreadable";
  } finally {
    bitmap.close?.();
  }
}

/** data URL から base64 の本体を取り出す（AI SDK の image パートに渡す形） */
export function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}
