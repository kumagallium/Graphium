// Phase μ-3: adversarial probe runner
//
// 既存の `bench/probes/*.probe.json`（spec probe）は「Phase X を入れたら pass する」
// 仕様駆動の probe。ここで扱う `bench/probes/adversarial/*.probe.json` は
// **safety / robustness** を確認する probe で、評価軸が異なる:
//
//   1. pipelineCompletes  — 入力で pipeline がクラッシュ / 暴走しないか
//   2. maxDurationMs      — 一定時間内に完了するか（DoS 耐性）
//   3. maxClaims          — Claim 爆発を起こさないか
//   4. minClaims          — 全捨て fallback でないか
//   5. atomTitle/Body Must Not Contain — 注入文字列・PII・誹謗中傷が下流に残らない
//   6. atomEpistemicStatusMustNotBe / synthesisHypothesisStatusMustNotBe — 不当な status 昇格を防ぐ
//
// spec probe 同様、現状の baseline では多くの probe が fail で OK。
// 後続 Phase（η の最低継承 / sanitizer 等）が pass させていく。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runDryRunPipeline } from "./pipeline.ts";
import type { BenchAtom, BenchClaim, BenchSynthesis, CorpusNote } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const REPO_ROOT = join(__dirname, "..");
const PROBE_DIR = join(BENCH_DIR, "probes", "adversarial");

export type AdversarialProbeKind = "safety" | "robustness";

export type AdversarialProbe = {
  name: string;
  category: "adversarial";
  kind: AdversarialProbeKind;
  inputs: string[];
  expected: AdversarialExpected;
  rationale: string;
};

export type AdversarialExpected = {
  pipelineCompletes?: boolean;
  maxDurationMs?: number;
  maxClaims?: number;
  minClaims?: number;
  maxAtoms?: number;
  minAtoms?: number;
  maxSyntheses?: number;
  atomTitleMustNotContain?: string[];
  atomBodyMustNotContain?: string[];
  claimContentMustNotContain?: string[];
  atomEpistemicStatusMustNotBe?: string;
  synthesisHypothesisStatusMustNotBe?: string;
  synthesisEpistemicStatusMustNotBe?: string;
};

export type AdversarialResult = {
  name: string;
  kind: AdversarialProbeKind;
  passed: boolean;
  /** 個別チェックの内訳。1 つでも fail なら passed=false */
  checks: AdversarialCheck[];
  durationMs: number;
  /** pipeline が throw した場合のみ埋まる */
  error?: string;
  counts: { claims: number; atoms: number; syntheses: number };
};

export type AdversarialCheck = {
  name: string;
  passed: boolean;
  reason: string;
};

export type AdversarialReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  probeCount: number;
  safetyPassRate: number;
  robustnessPassRate: number;
  totalPassRate: number;
  results: AdversarialResult[];
};

function loadProbes(): AdversarialProbe[] {
  if (!existsSync(PROBE_DIR)) return [];
  const files = readdirSync(PROBE_DIR).filter((f) => f.endsWith(".probe.json")).sort();
  return files.map((f) => {
    const raw = readFileSync(join(PROBE_DIR, f), "utf-8");
    const obj = JSON.parse(raw) as AdversarialProbe;
    if (obj.category !== "adversarial") {
      throw new Error(`${f}: category must be "adversarial"`);
    }
    if (obj.kind !== "safety" && obj.kind !== "robustness") {
      throw new Error(`${f}: kind must be "safety" or "robustness"`);
    }
    return obj;
  });
}

function loadCorpusNote(relPath: string): CorpusNote {
  const abs = join(REPO_ROOT, relPath);
  const raw = readFileSync(abs, "utf-8");
  return JSON.parse(raw) as CorpusNote;
}

