// Phase μ-1: metrics 5 種
//
// 1. lift_score: Atom title に領域固有語が残っていない割合
// 2. mode_distribution_entropy: Synthesis 4 モードの発火比率の情報エントロピー
// 3. epistemic_preservation: ground truth の epistemicStatus と一致した割合
// 4. adversarial_pass_rate: probe が期待挙動を見せた割合
// 5. novelty_score: Synthesis が source Atom の言い換えではない割合（dry-run は heuristic）
//
// すべての metric は 0-1 の正規化された値。

import type {
  BenchAtom,
  BenchClaim,
  BenchMetrics,
  BenchSynthesis,
  GroundTruth,
  ProbeResult,
} from "./types.ts";

const DOMAIN_JARGON_FOR_LIFT = [
  "ZnSb", "SPS", "XRD", "Bi2Te3", "Sb", "Zn", "Te", "Bi", "Pt",
  "TiO2", "H2PtCl6", "ZEM-3", "LFA", "HP", "RDE", "ORR", "Nafion",
  "HClO4", "qPCR", "DMEM", "FBS", "HeLa", "siRNA", "GAPDH",
  "Lipofectamine", "MHC", "HIDS", "auditd", "SGD", "TDD",
  "Redis", "Temporal", "NTP", "TTL", "RHE", "PARSTAT", "Dr Sinter",
];

export function liftScore(atoms: BenchAtom[]): number {
  if (atoms.length === 0) return 1;
  let lifted = 0;
  for (const a of atoms) {
    const target = `${a.title} ${a.body}`;
    const hasJargon = DOMAIN_JARGON_FOR_LIFT.some((j) =>
      new RegExp(`\\b${j}\\b`, "i").test(target),
    );
    if (!hasJargon) lifted += 1;
  }
  return round3(lifted / atoms.length);
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
      .map((a) => `${a.title} ${a.body}`.toLowerCase());
    const synthText = `${s.title} ${s.body}`.toLowerCase();
    // heuristic: synthesis 本文の文字列が source の単純連結に含まれていなければ novel
    const concatSource = sourceTexts.join(" ");
    if (!concatSource.includes(synthText.slice(0, 40))) novel += 1;
  }
  return round3(novel / syntheses.length);
}

export function observationAtomRatio(atoms: BenchAtom[]): number {
  if (atoms.length === 0) return 0;
  const obs = atoms.filter((a) => a.atomType === "observational").length;
  return round3(obs / atoms.length);
}

export function computeMetrics(args: {
  claims: BenchClaim[];
  atoms: BenchAtom[];
  syntheses: BenchSynthesis[];
  gtMap: Map<string, GroundTruth>;
  probeResults: ProbeResult[];
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
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
