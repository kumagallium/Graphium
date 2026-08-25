import { describe, it, expect } from "vitest";
import {
  getInsightTestClaims,
  getInsightTestReference,
  restatementScore,
  RESTATEMENT_BADGE_THRESHOLD,
  INSIGHT_TEST_ID_PREFIX,
} from "./insight-model-test";

describe("insight-model-test corpus", () => {
  it.each(["ja", "en"])("%s: 6 件・非空・prefix 付きユニーク ID", (locale) => {
    const claims = getInsightTestClaims(locale);
    expect(claims).toHaveLength(6);
    const ids = new Set(claims.map((c) => c.id));
    expect(ids.size).toBe(6);
    for (const c of claims) {
      expect(c.id.startsWith(INSIGHT_TEST_ID_PREFIX)).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(0);
    }
  });

  it("ja と en は同じ ID 集合（ロケール間で構造が対応する）", () => {
    const ja = getInsightTestClaims("ja").map((c) => c.id);
    const en = getInsightTestClaims("en").map((c) => c.id);
    expect(ja).toEqual(en);
  });

  it.each(["ja", "en"])("%s: 参考例は 3 件で、折り畳み（2 件引用）の例を含む", (locale) => {
    const refs = getInsightTestReference(locale);
    expect(refs).toHaveLength(3);
    expect(refs.some((r) => r.foldsClaims >= 2)).toBe(true);
    for (const r of refs) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });
});

describe("restatementScore（言い換え検出 — 表示バッジ専用）", () => {
  const claims = getInsightTestClaims("ja");

  it("元知見と同一のタイトルはしきい値を超える", () => {
    const score = restatementScore(claims[0].title, claims);
    expect(score).toBeGreaterThanOrEqual(RESTATEMENT_BADGE_THRESHOLD);
  });

  it("持ち上がった抽象（参考例のタイトル）はしきい値を下回る", () => {
    for (const r of getInsightTestReference("ja")) {
      expect(restatementScore(r.title, claims)).toBeLessThan(RESTATEMENT_BADGE_THRESHOLD);
    }
  });

  it("無関係な文はほぼ 0", () => {
    expect(restatementScore("量子コンピュータの誤り訂正には冗長性が要る", claims)).toBeLessThan(0.2);
  });
});
