// Phase μ-1: metrics 5 種
// Phase μ-2 additions:
//   6. cross_language_consistency: 同一概念の JP/EN ペアが同じ Atom に集約される割合
//   7. domain_balance_score: lift × epistemic preservation の domain 別調和平均 (0-1)
//
// 1. lift_score: Atom title に領域固有語が残っていない割合 (LLM-as-judge in live mode)
// 2. mode_distribution_entropy: Synthesis 4 モードの発火比率の情報エントロピー
// 3. epistemic_preservation: ground truth の epistemicStatus と一致した割合
// 4. adversarial_pass_rate: probe が期待挙動を見せた割合
// 5. novelty_score: Synthesis が source Atom の言い換えではない割合 (LLM-as-judge in live mode)
//
// 1 と 5 は LLM-as-judge を介す async 版が正規。同期 heuristic 版は
// test と dry-run fallback のために残してある。

import type {
  BenchAtom,
  BenchClaim,
  BenchMetrics,
  BenchSynthesis,
  CorpusNote,
  GroundTruth,
  ProbeResult,
} from "./types.ts";
import type { JudgePack } from "./judge.ts";
import { judgeAtomLift, judgeSynthesisNovelty } from "./judge.ts";
import { resolveDomain } from "./load.ts";

export function liftScore(atoms: BenchAtom[]): number {
  if (atoms.length === 0) return 1;
  let lifted = 0;
  for (const a of atoms) {
    if (judgeAtomLift(a).passed) lifted += 1;
  }
  return round3(lifted / atoms.length);
}

/**
 * LLM-as-judge 版。判定モデルが lift / novelty を rubric に従って評価する。
 * pipeline.ts の live mode で呼ばれる正規ルート。
 */
export async function liftScoreWithJudge(
  atoms: BenchAtom[],
  judges: JudgePack,
): Promise<{ score: number; details: { passed: boolean; reason: string; atomTitle: string }[] }> {
  if (atoms.length === 0) return { score: 1, details: [] };
  const details: { passed: boolean; reason: string; atomTitle: string }[] = [];
  let lifted = 0;
  for (const atom of atoms) {
    const j = await judges.lift(atom);
    details.push({ passed: j.passed, reason: j.reason, atomTitle: atom.title });
    if (j.passed) lifted += 1;
  }
  return { score: round3(lifted / atoms.length), details };
}

