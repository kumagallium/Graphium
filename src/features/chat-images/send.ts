// 送信時の組み立て（ノートのチャット・ノートなしのチャット共通）。
// 画像が 1 枚も無い会話は、これまでどおり content を文字列のまま送る。

import { recognizeImage } from "../../lib/ocr";
import { getActiveProvider } from "../../lib/storage/registry";
import type { AgentChatMessage } from "../ai-assistant/api";
import { resolveChatModelAcceptsImages } from "./model-capability";
import { buildModelMessages, type TurnWithImages } from "./model-content";
import { loadChatImage } from "./storage";

export async function buildChatModelMessages(turns: readonly TurnWithImages[]): Promise<AgentChatMessage[]> {
  if (!turns.some((t) => t.role === "user" && (t.images?.length ?? 0) > 0)) {
    return turns.map((t) => ({ role: t.role, content: t.content }));
  }
  const provider = getActiveProvider();
  const acceptsImages = await resolveChatModelAcceptsImages();
  return buildModelMessages(turns, {
    acceptsImages,
    loadImage: (ref) => loadChatImage(provider, ref),
    // 画像は端末内だけで読む（Tesseract。画像そのものは外へ出さない）
    readText: async (dataUrl) => (await recognizeImage(dataUrl)).text,
  });
}
