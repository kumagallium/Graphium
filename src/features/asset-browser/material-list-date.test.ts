import { describe, it, expect } from "vitest";
import { materialListDate, type ConversationMeta } from "./media-index";

const meta = (over: Partial<ConversationMeta>): ConversationMeta => ({
  provider: "claude-code",
  sessionId: "s",
  workdir: "",
  startedAt: "2026-10-05T00:00:00.000Z",
  endedAt: "2026-10-06T00:00:00.000Z",
  ownTurns: 1,
  ownChars: 1,
  bodyChars: 1,
  importedAt: "2026-11-10T00:00:00.000Z",
  ...over,
});

describe("materialListDate", () => {
  it("AI との会話は会話の最後の日時を出す", () => {
    expect(materialListDate({ uploadedAt: "2026-11-10T00:00:00.000Z", conversation: meta({}) })).toBe("2026-10-06T00:00:00.000Z");
  });
  it("記録に時刻が無い会話は取り込んだ日時に戻る", () => {
    expect(materialListDate({ uploadedAt: "2026-11-10T00:00:00.000Z", conversation: meta({ startedAt: "", endedAt: "" }) })).toBe("2026-11-10T00:00:00.000Z");
  });
  it("ほかの素材は登録した日時のまま", () => {
    expect(materialListDate({ uploadedAt: "2026-11-10T00:00:00.000Z" })).toBe("2026-11-10T00:00:00.000Z");
  });
});
