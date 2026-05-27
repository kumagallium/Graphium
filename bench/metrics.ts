// Phase μ-1: metrics
// Phase μ-2 additions:
//   cross_language_consistency: 同一概念の JP/EN ペアが同じ Atom に集約される割合
//   domain_balance_score: lift × epistemic preservation の domain 別調和平均 (0-1)
//
// 2026-05-27: Synthesizer 自動生成パイプラインを撤退（design revision）。
// synthesis 由来の metric（mode_distribution_entropy / novelty_score / synthesis_count_total）
// は削除し、Claim / Atom 由来の metric のみで構成する。
//
// 残った metric:
//   1. lift_score: Atom title に領域固有語が残っていない割合 (LLM-as-judge in live mode)
//   2. epistemic_preservation: ground truth の epistemicStatus と一致した割合
//   3. adversarial_pass_rate: probe が期待挙動を見せた割合
//   4. observation_atom_ratio: Atom が observational に偏らない割合
//   5. cross_language_consistency: JP/EN ペアが同じ Atom に集約される割合
//   6. domain_balance_score: lift × epistemic preservation の domain 別調和平均
//
// 1 は LLM-as-judge を介す async 版が正規。同期 heuristic 版は
// test と dry-run fallback のために残してある。
//
// μ-1.3 (2026-05-21): live mode では `domain_balance_score` も同じ JudgePack を
// 経由する。lift_score を計算するときに per-atom judgment を一度だけ取り、
// その配列を `domainBalanceScoreFromJudgments` に渡し直す（同じ LLM call を
// 2 metric で共有 → 二重課金回避 + rubric の不整合排除）。

import type {
  BenchAtom,
  BenchClaim,
  BenchMetrics,
  CorpusNote,
  GroundTruth,
  ProbeResult,
} from "./types.ts";
import type { JudgePack, Judgment } from "./judge.ts";
import { judgeAtomLift } from "./judge.ts";
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
 * 1 atom 1 LLM call で lift 判定を一括取得する。返却順は引数 `atoms` と同順。
 *
 * μ-1.3: lift_score と domain_balance_score の両方が同じ JudgePack に依存する
 * ため、judge を 2 回走らせるのを避ける + 同じ rubric で測ることを担保する。
 * 呼び出し側は得られた judgments[] を `liftScoreFromJudgments` /
 * `domainBalanceScoreFromJudgments` に流して、各 metric を pure compute で導く。
 */
export async function judgeAllAtomLifts(
  atoms: BenchAtom[],
  judges: JudgePack,
): Promise<Judgment[]> {
  const out: Judgment[] = new Array(atoms.length);
  for (let i = 0; i < atoms.length; i++) {
    out[i] = await judges.lift(atoms[i]);
  }
  return out;
}

/** judgments[] → lift_score。判定なし (atoms 0) は 1.0 (vacuous true)。 */
export function liftScoreFromJudgments(judgments: Judgment[]): number {
  if (judgments.length === 0) return 1;
  const passed = judgments.filter((j) => j.passed).length;
  return round3(passed / judgments.length);
}

/**
 * LLM-as-judge 版。判定モデルが lift を rubric に従って評価する。
 * pipeline.ts の live mode で呼ばれる正規ルート。
 *
 * 内部で `judgeAllAtomLifts` を呼ぶラッパー。すでに judgments を持っている
 * 呼び出し側 (computeMetricsWithJudges) はこの関数を経由せず直接
 * `judgeAllAtomLifts` + `liftScoreFromJudgments` の組を使う。
 */
export async function liftScoreWithJudge(
  atoms: BenchAtom[],
  judges: JudgePack,
): Promise<{ score: number; details: { passed: boolean; reason: string; atomTitle: string }[] }> {
  if (atoms.length === 0) return { score: 1, details: [] };
  const judgments = await judgeAllAtomLifts(atoms, judges);
  const details = judgments.map((j, i) => ({
    passed: j.passed,
    reason: j.reason,
    atomTitle: atoms[i].title,
  }));
  return { score: liftScoreFromJudgments(judgments), details };
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
  // dry-run / test 用 sync 版。heuristic で per-atom 判定する。
  const judgments = atoms.map((a) => judgeAtomLift(a));
  return domainBalanceScoreFromJudgments(corpus, atoms, judgments);
}

