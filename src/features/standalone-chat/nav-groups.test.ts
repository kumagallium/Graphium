import { describe, expect, it } from "vitest";
import { classifyChatDate, groupChatsByDate } from "./nav-groups";
import type { StandaloneChatSummary } from "./types";

// 2026-10-26 15:00 ローカル時刻を「今」とする
const now = new Date(2026, 9, 26, 15, 0, 0);

function chat(id: string, modifiedAt: Date): StandaloneChatSummary {
  return { id, firstQuestion: id, messageCount: 2, modifiedAt: modifiedAt.toISOString() };
}

describe("classifyChatDate", () => {
  it("今日の 0 時以降は today", () => {
    expect(classifyChatDate(new Date(2026, 9, 26, 0, 0).toISOString(), now)).toBe("today");
    expect(classifyChatDate(new Date(2026, 9, 26, 14, 59).toISOString(), now)).toBe("today");
  });

  it("昨日の 0 時〜今日の 0 時直前は yesterday", () => {
    expect(classifyChatDate(new Date(2026, 9, 25, 23, 59).toISOString(), now)).toBe("yesterday");
    expect(classifyChatDate(new Date(2026, 9, 25, 0, 0).toISOString(), now)).toBe("yesterday");
  });

  it("過去 7 日（今日の 0 時から 7 日前まで）は week", () => {
    expect(classifyChatDate(new Date(2026, 9, 24, 12, 0).toISOString(), now)).toBe("week");
    expect(classifyChatDate(new Date(2026, 9, 19, 0, 0).toISOString(), now)).toBe("week");
  });

  it("それより前と壊れた日付は older", () => {
    expect(classifyChatDate(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe("older");
    expect(classifyChatDate("not-a-date", now)).toBe("older");
  });
});

describe("groupChatsByDate", () => {
  it("4 段の順に並び、空のグループは出さない", () => {
    const groups = groupChatsByDate(
      [chat("old", new Date(2026, 8, 1)), chat("today", new Date(2026, 9, 26, 9, 0)), chat("week", new Date(2026, 9, 22))],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(["today", "week", "older"]);
    expect(groups[0].chats.map((c) => c.id)).toEqual(["today"]);
  });

  it("グループ内の順番は入力の順を保つ（索引は更新日時の降順で来る）", () => {
    const groups = groupChatsByDate(
      [chat("a", new Date(2026, 9, 26, 12, 0)), chat("b", new Date(2026, 9, 26, 9, 0))],
      now,
    );
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("0 件なら空配列", () => {
    expect(groupChatsByDate([], now)).toEqual([]);
  });
});
