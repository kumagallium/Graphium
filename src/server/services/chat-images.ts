// チャットに添えられた画像パートの受け口（/agent/run）。
//
// - 受け付けるのは user メッセージの base64 の画像だけ。URL は通さない
//   （AI SDK は URL を見るとサーバーから取りに行くため、任意の宛先へ要求が出てしまう）
// - 枚数・大きさに上限を付ける（クライアントは縮小して送るので、普段は当たらない）
// - 画像を読めないモデルには、画像の代わりに短い注記を本文に添える
//   （クライアントは送る前に端末内 OCR の文字へ置き換えているので、ここに来るのは
//   判定がずれたときの保険）

import type { ModelMessage } from "ai";

/** 1 回の送信で受け付ける画像の枚数（クライアントの MAX_HISTORY_IMAGES と同じ） */
export const MAX_REQUEST_IMAGES = 8;
/** 1 枚の base64 の長さの上限（約 6MB のバイト列） */
export const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;

const IMAGE_MEDIA_TYPE_RE = /^image\/(jpeg|png|gif|webp)$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

type Part = { type: string; [k: string]: unknown };

function isAcceptableImagePart(part: Part): boolean {
  const image = part.image;
  const mediaType = part.mediaType;
  return (
    typeof image === "string" &&
    image.length > 0 &&
    image.length <= MAX_IMAGE_BASE64_LENGTH &&
    BASE64_RE.test(image) &&
    typeof mediaType === "string" &&
    IMAGE_MEDIA_TYPE_RE.test(mediaType)
  );
}

/**
 * 受け取った messages の画像パートを確かめて整える。
 * 画像を含まない messages はそのまま返す（従来の送信と同じ）。
 */
export function prepareChatImages(messages: ModelMessage[], acceptsImages: boolean): ModelMessage[] {
  let remaining = MAX_REQUEST_IMAGES;
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    if (m.role !== "user") {
      // チャットは user 以外を文字列でしか送らない。パート配列で来たら文字だけを残す
      // （URL を含みうるパートを AI SDK に渡さない）
      if (!Array.isArray(m.content)) return m;
      const text = (m.content as unknown as Part[])
        .filter((p) => p.type === "text")
        .map((p) => String(p.text ?? ""))
        .join("\n\n");
      return { role: m.role, content: text } as unknown as ModelMessage;
    }
    if (!Array.isArray(m.content)) return m;
    const parts: Part[] = [];
    const notes: string[] = [];
    for (const part of m.content as unknown as Part[]) {
      if (part.type === "text") {
        parts.push({ type: "text", text: String(part.text ?? "") });
        continue;
      }
      if (part.type !== "image") continue; // file など、チャットが送らない形は落とす
      if (!isAcceptableImagePart(part) || remaining <= 0) {
        notes.push("[An image was attached but could not be passed to the model]");
        continue;
      }
      if (!acceptsImages) {
        notes.push("[An image was attached, but the AI model in use cannot see images]");
        continue;
      }
      remaining--;
      parts.push({ type: "image", image: part.image, mediaType: part.mediaType });
    }
    if (notes.length > 0) parts.push({ type: "text", text: notes.join("\n") });
    // 画像が 1 枚も残らなければ文字列に戻す（テキストだけのプロバイダ経路でも確実に通る形）
    if (!parts.some((p) => p.type === "image")) {
      return { role: "user", content: parts.map((p) => String(p.text ?? "")).join("\n\n") };
    }
    return { role: "user", content: parts } as unknown as ModelMessage;
  });
}
