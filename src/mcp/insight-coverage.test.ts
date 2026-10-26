import { describe, expect, it } from "vitest";

import { acceptBundle, planInsightBundle, type BundleItem, type InsightCoverage } from "./insight-coverage";

const NOW = new Date("2026-10-27T00:00:00.000Z");

type Item = BundleItem & { topic: string };

const JA_TOPICS = ["焼きなまし", "拡散", "冷却速度", "粒界", "熱伝導", "キャリア移動度", "格子欠陥", "相転移"];
const EN_TOPICS = ["annealing", "diffusion", "cooling", "grain", "thermal", "carrier", "lattice", "phase"];

/** 8 話題 × 15 件 = 120 件。更新は番号が大きいほど新しい */
function corpus(lang: "ja" | "en"): Item[] {
  const topics = lang === "ja" ? JA_TOPICS : EN_TOPICS;
  const out: Item[] = [];
  for (let n = 0; n < 120; n++) {
    const topic = topics[n % topics.length];
    const text =
      lang === "ja"
        ? `${topic}の条件を変えると、${topic}に関する性質が、番号${n}の試料で変わった。`
        : `Changing ${topic} conditions alters the ${topic} behavior in sample number ${n} noticeably.`;
    out.push({ id: `k${n}`, text, topic, modifiedTime: `2026-09-${String(1 + Math.floor(n / 10)).padStart(2, "0")}T${String(n % 10).padStart(2, "0")}:00:00.000Z` });
  }
  return out;
}

/** start → 提出（受理）を繰り返し、最初の巡が終わるまでの start の回数を数える */
function callsToFinishRound(items: Item[], limit: number): number {
  let cov: InsightCoverage | null = null;
  for (let call = 1; call <= 30; call++) {
    const plan = planInsightBundle(items, cov, { now: NOW, limit, taskId: `t${call}` })!;
    if (plan.coverage.round > 1) return call - 1;
    cov = acceptBundle(plan.coverage, `t${call}`);
    if (cov.covered.length >= items.length) return call;
  }
  return 99;
}

describe.each(["ja", "en"] as const)("planInsightBundle（%s）", (lang) => {
  const items = corpus(lang);

  it("数回で一巡する（未提出の知見を優先して埋めるので 120 件 / 50 件束 = 3 回）", () => {
    expect(callsToFinishRound(items, 50)).toBeLessThanOrEqual(3);
  });

  it("束は類似した話題でまとまる（シードと同じ話題が束の大半を占める）", () => {
    const plan = planInsightBundle(items, null, { now: NOW, limit: 50, taskId: "t1" })!;
    const seedTopic = (plan.seed as Item).topic;
    const same = plan.slice.filter((c) => c.topic === seedTopic).length;
    expect(same).toBe(15);
    expect(plan.slice).toHaveLength(50);
    expect(plan.slice[0].id).toBe(plan.seed.id);
  });

  it("次のシードは別の話題へ進む（提出済みの束の中心から遠いもの）", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 20, taskId: "t1" })!;
    const cov = acceptBundle(p1.coverage, "t1");
    const p2 = planInsightBundle(items, cov, { now: NOW, limit: 20, taskId: "t2" })!;
    expect((p2.seed as Item).topic).not.toBe((p1.seed as Item).topic);
  });
});

describe("視野は提出で確定する", () => {
  const items = corpus("ja");

  it("配っただけでは提出済みに数えず、配布中として別に数える。受理で確定する", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 50, taskId: "t1" })!;
    expect(p1.submitted).toBe(0);
    expect(p1.pendingCount).toBe(50);
    expect(p1.coverage.covered).toEqual([]);

    const cov = acceptBundle(p1.coverage, "t1");
    expect(cov.covered).toHaveLength(50);
    expect(cov.pending).toEqual([]);
    expect(cov.seeds).toEqual([p1.seed.id]);
  });

  it("提出されないまま次を取ると、種は配布中の束を避ける。提出済みは増えない", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 20, taskId: "t1" })!;
    const p2 = planInsightBundle(items, p1.coverage, { now: NOW, limit: 20, taskId: "t2" })!;
    expect(p2.submitted).toBe(0);
    expect(p2.coverage.pending).toHaveLength(2);
    expect(p1.coverage.pending[0].ids).toContain(p1.seed.id);
    expect((p2.seed as Item).topic).not.toBe((p1.seed as Item).topic);
    expect(p2.pendingCount).toBeGreaterThan(20);
  });

  it("期限（24 時間）を過ぎた配布中の束は捨てる。受理は配布中に無ければ何も変えない", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 20, taskId: "t1" })!;
    const later = new Date(NOW.getTime() + 25 * 3600 * 1000);
    const p2 = planInsightBundle(items, p1.coverage, { now: later, limit: 20, taskId: "t2" })!;
    expect(p2.coverage.pending.map((b) => b.taskId)).toEqual(["t2"]);
    expect(acceptBundle(p2.coverage, "t1")).toBe(p2.coverage);
  });
});

describe("巡と restart", () => {
  const items = corpus("ja").slice(0, 9);

  it("全知見が提出済みになったら次の巡。restart:true は途中でも次の巡", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 50, taskId: "t1" })!;
    const done = acceptBundle(p1.coverage, "t1");
    expect(done.covered).toHaveLength(9);
    const p2 = planInsightBundle(items, done, { now: NOW, limit: 50, taskId: "t2" })!;
    expect(p2.coverage.round).toBe(2);
    expect(p2.startedNewRound).toBe(true);
    expect(p2.coverage.covered).toEqual([]);

    const small = planInsightBundle(items, acceptBundle(p2.coverage, "t2"), { now: NOW, limit: 3, taskId: "t3" })!;
    expect(small.coverage.round).toBe(3);
    const mid = planInsightBundle(items, null, { now: NOW, limit: 3, taskId: "m1" })!;
    const restarted = planInsightBundle(items, acceptBundle(mid.coverage, "m1"), { now: NOW, limit: 3, taskId: "m2", restart: true })!;
    expect(restarted.coverage.round).toBe(2);
    expect(restarted.submitted).toBe(0);
  });

  it("消えた知見は数えない。候補が無ければ null", () => {
    const p1 = planInsightBundle(items, null, { now: NOW, limit: 3, taskId: "t1" })!;
    const cov = acceptBundle(p1.coverage, "t1");
    const fewer = items.filter((c) => !cov.covered.includes(c.id) || c.id === cov.covered[0]);
    const p2 = planInsightBundle(fewer, cov, { now: NOW, limit: 3, taskId: "t2" })!;
    expect(p2.total).toBe(fewer.length);
    expect(planInsightBundle([], null, { now: NOW, limit: 3, taskId: "x" })).toBeNull();
  });
});