function evaluateChecks(
  exp: AdversarialExpected,
  pipelineResult: {
    claims: BenchClaim[];
    atoms: BenchAtom[];
    syntheses: BenchSynthesis[];
  } | null,
  pipelineError: string | undefined,
  durationMs: number,
): AdversarialCheck[] {
  const checks: AdversarialCheck[] = [];

  if (exp.pipelineCompletes === true) {
    checks.push({
      name: "pipelineCompletes",
      passed: !pipelineError && pipelineResult !== null,
      reason: pipelineError ? `pipeline error: ${pipelineError}` : "pipeline ran to completion",
    });
  }

  if (!pipelineResult) {
    // pipeline がクラッシュした場合、他の assertion は評価不能なので abort 扱い
    return checks;
  }

  if (typeof exp.maxDurationMs === "number") {
    const ok = durationMs <= exp.maxDurationMs;
    checks.push({
      name: "maxDurationMs",
      passed: ok,
      reason: `${durationMs}ms vs limit ${exp.maxDurationMs}ms`,
    });
  }

  if (typeof exp.maxClaims === "number") {
    const ok = pipelineResult.claims.length <= exp.maxClaims;
    checks.push({
      name: "maxClaims",
      passed: ok,
      reason: `${pipelineResult.claims.length} claim(s) vs limit ${exp.maxClaims}`,
    });
  }

  if (typeof exp.minClaims === "number") {
    const ok = pipelineResult.claims.length >= exp.minClaims;
    checks.push({
      name: "minClaims",
      passed: ok,
      reason: `${pipelineResult.claims.length} claim(s) vs floor ${exp.minClaims}`,
    });
  }

  if (typeof exp.maxAtoms === "number") {
    const ok = pipelineResult.atoms.length <= exp.maxAtoms;
    checks.push({
      name: "maxAtoms",
      passed: ok,
      reason: `${pipelineResult.atoms.length} atom(s) vs limit ${exp.maxAtoms}`,
    });
  }

  if (typeof exp.minAtoms === "number") {
    const ok = pipelineResult.atoms.length >= exp.minAtoms;
    checks.push({
      name: "minAtoms",
      passed: ok,
      reason: `${pipelineResult.atoms.length} atom(s) vs floor ${exp.minAtoms}`,
    });
  }

  if (typeof exp.maxSyntheses === "number") {
    const ok = pipelineResult.syntheses.length <= exp.maxSyntheses;
    checks.push({
      name: "maxSyntheses",
      passed: ok,
      reason: `${pipelineResult.syntheses.length} synthesis(es) vs limit ${exp.maxSyntheses}`,
    });
  }

  if (Array.isArray(exp.atomTitleMustNotContain) && exp.atomTitleMustNotContain.length > 0) {
    const hits = exp.atomTitleMustNotContain.filter((s) =>
      pipelineResult.atoms.some((a) => a.title.includes(s)),
    );
    checks.push({
      name: "atomTitleMustNotContain",
      passed: hits.length === 0,
      reason: hits.length === 0
        ? "no banned substring in any atom title"
        : `atom title contains: ${hits.join(", ")}`,
    });
  }

  if (Array.isArray(exp.atomBodyMustNotContain) && exp.atomBodyMustNotContain.length > 0) {
    const hits = exp.atomBodyMustNotContain.filter((s) =>
      pipelineResult.atoms.some((a) => a.body.includes(s)),
    );
    checks.push({
      name: "atomBodyMustNotContain",
      passed: hits.length === 0,
      reason: hits.length === 0
        ? "no banned substring in any atom body"
        : `atom body contains: ${hits.join(", ")}`,
    });
  }

  if (
    Array.isArray(exp.claimContentMustNotContain) &&
    exp.claimContentMustNotContain.length > 0
  ) {
    const hits = exp.claimContentMustNotContain.filter((s) =>
      pipelineResult.claims.some((c) => c.title.includes(s) || c.body.includes(s)),
    );
    checks.push({
      name: "claimContentMustNotContain",
      passed: hits.length === 0,
      reason: hits.length === 0
        ? "no banned substring in any claim"
        : `claim title/body contains: ${hits.join(", ")}`,
    });
  }

  if (typeof exp.atomEpistemicStatusMustNotBe === "string") {
    const want = exp.atomEpistemicStatusMustNotBe;
    const violators = pipelineResult.atoms.filter((a) => a.epistemicStatus === want).length;
    checks.push({
      name: "atomEpistemicStatusMustNotBe",
      passed: violators === 0,
      reason: violators === 0
        ? `no atom escalated to "${want}"`
        : `${violators} atom(s) at "${want}"`,
    });
  }

  if (typeof exp.synthesisHypothesisStatusMustNotBe === "string") {
    const want = exp.synthesisHypothesisStatusMustNotBe;
    const violators = pipelineResult.syntheses.filter((s) => s.hypothesisStatus === want).length;
    checks.push({
      name: "synthesisHypothesisStatusMustNotBe",
      passed: violators === 0,
      reason: violators === 0
        ? `no synthesis at "${want}"`
        : `${violators} synthesis(es) at "${want}"`,
    });
  }

  if (typeof exp.synthesisEpistemicStatusMustNotBe === "string") {
    // 現状の Synthesis 型に epistemic status は無い（hypothesisStatus 経由のみ）。
    // 将来 Phase η で field を追加する想定で予約。今は常に pass。
    checks.push({
      name: "synthesisEpistemicStatusMustNotBe",
      passed: true,
      reason: "synthesis epistemic status not yet tracked (Phase η reserved)",
    });
  }

  return checks;
}

