// 画像付きのメッセージを、AI に送るメッセージの形に組み立てる。
//
// - 画像を読めるモデル: content を [text, image, image…] のパート配列にする
// - 読めないモデル: 画像は送らず、端末内 OCR で読んだ文字を本文の後ろに添える
//   （会話は止めない。入力欄には送る前にそう出している）
// - 履歴の画像は新しいものから MAX_HISTORY_IMAGES 枚まで。古い画像は「前に貼った画像」
//   の注記だけ残す（毎ターン全部を送り直すと会話が伸びるほど重くなる）

import type { ChatImageRef } from "../../lib/document-types";
import { dataUrlBase64 } from "./encode";

/** 1 回の送信で AI に見せる画像の上限（履歴を含む） */
export const MAX_HISTORY_IMAGES = 8;

export type ModelContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string };

export type ModelMessage = {
  role: "user" | "assistant";
  content: string | ModelContentPart[];
};

export type TurnWithImages = {
  role: "user" | "assistant";
  /** AI に渡す本文（添付ノートの展開などを済ませたもの） */
  content: string;
  images?: ChatImageRef[];
};

export type BuildDeps = {
  acceptsImages: boolean;
  /** 参照 → data URL。手元に無ければ null */
  loadImage: (ref: string) => Promise<string | null>;
  /** data URL → 読み取った文字（読めないモデル向け）。失敗は例外 */
  readText: (dataUrl: string) => Promise<string>;
};

/** 読み取った文字の置き場（同じ画像を毎ターン読み直さない）。読み取りに失敗した分は入れない */
const ocrCache = new Map<string, string>();

function imageLabel(n: number, img: ChatImageRef): string {
  return img.name ? `Image ${n} (${img.name})` : `Image ${n}`;
}

/**
 * 会話（最新の user メッセージを含む）を AI に送る形にする。
 * 画像の無いメッセージは content を文字列のまま返す（従来の送信と同じ形）。
 */
export async function buildModelMessages(
  turns: readonly TurnWithImages[],
  deps: BuildDeps,
): Promise<ModelMessage[]> {
  // 新しい方から数えて MAX_HISTORY_IMAGES 枚に入る画像だけを送る
  const sendable = new Set<string>();
  let budget = MAX_HISTORY_IMAGES;
  for (let i = turns.length - 1; i >= 0 && budget > 0; i--) {
    const imgs = turns[i].images ?? [];
    for (let j = imgs.length - 1; j >= 0 && budget > 0; j--) {
      sendable.add(`${i}:${j}`);
      budget--;
    }
  }

  const out: ModelMessage[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const imgs = turn.role === "user" ? turn.images ?? [] : [];
    if (imgs.length === 0) {
      out.push({ role: turn.role, content: turn.content });
      continue;
    }
    const notes: string[] = [];
    const parts: ModelContentPart[] = [];
    for (let j = 0; j < imgs.length; j++) {
      const img = imgs[j];
      const label = imageLabel(j + 1, img);
      if (!sendable.has(`${i}:${j}`)) {
        notes.push(`[${label}: shown earlier in the conversation, not sent again]`);
        continue;
      }
      const dataUrl = await deps.loadImage(img.ref);
      if (!dataUrl) {
        notes.push(`[${label}: attached by the user but not available on this device]`);
        continue;
      }
      if (deps.acceptsImages) {
        parts.push({ type: "image", image: dataUrlBase64(dataUrl), mediaType: img.mimeType });
        continue;
      }
      let text = ocrCache.get(img.ref);
      if (text === undefined) {
        try {
          text = (await deps.readText(dataUrl)).trim();
          ocrCache.set(img.ref, text);
        } catch {
          // 読み取りの失敗（時間切れ・エンジンを起動できない）は覚えない。次のターンで読み直す
          notes.push(`[${label}: the AI model in use cannot see images, and reading its text on the device failed this time]`);
          continue;
        }
      }
      notes.push(
        text
          ? `[${label}: the AI model in use cannot see images, so this is the text read from it on the user's device]\n"""\n${text}\n"""`
          : `[${label}: the AI model in use cannot see images, and no text could be read from it]`,
      );
    }
    const body = notes.length > 0 ? `${turn.content}\n\n${notes.join("\n\n")}` : turn.content;
    out.push(parts.length > 0 ? { role: turn.role, content: [{ type: "text", text: body }, ...parts] } : { role: turn.role, content: body });
  }
  return out;
}

/** テスト用 */
export function clearOcrCacheForTest(): void {
  ocrCache.clear();
}
