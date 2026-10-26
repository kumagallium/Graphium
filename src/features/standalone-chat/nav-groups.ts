// チャット一覧（子ナビ）の日付グループ分け。
//
// ChatGPT / Claude の履歴と同じく「今日 / 昨日 / 過去 7 日 / それ以前」の 4 段に
// 更新日時（modifiedAt）で振り分ける。日付の境界は端末のローカル時刻の 0 時。
// 並び順は各グループ内で modifiedAt の新しい順（索引は既に降順なので保つだけ）。

import type { StandaloneChatSummary } from "./types";

export type ChatNavGroupKey = "today" | "yesterday" | "week" | "older";

export type ChatNavGroup = {
  key: ChatNavGroupKey;
  chats: StandaloneChatSummary[];
};

const GROUP_ORDER: ChatNavGroupKey[] = ["today", "yesterday", "week", "older"];

/** ローカル時刻でその日の 0 時を返す */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function classifyChatDate(modifiedAt: string, now: Date): ChatNavGroupKey {
  const t = new Date(modifiedAt).getTime();
  if (Number.isNaN(t)) return "older";
  const today = startOfDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  if (t >= today) return "today";
  if (t >= today - dayMs) return "yesterday";
  if (t >= today - 7 * dayMs) return "week";
  return "older";
}

/** 空のグループは返さない（見出しだけが並ばないように） */
export function groupChatsByDate(chats: StandaloneChatSummary[], now: Date = new Date()): ChatNavGroup[] {
  const buckets = new Map<ChatNavGroupKey, StandaloneChatSummary[]>();
  for (const chat of chats) {
    const key = classifyChatDate(chat.modifiedAt, now);
    const list = buckets.get(key);
    if (list) list.push(chat);
    else buckets.set(key, [chat]);
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, chats: buckets.get(key)! }));
}
