import { describe, it, expect } from "vitest";
import { conversationSearchChunks, conversationsInSearchBudget } from "./conversation-chunks";

const BODY = [
  "この資料は、私（利用者）と AI（Claude Code）の会話の記録である。",
  "",
  "## 2026-10-05",
  "",
  "- AI（直前の返答の抜粋）: ライ麦サワー種は温度に敏感です",
  "- 私（09:12）: 酸味は控えめにしたいので、6 時間で止めます",
  "  生地は 24 度で置きます",
  "",
  "## 2026-10-06",
  "",
  "- 私（09:20、/review）: 焼き時間を見直して",
].join("\n");

describe("conversationSearchChunks", () => {
  it("発言の文字が断片に入り、日付は見出しになる", () => {
    const chunks = conversationSearchChunks(BODY);
    expect(chunks.map((c) => c.heading)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(chunks[0].text).toContain("酸味は控えめにしたい");
    expect(chunks[0].text).toContain("生地は 24 度で置きます");
    expect(chunks[0].text).toContain("ライ麦サワー種");
    expect(chunks[1].text).toContain("焼き時間を見直して");
  });

  it("冒頭の説明と発言の見出しは入らない（どの会話にも当たる語を作らない）", () => {
    const all = conversationSearchChunks(BODY).map((c) => c.text).join("\n");
    expect(all).not.toContain("この資料は");
    expect(all).not.toContain("私（");
    expect(all).not.toContain("09:12");
    expect(all).not.toContain("/review");
  });

  it("id は通し番号で、日をまたいでも重ならない", () => {
    expect(conversationSearchChunks(BODY).map((c) => c.chunkId)).toEqual(["c0", "c1"]);
  });

  it("長い発言は複数の断片に分かれる", () => {
    const long = `## 2026-10-05\n\n- 私（09:12）: ${"全粒粉は 2 割までにする。".repeat(200)}`;
    expect(conversationSearchChunks(long).length).toBeGreaterThan(1);
  });

  it("説明だけ・空の本文では断片を作らない", () => {
    expect(conversationSearchChunks("説明だけ")).toEqual([]);
    expect(conversationSearchChunks("")).toEqual([]);
  });
});

describe("conversationsInSearchBudget", () => {
  const conv = (fileId: string, endedAt: string, bodyChars: number, over: Record<string, unknown> = {}) => ({
    fileId,
    type: "conversation",
    conversation: { endedAt, bodyChars },
    ...over,
  });

  it("新しい会話から上限まで選ぶ", () => {
    const set = conversationsInSearchBudget(
      [conv("old", "2026-01-01", 40), conv("new", "2026-03-01", 40), conv("mid", "2026-02-01", 40)],
      100,
    );
    expect([...set].sort()).toEqual(["mid", "new"]);
  });

  it("アーカイブ済みとほかの種類は数えない", () => {
    const set = conversationsInSearchBudget(
      [conv("a", "2026-03-01", 90, { archivedAt: "x" }), { fileId: "p", type: "pdf" }, conv("b", "2026-02-01", 90)],
      100,
    );
    expect([...set]).toEqual(["b"]);
  });

  it("上限ちょうどまでは入る", () => {
    expect(conversationsInSearchBudget([conv("a", "2026-03-01", 100)], 100).has("a")).toBe(true);
  });
});
