// Phase μ-1: probe ベースの adversarial 評価
//
// 各 probe は spec §5 の表に対応する。Phase μ-1 baseline 時点では
// 多くの probe は fail で OK（Phase α / β / η / γ 等が pass させる対象）。

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  BenchAtom,
  BenchClaim,
  BenchSynthesis,
  Probe,
  ProbeResult,
  CorpusNote,
} from "./types.ts";
import { REPO_ROOT, resolveProbeInput } from "./load.ts";
import { runDryRunPipeline } from "./pipeline.ts";

// ─── World-model grounding probe heuristic (PR 2C) ────────────────────────────
//
// dry-run pipeline は世界照合 (world-grounding) を呼ばないが、PR 2C で domain
// 分割を撤廃した後の seed KB が「汎用 corpus 上で keyword retriever を問題なく
// 回せる」ことを bench で確認したい。そこで seed.v1.json を Node 側で直接読み込み、
// CorpusNote.title + body を keyword 一致で照合する軽量 heuristic を probe 用に
// 提供する。live LLM 判定の評価は Phase 5 で別 probe として導入する。

type WorldKbEntry = { keywords: string[]; verdict: string };

let cachedSeedKb: WorldKbEntry[] | null = null;
function loadSeedKbForBench(): WorldKbEntry[] {
  if (cachedSeedKb) return cachedSeedKb;
  try {
    const path = join(REPO_ROOT, "public/grounding-kb/seed.v1.json");
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw) as { entries: WorldKbEntry[] };
    cachedSeedKb = Array.isArray(json.entries) ? json.entries : [];
  } catch {
    cachedSeedKb = [];
  }
  return cachedSeedKb;
}

