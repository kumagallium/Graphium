// AI との会話の本文を、探すための断片にする。
//
// 本文（renderConversationBody の出力）の冒頭の説明と、発言の見出し（「私（09:12）」など）は
// 入れない。どの会話にも同じ文字が並ぶので、「資料」「私」のような語で全部の会話に当たってしまう。
// 日付は断片の見出しとして持つ（本文の語にはしない）。

import { parseConversationBody } from "../asset-browser/conversation-body";
import { chunkPlainText, type TextChunk } from "./chunk";

/**
 * 本文を索引に載せる会話の字数の上限（新しい会話から数える）。
 * 実測（2026-11-19、JavaScriptCore）で本文 195 万字あたり生きているメモリが約 66 MB 増えた。
 * 全文の索引は起動のたびに読み戻すので、取り込む量が桁で増えても画面のメモリが膨らまないようにする
 * （この上限で約 340 MB）。上限の外の会話も、名前では見つかり、開いて読める。
 */
export const CONVERSATION_SEARCH_MAX_BODY_CHARS = 10_000_000;

type ConversationBudgetEntry = {
  fileId: string;
  archivedAt?: string;
  conversation?: { endedAt?: string; startedAt?: string; bodyChars?: number };
};

/** 本文を索引に載せる会話の id（アーカイブを除き、新しい会話から上限まで） */
export function conversationsInSearchBudget(
  entries: Iterable<ConversationBudgetEntry & { type: string }>,
  maxChars: number = CONVERSATION_SEARCH_MAX_BODY_CHARS,
): Set<string> {
  const conversations: ConversationBudgetEntry[] = [];
  for (const e of entries) if (e.type === "conversation" && !e.archivedAt) conversations.push(e);
  const at = (e: ConversationBudgetEntry) => e.conversation?.endedAt || e.conversation?.startedAt || "";
  conversations.sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
  const out = new Set<string>();
  let total = 0;
  for (const e of conversations) {
    total += e.conversation?.bodyChars ?? 0;
    if (total > maxChars) break;
    out.add(e.fileId);
  }
  return out;
}

export function conversationSearchChunks(body: string): TextChunk[] {
  const out: TextChunk[] = [];
  let date: string | undefined;
  let turns: string[] = [];
  const flush = () => {
    if (turns.length === 0) return;
    for (const c of chunkPlainText(turns.join("\n\n"))) {
      out.push({ chunkId: `c${out.length}`, text: c.text, ...(date ? { heading: date } : {}) });
    }
    turns = [];
  };
  for (const block of parseConversationBody(body)) {
    if (block.kind === "date") {
      flush();
      date = block.text;
    } else if (block.kind === "turn" && block.body.trim()) {
      turns.push(block.body);
    }
  }
  flush();
  return out;
}
