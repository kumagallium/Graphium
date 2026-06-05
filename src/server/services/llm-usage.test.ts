// recalculateUsageCosts のユニットテスト
//
// 単価を後から修正したとき、過去の raw event の cost を最新単価で
// 計算し直せること／単価が引けない event は据え置くことを検証する。

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setServerMode } from "../config/models.js";
import {
  recordUsage,
  recalculateUsageCosts,
  loadUsageLog,
  setUsageDataDir,
} from "./llm-usage.js";

describe("recalculateUsageCosts", () => {
  beforeEach(() => {
    setServerMode("node");
    setUsageDataDir(mkdtempSync(join(tmpdir(), "usage-recalc-")));
  });

  it("現在の単価で cost を計算し直して上書きする", () => {
    recordUsage({
      ts: "2026-06-01T00:00:00.000Z",
      feature: "agent.chat",
      provider: "anthropic",
      modelId: "claude-x",
      modelConfigId: "m1",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
      rateSnapshot: { input: 1, output: 1, currency: "usd" },
    });
    // 記録時: (1M/1M)*1 + (1M/1M)*1 = 2
    expect(loadUsageLog()[0].cost).toBeCloseTo(2);

    const result = recalculateUsageCosts((ev) =>
      ev.modelConfigId === "m1" ? { input: 10, output: 20, currency: "usd" } : undefined,
    );

    expect(result.total).toBe(1);
    expect(result.recalculated).toBe(1);
    expect(result.skipped).toBe(0);
    // 再計算後: (1M/1M)*10 + (1M/1M)*20 = 30
    const ev = loadUsageLog()[0];
    expect(ev.cost).toBeCloseTo(30);
    expect(ev.costCurrency).toBe("usd");
    expect(ev.rateSnapshot).toEqual({ input: 10, output: 20, currency: "usd" });
    // tokens は保持される
    expect(ev.inputTokens).toBe(1_000_000);
    expect(ev.outputTokens).toBe(1_000_000);
  });

  it("単価が引けない event はスキップして cost を据え置く", () => {
    recordUsage({
      ts: "2026-06-01T00:00:00.000Z",
      feature: "agent.chat",
      provider: "anthropic",
      modelId: "claude-x",
      modelConfigId: "deleted",
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      rateSnapshot: { input: 5, output: 5, currency: "usd" },
    });
    const before = loadUsageLog()[0].cost;

    const result = recalculateUsageCosts(() => undefined);

    expect(result.recalculated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(loadUsageLog()[0].cost).toBe(before);
  });

  it("modelConfigId が header-injected でも provider+modelId で単価を引ける", () => {
    // Web / header 経由の呼び出しは modelConfigId が "header-injected" になり、
    // 記録時に単価未設定なら cost も付かない。後から単価を設定したケースを再現。
    recordUsage({
      ts: "2026-06-01T00:00:00.000Z",
      feature: "agent.chat",
      provider: "openai-compatible",
      modelId: "gpt-oss-120b",
      modelConfigId: "header-injected",
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      // rateSnapshot なし → cost なしで記録される
    });
    expect(loadUsageLog()[0].cost).toBeUndefined();

    const models = [
      {
        provider: "openai-compatible",
        modelId: "gpt-oss-120b",
        rate: { input: 2, output: 4, currency: "usd" as const },
      },
    ];
    const result = recalculateUsageCosts((ev) => {
      // header-injected は id 一致しない想定 → provider+modelId で引く
      return models.find((m) => m.provider === ev.provider && m.modelId === ev.modelId)?.rate;
    });

    expect(result.recalculated).toBe(1);
    // 1M input * 2 = 2
    expect(loadUsageLog()[0].cost).toBeCloseTo(2);
  });

  it("通貨を JPY に直すと costCurrency も追従する", () => {
    recordUsage({
      ts: "2026-06-01T00:00:00.000Z",
      feature: "wiki.ingest",
      provider: "openai",
      modelId: "gpt-x",
      modelConfigId: "m2",
      inputTokens: 2_000_000,
      outputTokens: 0,
      totalTokens: 2_000_000,
      rateSnapshot: { input: 1, output: 1, currency: "usd" },
    });

    recalculateUsageCosts((ev) =>
      ev.modelConfigId === "m2" ? { input: 150, output: 300, currency: "jpy" } : undefined,
    );

    const ev = loadUsageLog()[0];
    // (2M/1M)*150 = 300 JPY
    expect(ev.cost).toBeCloseTo(300);
    expect(ev.costCurrency).toBe("jpy");
  });
});
