import { describe, it, expect } from "vitest";
import {
  getInsightTestClaims,
  getInsightTestReference,
  restatementScore,
  getLastInsightTestResult,
  setLastInsightTestResult,
  summarizeInsightTest,
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
    expect(refs.some((r) => r.foldsClaimNumbers.length >= 2)).toBe(true);
    for (const r of refs) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it.each(["ja", "en"])("%s: 参考例の折り畳み番号は実在する知見番号を指し、知見 6（一回性）はどの例にも畳まれない", (locale) => {
    const claimCount = getInsightTestClaims(locale).length;
    const folded = new Set<number>();
    for (const r of getInsightTestReference(locale)) {
      for (const n of r.foldsClaimNumbers) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(claimCount);
        folded.add(n);
      }
    }
    expect(folded.has(6)).toBe(false);
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

describe("summarizeInsightTest（目視検証を軽くする 1 行サマリ）", () => {
  const mk = (sourceNumbers: number[], restatement = 0) => ({
    title: "t", body: "b", sourceTitles: [], sourceNumbers, restatement,
  });

  it("折り畳み数・言い換え数・視野・一回性引用を集計する", () => {
    const s = summarizeInsightTest([
      mk([1, 2]),          // 折り畳み
      mk([3, 4]),          // 折り畳み
      mk([5], 0.9),        // 単独 + 言い換え
      mk([6]),             // 一回性を引用
    ]);
    expect(s.foldCount).toBe(2);
    expect(s.restatementCount).toBe(1);
    expect(s.coveredNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.citesOneOffFact).toBe(true);
  });

  it("空の候補では全部ゼロ", () => {
    const s = summarizeInsightTest([]);
    expect(s.foldCount).toBe(0);
    expect(s.restatementCount).toBe(0);
    expect(s.coveredNumbers).toEqual([]);
    expect(s.citesOneOffFact).toBe(false);
  });
});

describe("直近結果のメモリキャッシュ（モーダル unmount をまたぐ復元用）", () => {
  it("set → get で往復し、null でクリアできる", () => {
    const result = { candidates: [], model: "test-model" };
    setLastInsightTestResult(result);
    expect(getLastInsightTestResult()).toBe(result);
    setLastInsightTestResult(null);
    expect(getLastInsightTestResult()).toBeNull();
  });
});
