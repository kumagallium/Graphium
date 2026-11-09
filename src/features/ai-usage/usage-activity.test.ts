import { describe, expect, it } from "vitest";
import { computeUsageActivity, loadUsageActivity, pickUsageKeys, usageRefToGraphId } from "./usage-activity";
import type { AiUsageFile } from "./usage-log";

const now = new Date("2026-11-20T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
const file = (events: AiUsageFile["events"]): AiUsageFile => ({ version: 1, writer: "app", session: "s", events });

describe("usageRefToGraphId", () => {
  it("ノート・知見は ID そのまま、素材は media:、共有と壊れた参照は null", () => {
    expect(usageRefToGraphId("wiki:w1")).toBe("w1");
    expect(usageRefToGraphId("note:n1")).toBe("n1");
    expect(usageRefToGraphId("asset:f1")).toBe("media:f1");
    expect(usageRefToGraphId("shared:s1")).toBeNull();
    expect(usageRefToGraphId("note:")).toBeNull();
    expect(usageRefToGraphId("w1")).toBeNull();
  });
});

describe("pickUsageKeys", () => {
  it("範囲内の日付だけを新しい順に、上限まで選ぶ", () => {
    const keys = [
      "ai-usage-20261119-app-a",
      "ai-usage-20261001-app-old",
      "ai-usage-20261120-mcp-b",
      "ai-usage-bad",
      "other-20261120-x",
    ];
    expect(pickUsageKeys(keys, now)).toEqual(["ai-usage-20261120-mcp-b", "ai-usage-20261119-app-a"]);
    expect(pickUsageKeys(keys, now, 30, 1)).toEqual(["ai-usage-20261120-mcp-b"]);
  });
});

describe("computeUsageActivity", () => {
  it("7 日で半分に薄れ、一番強いページが 1 になる", () => {
    const w = computeUsageActivity(
      [
        file([
          { t: daysAgo(0), ev: "cite", ref: "wiki:fresh", g: "g" },
          { t: daysAgo(7), ev: "cite", ref: "wiki:week", g: "g" },
        ]),
      ],
      now,
    );
    expect(w.get("fresh")).toBeCloseTo(1);
    expect(w.get("week")).toBeCloseTo(0.5);
  });

  it("引用は開いただけより重く、回数は足し合わせる。範囲外・共有・壊れた時刻は数えない", () => {
    const w = computeUsageActivity(
      [
        file([
          { t: daysAgo(0), ev: "cite", ref: "note:a", g: "g" },
          { t: daysAgo(0), ev: "cite", ref: "note:a", g: "h" },
          { t: daysAgo(0), ev: "read", ref: "note:b", g: "g" },
          { t: daysAgo(40), ev: "cite", ref: "note:old", g: "g" },
          { t: daysAgo(0), ev: "cite", ref: "shared:s", g: "g" },
          { t: "not-a-date", ev: "cite", ref: "note:x", g: "g" },
        ]),
      ],
      now,
    );
    expect(w.get("a")).toBeCloseTo(1);
    expect(w.get("b")).toBeCloseTo(0.3);
    expect(w.has("old")).toBe(false);
    expect(w.size).toBe(2);
  });

  it("記録が無ければ空", () => {
    expect(computeUsageActivity([], now).size).toBe(0);
  });
});

describe("loadUsageActivity", () => {
  it("appData を持たない保存先・壊れたファイル・読めないファイルは飛ばす", async () => {
    expect((await loadUsageActivity({}, now)).size).toBe(0);
    const store: Record<string, unknown> = {
      "ai-usage-20261120-app-a": file([{ t: daysAgo(0), ev: "cite", ref: "wiki:w", g: "g" }]),
      "ai-usage-20261120-app-broken": { junk: true },
      "ai-usage-20261120-app-throws": null,
    };
    const w = await loadUsageActivity(
      {
        listAppDataKeys: async () => Object.keys(store),
        readAppData: async (k: string) => {
          if (k.endsWith("throws")) throw new Error("boom");
          return store[k] ?? null;
        },
      },
      now,
    );
    expect([...w.keys()]).toEqual(["w"]);
  });
});