/**
 * μ-1.3 で導入。judgments[] を渡せば LLM judge の結果からそのまま per-domain
 * pass rate を計算できる。`computeMetricsWithJudges` は lift_score 用に計算した
 * judgments[] をこちらにも流し、heuristic / LLM の rubric が割れないようにする。
 */
export function domainBalanceScoreFromJudgments(
  corpus: CorpusNote[],
  atoms: BenchAtom[],
  judgments: Judgment[],
): number {
  if (atoms.length === 0) return 1;
  if (judgments.length !== atoms.length) {
    throw new Error(
      `domainBalanceScoreFromJudgments: judgments length ${judgments.length} !== atoms length ${atoms.length}`,
    );
  }
  const domainByNoteId = new Map(
    corpus.map((n) => [n.noteId, resolveDomain(n)]),
  );

  type DomainStats = { pass: number; total: number };
  const stats = new Map<string, DomainStats>();
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    const domains = atom.derivedFromNoteIds
      .map((id) => domainByNoteId.get(id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    if (domains.length === 0) continue;
    const repDomain = domains[0]; // 代表 domain は最初のソース note の domain
    const s = stats.get(repDomain) ?? { pass: 0, total: 0 };
    s.total += 1;
    if (judgments[i].passed) s.pass += 1;
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
  gtMap: Map<string, GroundTruth>;
  probeResults: ProbeResult[];
  /** Phase μ-2: cross_language_consistency / domain_balance_score 計算用 */
  corpus: CorpusNote[];
}): BenchMetrics {
  return {
    lift_score: liftScore(args.atoms),
    epistemic_preservation: epistemicPreservation(args.claims, args.gtMap),
    adversarial_pass_rate: adversarialPassRate(args.probeResults),
    claim_count_total: args.claims.length,
    atom_count_total: args.atoms.length,
    observation_atom_ratio: observationAtomRatio(args.atoms),
    cross_language_consistency: crossLanguageConsistency(args.corpus, args.atoms),
    domain_balance_score: domainBalanceScore(args.corpus, args.atoms),
  };
}

/**
 * Live mode で正規に呼ばれる metric 集計（lift を LLM judge 経由で計算する）。
 *
 * μ-1.3 から、lift 判定は per-atom で 1 回だけ取り (`judgeAllAtomLifts`)、その
 * 結果配列を `lift_score` と `domain_balance_score` の両方で共有する。LLM call の
 * 二重課金を避けつつ、2 metric の rubric を必ず一致させるため。
 */
export async function computeMetricsWithJudges(args: {
  claims: BenchClaim[];
  atoms: BenchAtom[];
  gtMap: Map<string, GroundTruth>;
  probeResults: ProbeResult[];
  judges: JudgePack;
  /** Phase μ-2: cross_language_consistency / domain_balance_score 計算用 */
  corpus: CorpusNote[];
}): Promise<{
  metrics: BenchMetrics;
  liftDetails: { passed: boolean; reason: string; atomTitle: string }[];
}> {
  const liftJudgments = await judgeAllAtomLifts(args.atoms, args.judges);
  const liftDetails = liftJudgments.map((j, i) => ({
    passed: j.passed,
    reason: j.reason,
    atomTitle: args.atoms[i].title,
  }));
  return {
    metrics: {
      lift_score: liftScoreFromJudgments(liftJudgments),
      epistemic_preservation: epistemicPreservation(args.claims, args.gtMap),
      adversarial_pass_rate: adversarialPassRate(args.probeResults),
      claim_count_total: args.claims.length,
      atom_count_total: args.atoms.length,
      observation_atom_ratio: observationAtomRatio(args.atoms),
      cross_language_consistency: crossLanguageConsistency(args.corpus, args.atoms),
      domain_balance_score: domainBalanceScoreFromJudgments(args.corpus, args.atoms, liftJudgments),
    },
    liftDetails,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
