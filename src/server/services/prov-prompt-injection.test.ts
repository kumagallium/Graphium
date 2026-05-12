// 提案 v4 Phase 2.2: PROV → AI Wiki プロンプト注入ヘルパーのユニットテスト
//
// PR-B4.5 で formatProcedureContextForClaimBlock / intersectClaimProcedureContexts
// は削除した（procedureContext を Atom/Synthesis に持たせない設計に変更）。
// 残るは Ingester で使う formatProvSummaryForPrompt のみ。

import { describe, it, expect } from "vitest";
import { formatProvSummaryForPrompt } from "./prov-prompt-injection";

describe("formatProvSummaryForPrompt", () => {
  it("中身が完全に空のサマリは null を返す（user message に prepend しない用）", () => {
    expect(formatProvSummaryForPrompt(undefined)).toBeNull();
    expect(formatProvSummaryForPrompt(null)).toBeNull();
    expect(formatProvSummaryForPrompt({})).toBeNull();
    expect(formatProvSummaryForPrompt({ activities: [], results: [], plan: "" })).toBeNull();
  });

  it("plan のみあるサマリでも null にならず plan を出す", () => {
    const md = formatProvSummaryForPrompt({ plan: "Evaluate Al5Co2 as a thermoelectric." });
    expect(md).toContain("### Plan");
    expect(md).toContain("Evaluate Al5Co2");
  });

  it("Activity と parameters と outputs を整形する", () => {
    const md = formatProvSummaryForPrompt({
      activities: [{
        type: "step",
        label: "機械合金化",
        inputs: ["Al粉末", "Co粉末"],
        tools: ["ボールミル"],
        parameters: [
          { key: "回転数", value: "300rpm", raw: "回転数: 300rpm" },
          { key: "時間", value: "3h", raw: "時間: 3h" },
        ],
        outputs: ["Al5Co2前駆体"],
      }],
    });
    expect(md).toContain("機械合金化");
    expect(md).toContain("inputs: Al粉末, Co粉末");
    expect(md).toContain("tools: ボールミル");
    expect(md).toContain("parameters: 回転数=300rpm, 時間=3h");
    expect(md).toContain("outputs: Al5Co2前駆体");
  });

  it("key 無しの parameter は raw（または value）を採用する", () => {
    const md = formatProvSummaryForPrompt({
      activities: [{
        label: "step",
        parameters: [{ value: "中火", raw: "中火" }],
      }],
    });
    expect(md).toContain("parameters: 中火");
  });

  it("top-level results を attribute 付きで列挙する", () => {
    const md = formatProvSummaryForPrompt({
      results: [
        { property: "ゼーベック係数", attributes: { value: "180μV/K", method: "ZEM-3" } },
        { property: "相純度", attributes: { value: "単相" } },
      ],
    });
    expect(md).toContain("ゼーベック係数 (value=180μV/K, method=ZEM-3)");
    expect(md).toContain("相純度 (value=単相)");
  });

  it("LLM 向けの末尾ガイダンス（procedureContext 埋めて）を必ず含む", () => {
    const md = formatProvSummaryForPrompt({ plan: "x" });
    expect(md).toContain("procedureContext");
  });

  it("不正な型の raw は黙って無視する", () => {
    expect(formatProvSummaryForPrompt(42)).toBeNull();
    expect(formatProvSummaryForPrompt("not an object")).toBeNull();
    expect(formatProvSummaryForPrompt([])).toBeNull(); // 配列は object だが activities/results が無い
  });
});
