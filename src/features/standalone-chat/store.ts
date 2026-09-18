// ノートに紐づかないチャット（standalone chat）の永続化。
//
// StorageProvider.readAppData / writeAppData（3 プロバイダ全実装済みの内部チャネル）を使い、
//   standalone-chat-index      → { version: 1; chats: StandaloneChatSummary[] } （一覧表示用・軽量）
//   standalone-chat:<chatId>   → StandaloneChat                                （全文・開くとき遅延ロード）
// の 2 層で持つ。一覧を出すたびに全会話の本文（messages）を読み込むと、会話数が
// 増えるほど一覧表示が重くなる。索引には表示に要る分（firstQuestion / messageCount 等）
// だけを持たせ、本文は個別の会話を開いたときにだけ読む。

import type { StorageProvider } from "../../lib/storage/types";
import type { StandaloneChat, StandaloneChatSummary } from "./types";

const INDEX_KEY = "standalone-chat-index";
const chatKey = (id: string) => `standalone-chat:${id}`;

type StandaloneChatIndex = {
  version: 1;
  chats: StandaloneChatSummary[];
};

/** 索引を読む。未保存・非対応プロバイダ・壊れた内容はすべて空配列として扱う */
async function readIndex(provider: StorageProvider): Promise<StandaloneChatSummary[]> {
  const raw = await provider.readAppData?.(INDEX_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const index = raw as Partial<StandaloneChatIndex>;
  if (!Array.isArray(index.chats)) return [];
  return index.chats;
}

async function writeIndex(provider: StorageProvider, chats: StandaloneChatSummary[]): Promise<void> {
  if (!provider.writeAppData) return;
  const index: StandaloneChatIndex = { version: 1, chats };
  await provider.writeAppData(INDEX_KEY, chats.length > 0 ? index : null);
}

// 索引は一覧表示のための軽い層。一覧では 1 行に省略表示するだけなので、
// 質問文をそのまま丸ごと持たせると（長文の質問ほど）索引が肥大化する。
// 表示に要らない分は削って軽さを保つ。
const FIRST_QUESTION_MAX_LENGTH = 120;

function truncateFirstQuestion(text: string): string {
  if (text.length <= FIRST_QUESTION_MAX_LENGTH) return text;
  return text.slice(0, FIRST_QUESTION_MAX_LENGTH);
}

/** 索引の行（要約）を本体から導出する */
function summarize(chat: StandaloneChat): StandaloneChatSummary {
  const firstUserMessage = chat.messages.find((m) => m.role === "user");
  return {
    id: chat.id,
    title: chat.title,
    firstQuestion: truncateFirstQuestion(firstUserMessage?.content ?? ""),
    messageCount: chat.messages.length,
    modifiedAt: chat.modifiedAt,
  };
}

/** 一覧を modifiedAt 降順で返す */
export async function loadStandaloneChatIndex(
  provider: StorageProvider,
): Promise<StandaloneChatSummary[]> {
  const chats = await readIndex(provider);
  return chats.slice().sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
}

/** 会話の全文を取得（存在しなければ null） */
export async function loadStandaloneChat(
  provider: StorageProvider,
  id: string,
): Promise<StandaloneChat | null> {
  const raw = await provider.readAppData?.(chatKey(id));
  return raw ? (raw as StandaloneChat) : null;
}

/**
 * 会話を保存する。全文を先に書き、索引の該当行を作り直してから書く
 * （途中失敗しても index が指す全文が必ず存在する状態を保つ）。
 */
export async function saveStandaloneChat(
  provider: StorageProvider,
  chat: StandaloneChat,
): Promise<void> {
  if (!provider.writeAppData) return;
  await provider.writeAppData(chatKey(chat.id), chat);
  const chats = await readIndex(provider);
  const summary = summarize(chat);
  const next = chats.filter((c) => c.id !== chat.id);
  next.push(summary);
  await writeIndex(provider, next);
}

/** 会話を削除する（本体を null で論理削除し、索引から行を落とす） */
export async function deleteStandaloneChat(provider: StorageProvider, id: string): Promise<void> {
  if (!provider.writeAppData) return;
  await provider.writeAppData(chatKey(id), null);
  const chats = await readIndex(provider);
  await writeIndex(provider, chats.filter((c) => c.id !== id));
}

/** 新しい空の会話を作って返す（保存はしない） */
export function createStandaloneChat(attachedNoteIds?: string[]): StandaloneChat {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    messages: [],
    attachedNoteIds,
    createdAt: now,
    modifiedAt: now,
  };
}