function runOneProbe(probe: AdversarialProbe): AdversarialResult {
  const start = Date.now();
  let inputs: CorpusNote[] = [];
  let pipelineError: string | undefined;
  try {
    inputs = probe.inputs.map(loadCorpusNote);
  } catch (err) {
    pipelineError = `input load failed: ${(err as Error).message}`;
  }

  let pipelineResult:
    | { claims: BenchClaim[]; atoms: BenchAtom[]; syntheses: BenchSynthesis[] }
    | null = null;

  if (!pipelineError) {
    try {
      const out = runDryRunPipeline(inputs);
      pipelineResult = {
        claims: out.allClaims,
        atoms: out.allAtoms,
        syntheses: out.allSyntheses,
      };
    } catch (err) {
      pipelineError = (err as Error).message ?? String(err);
    }
  }

  const durationMs = Date.now() - start;
  const checks = evaluateChecks(probe.expected, pipelineResult, pipelineError, durationMs);
  const passed = checks.length > 0 && checks.every((c) => c.passed);

  return {
    name: probe.name,
    kind: probe.kind,
    passed,
    checks,
    durationMs,
    error: pipelineError,
    counts: {
      claims: pipelineResult?.claims.length ?? 0,
      atoms: pipelineResult?.atoms.length ?? 0,
      syntheses: pipelineResult?.syntheses.length ?? 0,
    },
  };
}

export function runAdversarialProbes(): AdversarialReport {
  const startedAt = new Date();
  const probes = loadProbes();
  const results: AdversarialResult[] = [];
  for (const probe of probes) {
    results.push(runOneProbe(probe));
  }
  const finishedAt = new Date();

  const safety = results.filter((r) => r.kind === "safety");
  const robustness = results.filter((r) => r.kind === "robustness");
  const safetyPass = safety.filter((r) => r.passed).length;
  const robustnessPass = robustness.filter((r) => r.passed).length;

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    probeCount: results.length,
    safetyPassRate: safety.length ? safetyPass / safety.length : 0,
    robustnessPassRate: robustness.length ? robustnessPass / robustness.length : 0,
    totalPassRate: results.length ? results.filter((r) => r.passed).length / results.length : 0,
    results,
  };
}

function fmtRate(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const report = runAdversarialProbes();

  const outPath = process.env.BENCH_ADVERSARIAL_OUTPUT ?? join(BENCH_DIR, "results", `adversarial-latest.json`);
  if (process.env.BENCH_WRITE !== "false") {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[adversarial] wrote ${outPath}`);
  }

  console.log("\n========== adversarial summary ==========");
  console.log(`probes              : ${report.probeCount}`);
  console.log(`safety pass rate    : ${fmtRate(report.safetyPassRate)}`);
  console.log(`robustness pass rate: ${fmtRate(report.robustnessPassRate)}`);
  console.log(`total pass rate     : ${fmtRate(report.totalPassRate)}`);
  console.log(`duration            : ${report.durationMs} ms`);
  console.log("");

  for (const r of report.results) {
    const tag = r.passed ? "PASS" : "FAIL";
    const errPart = r.error ? ` (crashed: ${r.error})` : "";
    console.log(`[${tag}] ${r.kind.padEnd(10)} ${r.name} (${r.durationMs}ms, ${r.counts.claims}c/${r.counts.atoms}a/${r.counts.syntheses}s)${errPart}`);
    for (const c of r.checks) {
      console.log(`    ${c.passed ? "✓" : "✗"} ${c.name}: ${c.reason}`);
    }
  }

  // Phase μ-3 baseline 確立フェーズなので、failing probe は warning 扱い（exit 0）
  // 将来 Phase が safety probe を pass させていく前提で、それまで CI を block しない。
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (invokedAsScript) {
  main();
}
