// 洞察の発見で「どの知見をこの巡で見たか」の台帳（appdata/mcp-insight-coverage.json）と、束の選び方。
// 設計: docs/internal/mcp-knowledge-generation-design-2026-10.md §11
//
// アプリは取り込みのたびに planCoverageSeeds で「全知見が一度は視野に入る」シード列を計画する。
// MCP は呼び出しが別々なので、その進み具合を台帳に残す:
//   - start_insight_task が束を配ると pending（配布中）に足す。まだ視野には数えない
//   - submit_insights が受理されたとき（atomizer の答えが通ったとき）に covered（提出済み）へ確定する。
//     提出されなかった・期限切れ・INVALID_OUTPUT の束は「見終えた」にならない
//   - 次のシードは、未提出で、配布中でもない知見のうち、これまでのシードから最も遠いもの（farthest-point）
//   - 束はシードに似た順に limit 件。未提出の知見を先に埋め、足りなければ提出済みで埋める
//   - 全有効知見が covered になったら次の巡へ（round + 1）
// 類似度は text-similarity.ts（和文は文字 bigram、英文は単語。sampling.ts のトークン Jaccard は
// 和文でほぼ 0 になるため使わない）。アプリの sampling.ts は変えない。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TASK_TTL_MS } from "./knowledge-tasks";
import { featureSimilarity, featuresOf, type Features } from "./text-similarity";
import { writeFileAtomic } from "./upkeep/atomic-write";
import { appDataDir } from "./vault";

export type PendingBundle = {
  taskId: string;
  /** 配った知見の id */
  ids: string[];
  /** 束の中心にした知見の id */
  seed: string;
  /** 配った時刻（ISO 8601）。課題の期限（24 時間）を過ぎたら捨てる */
  at: string;
};

export type InsightCoverage = {
  version: 1;
  /** 何巡目か（1 始まり） */
  round: number;
  /** この巡を始めた時刻（ISO 8601） */
  startedAt: string;
  /** この巡で提出済み（submit_insights が受理された）束の知見の id */
  covered: string[];
  /** 提出済みの束の中心にした知見の id（farthest-point の基準） */
  seeds: string[];
  /** 配布中（まだ提出されていない）の束 */
  pending: PendingBundle[];
};

export function insightCoveragePath(root: string): string {
  return join(appDataDir(root), "mcp-insight-coverage.json");
}

export type CoverageRead =
  | { kind: "none" }
  | { kind: "ok"; coverage: InsightCoverage }
  /** JSON として読めない・形が違う。進み具合を数えるだけの台帳なので新しい巡として始めてよい */
  | { kind: "corrupt" }
  /** 知らない version（新しい版が書いた）。上書きしない */
  | { kind: "unknown_version"; version: unknown };

export function readInsightCoverage(root: string): CoverageRead {
  const path = insightCoveragePath(root);
  if (!existsSync(path)) return { kind: "none" };
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as Partial<InsightCoverage> | null;
    if (!r || typeof r !== "object") return { kind: "corrupt" };
    if (r.version !== 1) return { kind: "unknown_version", version: r.version };
    if (typeof r.round !== "number" || !Array.isArray(r.covered)) return { kind: "corrupt" };
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const pending: PendingBundle[] = Array.isArray(r.pending)
      ? r.pending
          .filter((p): p is PendingBundle => !!p && typeof p.taskId === "string" && typeof p.seed === "string" && typeof p.at === "string")
          .map((p) => ({ taskId: p.taskId, ids: strs(p.ids), seed: p.seed, at: p.at }))
      : [];
    return {
      kind: "ok",
      coverage: {
        version: 1,
        round: r.round,
        startedAt: typeof r.startedAt === "string" ? r.startedAt : new Date(0).toISOString(),
        covered: strs(r.covered),
        seeds: strs(r.seeds),
        pending,
      },
    };
  } catch {
    return { kind: "corrupt" };
  }
}

export const COVERAGE_UNKNOWN_VERSION_MESSAGE = (version: unknown) =>
  `LEDGER_CORRUPT: 洞察の視野の台帳（mcp-insight-coverage.json）の version が未知です（${String(version)}）。` +
  "新しい版の Graphium が書いたものかもしれません。上書きしないので、Graphium を更新するか、台帳を退避してからお試しください。";

export async function writeInsightCoverage(root: string, coverage: InsightCoverage): Promise<void> {
  await writeFileAtomic(insightCoveragePath(root), JSON.stringify(coverage, null, 2));
}

export type BundleItem = { id: string; text: string; modifiedTime: string };

export type InsightBundlePlan<T extends BundleItem> = {
  /** 配った束を pending に足した後の台帳 */
  coverage: InsightCoverage;
  seed: T;
  /** 束（シードを先頭に、未提出の知見を類似度の高い順に、足りなければ提出済みを類似度順に limit 件） */
  slice: T[];
  /** この呼び出しで新しい巡に入ったか */
  startedNewRound: boolean;
  /** 視野: 提出済みの知見の数 / 有効な知見の総数 / 配布中（未提出）の知見の数（この束を含む） */
  submitted: number;
  total: number;
  pendingCount: number;
};

