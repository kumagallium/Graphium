import { describe, expect, it } from "vitest";
import {
  AI_USAGE_MAX_EVENTS_PER_FILE,
  appendUsageEvents,
  buildUsageEvents,
  isAiUsageFile,
  refsFromCitedTitles,
  toUsageRef,
  usageDateStamp,
  usageKey,
} from "./usage-log";

describe("usageKey", () => {
  it("UTC の日付・書き手・セッションで、appData のキーに使える形になる", () => {
    const key = usageKey(new Date("2026-11-08T23:30:00Z"), "mcp", "ab12cd34ef56");
    expect(key).toBe("ai-usage-20261108-mcp-ab12cd34ef56");
    expect(key).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
  });

  it("セッション ID の使えない文字は落とす", () => {
    expect(usageKey(new Date("2026-01-02T00:00:00Z"), "app", "a:b/c.d")).toBe("ai-usage-20260102-app-abcd");
    expect(usageKey(new Date("2026-01-02T00:00:00Z"), "app", "::")).toBe("ai-usage-20260102-app-x");
  });

  it("日付は UTC で切る", () => {
    expect(usageDateStamp(new Date("2026-12-31T23:59:59Z"))).toBe("20261231");
  });
});

describe("toUsageRef / refsFromCitedTitles", () => {
  it("retriever の参照を種類つきの ref に直す", () => {
    expect(toUsageRef("abc")).toBe("wiki:abc");
    expect(toUsageRef("note:n1")).toBe("note:n1");
    expect(toUsageRef("asset:f1")).toBe("asset:f1");
    expect(toUsageRef("shared:s1")).toBe("shared:s1");
    expect(toUsageRef("note:")).toBeNull();
    expect(toUsageRef("unknown:x")).toBeNull();
    expect(toUsageRef("  ")).toBeNull();
  });

  it("引けない題名は落とし、同じ参照は 1 つにする", () => {
    const map = new Map([
      ["知見 A", "w1"],
      ["ノート B", "note:n2"],
      ["知見 A の別名", "w1"],
    ]);
    expect(refsFromCitedTitles(["知見 A", "無い題", "ノート B", "知見 A の別名"], map)).toEqual([
      "wiki:w1",
      "note:n2",
    ]);
  });
});

describe("appendUsageEvents", () => {
  const meta = { writer: "app" as const, session: "s1" };
  const at = new Date("2026-11-08T01:02:03Z");

  it("無いところから作る", () => {
    const f = appendUsageEvents(null, buildUsageEvents(["wiki:a", "note:b"], "cite", "g1", at), meta);
    expect(f).toEqual({
      version: 1,
      writer: "app",
      session: "s1",
      events: [
        { t: "2026-11-08T01:02:03.000Z", ev: "cite", ref: "wiki:a", g: "g1" },
        { t: "2026-11-08T01:02:03.000Z", ev: "cite", ref: "note:b", g: "g1" },
      ],
    });
    expect(isAiUsageFile(f)).toBe(true);
  });

  it("既存に足す。クライアント名は覚えておく", () => {
    const m = { writer: "mcp" as const, session: "s2" };
    const first = appendUsageEvents(null, buildUsageEvents(["wiki:a"], "read", "g", at), { ...m, client: "claude-code" });
    const second = appendUsageEvents(first, buildUsageEvents(["wiki:b"], "read", "g", at), m);
    expect(second.events.map((e) => e.ref)).toEqual(["wiki:a", "wiki:b"]);
    expect(second.client).toBe("claude-code");
  });

  it("壊れている・別のセッションのものは作り直す", () => {
    const events = buildUsageEvents(["wiki:a"], "cite", "g", at);
    expect(appendUsageEvents({ junk: true }, events, meta).events).toHaveLength(1);
    const other = appendUsageEvents(null, events, { writer: "app", session: "other" });
    expect(appendUsageEvents(other, events, meta).events).toHaveLength(1);
  });

  it("上限を超えたら古い方から捨てる", () => {
    const many = Array.from({ length: AI_USAGE_MAX_EVENTS_PER_FILE }, (_, i) => `wiki:${i}`);
    const full = appendUsageEvents(null, buildUsageEvents(many, "cite", "g", at), meta);
    const next = appendUsageEvents(full, buildUsageEvents(["wiki:new"], "cite", "g", at), meta);
    expect(next.events).toHaveLength(AI_USAGE_MAX_EVENTS_PER_FILE);
    expect(next.events[0].ref).toBe("wiki:1");
    expect(next.events[next.events.length - 1].ref).toBe("wiki:new");
  });
});