export function modeDistributionEntropy(syntheses: BenchSynthesis[]): number {
  if (syntheses.length === 0) return 0;
  const counts: Record<string, number> = {
    deductive: 0,
    abductive: 0,
    analogical: 0,
    dialectic: 0,
  };
  for (const s of syntheses) {
    counts[s.mode] = (counts[s.mode] ?? 0) + 1;
  }
  const total = syntheses.length;
  let h = 0;
  for (const m of Object.keys(counts)) {
    const p = counts[m] / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  // 4 モード均等のとき log2(4)=2 で最大。正規化して 0-1 に。
  return round3(h / Math.log2(4));
}

export function epistemicPreservation(
  claims: BenchClaim[],
  gtMap: Map<string, GroundTruth>,
): number {
  let matched = 0;
  let total = 0;
  // ノートごとに「Claim の epistemic 集合 が GT の expected と少なくとも 1 つ一致するか」を測る
  const byNote = new Map<string, string[]>();
  for (const c of claims) {
    const arr = byNote.get(c.sourceNoteId) ?? [];
    arr.push(c.epistemicStatus);
    byNote.set(c.sourceNoteId, arr);
  }
  for (const [noteId, statuses] of byNote.entries()) {
    const gt = gtMap.get(noteId);
    if (!gt) continue;
    const expected = gt.expected.epistemicStatus ?? [];
    if (expected.length === 0) continue;
    total += 1;
    if (statuses.some((s) => expected.includes(s))) matched += 1;
  }
  if (total === 0) return 0;
  return round3(matched / total);
}

export function adversarialPassRate(probeResults: ProbeResult[]): number {
  if (probeResults.length === 0) return 0;
  const passed = probeResults.filter((p) => p.passed).length;
  return round3(passed / probeResults.length);
}

export function noveltyScore(
  atoms: BenchAtom[],
  syntheses: BenchSynthesis[],
): number {
  if (syntheses.length === 0) return 0;
  let novel = 0;
  for (const s of syntheses) {
    const sourceTexts = s.sourceAtomIndices
      .map((i) => atoms[i])
      .filter(Boolean)
      .map((a) => `${a.title} ${a.body}`);
    const synthText = `${s.title} ${s.body}`;
    if (judgeSynthesisNovelty(synthText, sourceTexts).passed) novel += 1;
  }
  return round3(novel / syntheses.length);
}

/**
 * LLM-as-judge 版の novelty。pipeline.ts の live mode で呼ばれる正規ルート。
 */
export async function noveltyScoreWithJudge(
  atoms: BenchAtom[],
  syntheses: BenchSynthesis[],
  judges: JudgePack,
): Promise<{ score: number; details: { passed: boolean; reason: string; synthesisTitle: string }[] }> {
  if (syntheses.length === 0) return { score: 0, details: [] };
  const details: { passed: boolean; reason: string; synthesisTitle: string }[] = [];
  let novel = 0;
  for (const s of syntheses) {
    const sourceTexts = s.sourceAtomIndices
      .map((i) => atoms[i])
      .filter(Boolean)
      .map((a) => `${a.title} — ${a.body}`);
    const synthText = `${s.title}\n${s.body}`;
    const j = await judges.novelty(synthText, sourceTexts);
    details.push({ passed: j.passed, reason: j.reason, synthesisTitle: s.title });
    if (j.passed) novel += 1;
  }
  return { score: round3(novel / syntheses.length), details };
}

export function observationAtomRatio(atoms: BenchAtom[]): number {
  if (atoms.length === 0) return 0;
  const obs = atoms.filter((a) => a.atomType === "observational").length;
  return round3(obs / atoms.length);
}

/**
 * Phase μ-2: cross_language_consistency
 * 同一 pairId を持つ JP/EN ノートペアが、同じ Atom に集約されているかを測る。
 *
 * ペアがない corpus (Phase μ-1 だけ) では 1.0 を返し、メトリクスとして無毒。
 * Atom が 1 つも無いケースも 1.0（vacuous true）。
 *
 * 判定:
 *   - corpus から pairId 別に noteId をグループ化
 *   - 各ペアについて、両 noteId が「同じ Atom の derivedFromNoteIds に同居している」かを見る
 *   - 一つでも同居している Atom があれば 1 (consistent)
 *   - すべての Atom で別々の Atom に分かれていたら 0 (inconsistent)
 */
export function crossLanguageConsistency(
  corpus: CorpusNote[],
  atoms: BenchAtom[],
): number {
  const pairs = new Map<string, string[]>(); // pairId -> [noteId, noteId]
  for (const n of corpus) {
    if (!n.pairId) continue;
    if (n.category !== "cross-language-pair") continue;
    const arr = pairs.get(n.pairId) ?? [];
    arr.push(n.noteId);
    pairs.set(n.pairId, arr);
  }
  // 完全なペア (≥2 ノート) だけ評価対象
  const validPairs = Array.from(pairs.values()).filter((arr) => arr.length >= 2);
  if (validPairs.length === 0) return 1;
  let consistent = 0;
  for (const noteIds of validPairs) {
    const merged = atoms.some((a) =>
      noteIds.every((id) => a.derivedFromNoteIds.includes(id)),
    );
    if (merged) consistent += 1;
  }
  return round3(consistent / validPairs.length);
}

/**
 * Phase μ-2: domain_balance_score
 * domain ごとに「Atom の lift_score 相当」を計算し、その分布の均一さを 0-1 で返す。
 *
 * 動機: corpus が複数ドメインに広がっていても、Atomizer が特定ドメイン (例: 材料)
 * だけで lift を達成し、他ドメインで rung-1 のままだと「全体平均は高いが偏在」になる。
 * これを単一スカラーで検出するためのメトリクス。
 *
 * アルゴリズム:
 *   1. 各 atom について、derivedFromNoteIds の domain を corpus から引いて代表 domain を決定
 *      (複数 domain にまたがる Atom は最初の domain を採用、希少なので無視可)
 *   2. domain 別に judgeAtomLift の合格率を集計
 *   3. domain 数 K に対し、合格率ベクトル p_i の正規化エントロピー × 平均合格率 を返す
 *      - 平均合格率: 全体的に lift できているか
 *      - 正規化エントロピー: ドメイン間で偏っていないか
 *      - 積で「全ドメインで均等に lift できている」度合いになる
 *
 * Atom が無い場合は 1.0 (vacuous)。
 * 1 つの domain しかカバーしていない場合は entropy 部が 0 なので 0 になる。
 * これは意図的: 多様性を測るメトリクスなので、単一 domain corpus に対して high score を返すべきでない。
 */
export function domainBalanceScore(
  corpus: CorpusNote[],
  atoms: BenchAtom[],
): number {
  if (atoms.length === 0) return 1;
  const domainByNoteId = new Map(
    corpus.map((n) => [n.noteId, resolveDomain(n)]),
  );

  type DomainStats = { pass: number; total: number };
  const stats = new Map<string, DomainStats>();
  for (const atom of atoms) {
    const domains = atom.derivedFromNoteIds
      .map((id) => domainByNoteId.get(id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    if (domains.length === 0) continue;
    const repDomain = domains[0]; // 代表 domain は最初のソース note の domain
    const s = stats.get(repDomain) ?? { pass: 0, total: 0 };
    s.total += 1;
    if (judgeAtomLift(atom).passed) s.pass += 1;
    stats.set(repDomain, s);
  }
  const totals = Array.from(stats.values());
  if (totals.length === 0) return 0;
  const passRates = totals.map((s) => (s.total > 0 ? s.pass / s.total : 0));
  // 平均合格率
  const meanPass = passRates.reduce((a, b) => a + b, 0) / passRates.length;
  // 正規化エントロピー (1 に近いほど均等)
  // 重みは合格率を取り、足して 0 のときは均等として扱う
  const sumPass = passRates.reduce((a, b) => a + b, 0);
  let normalizedEntropy = 1;
  if (sumPass > 0 && passRates.length >= 2) {
    const p = passRates.map((x) => x / sumPass);
    let h = 0;
    for (const x of p) {
      if (x > 0) h -= x * Math.log2(x);
    }
    normalizedEntropy = h / Math.log2(passRates.length);
  } else if (passRates.length < 2) {
    // 単一ドメイン corpus: 多様性は測れないので 0 を返す
    normalizedEntropy = 0;
  }
  return round3(meanPass * normalizedEntropy);
}

export function computeMetrics(args: {
  claims: BenchClaim[];
  atoms: BenchAtom[];
  syntheses: BenchSynthesis[];
  gtMap: Map<string, GroundTruth>;
  probeResults: ProbeResult[];
  /** Phase μ-2: cross_language_consistency / domain_balance_score 計算用 */
  corpus: CorpusNote[];
}): BenchMetrics {
  return {
    lift_score: liftScore(args.atoms),
    mode_distribution_entropy: modeDistributionEntropy(args.syntheses),
    epistemic_preservation: epistemicPreservation(args.claims, args.gtMap),
    adversarial_pass_rate: adversarialPassRate(args.probeResults),
    novelty_score: noveltyScore(args.atoms, args.syntheses),
    claim_count_total: args.claims.length,
    atom_count_total: args.atoms.length,
    synthesis_count_total: args.syntheses.length,
    observation_atom_ratio: observationAtomRatio(args.atoms),
    cross_language_consistency: crossLanguageConsistency(args.corpus, args.atoms),
    domain_balance_score: domainBalanceScore(args.corpus, args.atoms),
  };
}

/**
 * Live mode で正規に呼ばれる metric 集計（lift / novelty を LLM judge 経由で計算する）。
 */
export async function computeMetricsWithJudges(args: {
  claims: BenchClaim[];
  atoms: BenchAtom[];
  syntheses: BenchSynthesis[];
  gtMap: Map<string, GroundTruth>;
  probeResults: ProbeResult[];
  judges: JudgePack;
  /** Phase μ-2: cross_language_consistency / domain_balance_score 計算用 */
  corpus: CorpusNote[];
}): Promise<{
  metrics: BenchMetrics;
  liftDetails: { passed: boolean; reason: string; atomTitle: string }[];
  noveltyDetails: { passed: boolean; reason: string; synthesisTitle: string }[];
}> {
  const lift = await liftScoreWithJudge(args.atoms, args.judges);
  const novelty = await noveltyScoreWithJudge(args.atoms, args.syntheses, args.judges);
  return {
    metrics: {
      lift_score: lift.score,
      mode_distribution_entropy: modeDistributionEntropy(args.syntheses),
      epistemic_preservation: epistemicPreservation(args.claims, args.gtMap),
      adversarial_pass_rate: adversarialPassRate(args.probeResults),
      novelty_score: novelty.score,
      claim_count_total: args.claims.length,
      atom_count_total: args.atoms.length,
      synthesis_count_total: args.syntheses.length,
      observation_atom_ratio: observationAtomRatio(args.atoms),
      cross_language_consistency: crossLanguageConsistency(args.corpus, args.atoms),
      domain_balance_score: domainBalanceScore(args.corpus, args.atoms),
    },
    liftDetails: lift.details,
    noveltyDetails: novelty.details,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