/** 視野の数（提出済み・配布中）を数える。配布中は未提出のものだけ */
export function countCoverage(
  coverage: InsightCoverage,
  activeIds: Set<string>,
): { submitted: number; total: number; pendingCount: number } {
  const covered = new Set(coverage.covered.filter((id) => activeIds.has(id)));
  const pending = new Set<string>();
  for (const b of coverage.pending) for (const id of b.ids) if (activeIds.has(id) && !covered.has(id)) pending.add(id);
  return { submitted: covered.size, total: activeIds.size, pendingCount: pending.size };
}

/**
 * 束を選ぶ純関数。prev は読んだ台帳（無ければ null）。
 * restart なら今の巡を捨てて次の巡から。全知見が提出済みでも次の巡に入る
 */
export function planInsightBundle<T extends BundleItem>(
  items: T[],
  prev: InsightCoverage | null,
  options: { restart?: boolean; now: Date; limit: number; taskId: string },
): InsightBundlePlan<T> | null {
  if (items.length === 0) return null;
  const ids = new Set(items.map((c) => c.id));
  const nowIso = options.now.toISOString();
  let state: InsightCoverage = prev ?? { version: 1, round: 1, startedAt: nowIso, covered: [], seeds: [], pending: [] };
  let startedNewRound = false;

  if (options.restart && prev) {
    state = { version: 1, round: prev.round + 1, startedAt: nowIso, covered: [], seeds: [], pending: [] };
    startedNewRound = true;
  }
  // 期限切れの配布・消えた知見は数えない
  const alive = (b: PendingBundle) => options.now.getTime() <= Date.parse(b.at) + TASK_TTL_MS;
  let pending = state.pending.filter(alive);
  let covered = new Set(state.covered.filter((id) => ids.has(id)));
  let seedIds = state.seeds.filter((id) => ids.has(id));
  let uncovered = items.filter((c) => !covered.has(c.id));
  if (uncovered.length === 0) {
    // 全知見が提出済み → 次の巡へ
    state = { version: 1, round: state.round + 1, startedAt: nowIso, covered: [], seeds: [], pending: [] };
    startedNewRound = true;
    covered = new Set();
    seedIds = [];
    pending = [];
    uncovered = items;
  }

  const feats = new Map<string, Features>();
  const feat = (c: T) => {
    let f = feats.get(c.id);
    if (!f) feats.set(c.id, (f = featuresOf(c.text)));
    return f;
  };
  const byId = new Map(items.map((c) => [c.id, c]));

  // シード: 未提出で配布中でもない知見から（無ければ配布中も許す）
  const pendingIds = new Set(pending.flatMap((b) => b.ids));
  let pool = uncovered.filter((c) => !pendingIds.has(c.id));
  if (pool.length === 0) pool = uncovered;
  const ordered = [...pool].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  const refSeeds = [...seedIds, ...pending.map((b) => b.seed)]
    .map((id) => byId.get(id))
    .filter((c): c is T => !!c);
  let seed: T = ordered[0];
  if (refSeeds.length > 0) {
    // farthest-point: これまでのシードへの最大類似度が最小のもの
    let bestScore = Infinity;
    for (const c of ordered) {
      let maxSim = 0;
      for (const s of refSeeds) maxSim = Math.max(maxSim, featureSimilarity(feat(c), feat(s)));
      if (maxSim < bestScore) {
        bestScore = maxSim;
        seed = c;
      }
    }
  }

  // 束: シード＋未提出を類似度順 → 足りなければ提出済みを類似度順
  const scored = items
    .filter((c) => c.id !== seed.id)
    .map((c) => ({ c, done: covered.has(c.id), sim: featureSimilarity(feat(c), feat(seed)) }));
  scored.sort((a, b) => Number(a.done) - Number(b.done) || b.sim - a.sim);
  const slice = [seed, ...scored.slice(0, Math.max(options.limit - 1, 0)).map((s) => s.c)];

  const coverage: InsightCoverage = {
    version: 1,
    round: state.round,
    startedAt: state.startedAt,
    covered: [...covered],
    seeds: seedIds,
    pending: [...pending, { taskId: options.taskId, ids: slice.map((c) => c.id), seed: seed.id, at: nowIso }],
  };
  return { coverage, seed, slice, startedNewRound, ...countCoverage(coverage, ids) };
}

/**
 * 提出を受理したとき、その課題の束を提出済みにする純関数。
 * 配布中に無い（期限切れで捨てた・restart で巡が変わった）ときは変えない
 */
export function acceptBundle(coverage: InsightCoverage, taskId: string): InsightCoverage {
  const b = coverage.pending.find((p) => p.taskId === taskId);
  if (!b) return coverage;
  return {
    ...coverage,
    covered: [...new Set([...coverage.covered, ...b.ids])],
    seeds: [...new Set([...coverage.seeds, b.seed])],
    pending: coverage.pending.filter((p) => p.taskId !== taskId),
  };
}
