// wikiLog.formatRecentForLLM のテスト（棚卸し D2）。
// フル点検が「次に調べること」の優先づけに使う「期間で切る」版。
// 件数のしきい値ではなく時間で切る方針なので、期間の境界と並び順・空データを確認する。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { wikiLog } from "./wiki-log";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  // Date だけ偽装する（setTimeout まで偽装すると fake-indexeddb 内部の非同期処理が進まず
  // テストがタイムアウトする）
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("formatRecentForLLM", () => {
  it("期間外のログを含めない・期間内のログだけを含める", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await wikiLog.append("ingest", ["w1"], "8日前の取り込み");

    vi.setSystemTime(new Date("2026-01-08T00:00:00.000Z"));
    await wikiLog.append("ingest", ["w2"], "1日前の取り込み");

    // 「今」を 2026-01-09 とすると、7 日前は 2026-01-02 — 01-01 のログは範囲外
    vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    const text = await wikiLog.formatRecentForLLM(7);

    expect(text).toContain("1日前の取り込み");
    expect(text).not.toContain("8日前の取り込み");
  });

  it("新しい順に並ぶ", async () => {
    vi.setSystemTime(new Date("2026-01-08T00:00:00.000Z"));
    await wikiLog.append("ingest", ["w1"], "先に記録した方");

    vi.setSystemTime(new Date("2026-01-08T12:00:00.000Z"));
    await wikiLog.append("ingest", ["w2"], "後に記録した方");

    vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    const text = await wikiLog.formatRecentForLLM(7);

    const laterIndex = text.indexOf("後に記録した方");
    const earlierIndex = text.indexOf("先に記録した方");
    expect(laterIndex).toBeGreaterThanOrEqual(0);
    expect(laterIndex).toBeLessThan(earlierIndex);
  });

  it("該当ログが無いときは空文字を返す", async () => {
    vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    const text = await wikiLog.formatRecentForLLM(7);
    expect(text).toBe("");
  });
});