function normalizeWorldKbText(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** CorpusNote の title + body に対し、seed KB の keyword 2+ ヒット件数を返す */
function countWorldKbHits(inputs: CorpusNote[]): { hits: number; total: number } {
  const kb = loadSeedKbForBench();
  if (kb.length === 0) return { hits: 0, total: inputs.length };
  let hits = 0;
  for (const note of inputs) {
    const norm = normalizeWorldKbText(`${note.title}\n${note.body}`);
    let matched = false;
    for (const entry of kb) {
      if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue;
      const hitCount = entry.keywords.filter((k) =>
        norm.includes(normalizeWorldKbText(k)),
      ).length;
      if (hitCount >= 2) {
        matched = true;
        break;
      }
    }
    if (matched) hits++;
  }
  return { hits, total: inputs.length };
}

export function evaluateProbes(
  probes: Probe[],
): { probeResults: ProbeResult[]; perProbeRuns: PerProbeRun[] } {
  const probeResults: ProbeResult[] = [];
  const perProbeRuns: PerProbeRun[] = [];

  for (const probe of probes) {
    let inputs: CorpusNote[];
    try {
      inputs = probe.inputs.map((p) => resolveProbeInput(p));
    } catch (err) {
      probeResults.push({
        name: probe.name,
        passed: false,
        reason: `probe input load failed: ${(err as Error).message}`,
      });
      continue;
    }

    const result = runDryRunPipeline(inputs);
    perProbeRuns.push({
      probe: probe.name,
      claims: result.allClaims,
      atoms: result.allAtoms,
      syntheses: result.allSyntheses,
    });

    const verdict = evaluateProbeExpected(
      probe,
      result.allAtoms,
      result.allSyntheses,
      result.allClaims,
      inputs,
    );
    probeResults.push(verdict);
  }

  return { probeResults, perProbeRuns };
}

export type PerProbeRun = {
  probe: string;
  claims: BenchClaim[];
  atoms: BenchAtom[];
  syntheses: BenchSynthesis[];
};

function evaluateProbeExpected(
  probe: Probe,
  atoms: BenchAtom[],
  syntheses: BenchSynthesis[],
  claims: BenchClaim[],
  inputs: CorpusNote[],
): ProbeResult {
  const exp = probe.expected as Record<string, unknown>;
  const reasons: string[] = [];
  let allPassed = true;

  if (typeof exp.atomEpistemicStatus === "string") {
    const want = exp.atomEpistemicStatus as string;
    const ok = atoms.length === 0 || atoms.every((a) => a.epistemicStatus === want);
    reasons.push(`atomEpistemicStatus=${want}: ${ok ? "ok" : `got ${atoms.map((a) => a.epistemicStatus).join("/")}`}`);
    allPassed &&= ok;
  }

  // Phase μ-1.2: atomEpistemicStatusAny は「少なくとも 1 件の Atom がこの status を持つ」
  // を要求する some() 版。input が混合 status の batch (例: clean-lab + wrong-speculation)
  // では、lowest-status inheritance は per-atom で適用されるため、speculation 入りの混合
  // ソースから作られた Atom は speculation だが、observation-only ソースから作られた
  // Atom は observation のままで *両方とも正しい*。 every() を要求する
  // atomEpistemicStatus はこのケースで過剰に strict になるので、some() 版を提供する。
  if (typeof exp.atomEpistemicStatusAny === "string") {
    const want = exp.atomEpistemicStatusAny as string;
    const ok = atoms.some((a) => a.epistemicStatus === want);
    reasons.push(`atomEpistemicStatusAny=${want}: ${ok ? "ok" : `got ${atoms.map((a) => a.epistemicStatus).join("/")}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.synthesisHypothesisStatus === "string") {
    const want = exp.synthesisHypothesisStatus as string;
    const ok = syntheses.length === 0 || syntheses.every((s) => s.hypothesisStatus === want);
    reasons.push(`synthesisHypothesisStatus=${want}: ${ok ? "ok" : `got ${syntheses.map((s) => s.hypothesisStatus).join("/")}`}`);
    allPassed &&= ok;
  }

  if (Array.isArray(exp.synthesisModes)) {
    const want = exp.synthesisModes as string[];
    const ok = syntheses.some((s) => want.includes(s.mode));
    reasons.push(`synthesisModes∋${want.join(",")}: ${ok ? "ok" : `got ${[...new Set(syntheses.map((s) => s.mode))].join(",") || "none"}`}`);
    allPassed &&= ok;
  }

  if (Array.isArray(exp.atomTypes)) {
    const want = exp.atomTypes as string[];
    const ok = atoms.some((a) => a.atomType && want.includes(a.atomType));
    reasons.push(`atomTypes∋${want.join(",")}: ${ok ? "ok" : `got ${[...new Set(atoms.map((a) => a.atomType))].join(",") || "none"}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.atomLiftLevel === "string") {
    const want = exp.atomLiftLevel as string;
    const ok = atoms.some((a) => a.liftLevel === want);
    reasons.push(`atomLiftLevel=${want}: ${ok ? "ok" : `got ${[...new Set(atoms.map((a) => a.liftLevel))].join(",")}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.rebuttalConditionsCount === "number") {
    const want = exp.rebuttalConditionsCount as number;
    const count = claims.reduce((sum, c) => sum + c.rebuttalConditions.length, 0);
    const ok = count >= want;
    reasons.push(`rebuttalConditionsCount>=${want}: ${ok ? "ok" : `got ${count}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.rebuttalConditionsCount === "object" && exp.rebuttalConditionsCount !== null) {
    const min = (exp.rebuttalConditionsCount as { min?: number }).min ?? 0;
    const count = claims.reduce((sum, c) => sum + c.rebuttalConditions.length, 0);
    const ok = count >= min;
    reasons.push(`rebuttalConditionsCount>=${min}: ${ok ? "ok" : `got ${count}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.metaAtomCount === "object" && exp.metaAtomCount !== null) {
    // Phase ε 未実装なので常に 0。期待値が >=1 のときは fail。
    const min = (exp.metaAtomCount as { min?: number }).min ?? 0;
    const ok = 0 >= min;
    reasons.push(`metaAtomCount>=${min}: ${ok ? "ok" : "got 0 (Phase ε 未実装)"}`);
    allPassed &&= ok;
  }

  if (typeof exp.fakeDoiCount === "number") {
    // Phase ζ 未実装。externalSources は常に空配列なので fake DOI も 0 で auto-pass。
    const want = exp.fakeDoiCount as number;
    const got = syntheses.reduce((sum, s) => sum + s.externalSources.length, 0);
    const ok = got === want;
    reasons.push(`fakeDoiCount=${want}: ${ok ? "ok" : `got ${got}`}`);
    allPassed &&= ok;
  }

  if (Array.isArray(exp.modalQualifierDiversity)) {
    const want = exp.modalQualifierDiversity as string[];
    const present = new Set(claims.map((c) => c.modalQualifier).filter(Boolean) as string[]);
    const ok = want.every((w) => present.has(w));
    reasons.push(`modalQualifierDiversity⊇${want.join(",")}: ${ok ? "ok" : `got ${[...present].join(",") || "none"}`}`);
    allPassed &&= ok;
  }

  if (typeof exp.backingCount === "object" && exp.backingCount !== null) {
    // Phase γ で Ingester に Toulmin Backing 抽出を導入。BenchClaim.backing に拾われたら
    // 件数で評価する。
    const min = (exp.backingCount as { min?: number }).min ?? 0;
    const count = claims.reduce((sum, c) => sum + (c.backing?.length ?? 0), 0);
    const ok = count >= min;
    reasons.push(`backingCount>=${min}: ${ok ? "ok" : `got ${count}`}`);
    allPassed &&= ok;
  }

  // PR 2C: world-validity probe — seed KB が混合 domain corpus に対して
  // keyword retriever を問題なく回せることを assert する dry-run heuristic
  if (typeof exp.worldValidityKbHitCount === "object" && exp.worldValidityKbHitCount !== null) {
    const min = (exp.worldValidityKbHitCount as { min?: number }).min ?? 0;
    const { hits, total } = countWorldKbHits(inputs);
    const ok = hits >= min;
    reasons.push(
      `worldValidityKbHitCount>=${min}: ${ok ? "ok" : `got ${hits}/${total} KB hits`}`,
    );
    allPassed &&= ok;
  }

  if (typeof exp.claimCountPerNote === "object" && exp.claimCountPerNote !== null) {
    // Phase η probe: mixed-status note は 1 note あたり 2+ Claim に分離されるべき。
    const min = (exp.claimCountPerNote as { min?: number }).min ?? 0;
    const byNote = new Map<string, number>();
    for (const c of claims) {
      byNote.set(c.sourceNoteId, (byNote.get(c.sourceNoteId) ?? 0) + 1);
    }
    const noteCounts = Array.from(byNote.values());
    const violators = noteCounts.filter((n) => n < min).length;
    const ok = noteCounts.length > 0 && violators === 0;
    reasons.push(
      `claimCountPerNote>=${min}: ${ok ? "ok" : `${violators}/${noteCounts.length} notes below min (counts: ${noteCounts.join("/")})`}`,
    );
    allPassed &&= ok;
  }

  return {
    name: probe.name,
    passed: allPassed,
    reason: reasons.join(" | "),
  };
}
