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
//   6. atomEpistemicStatusMustNotBe — 不当な status 昇格を防ぐ
//
// ## dry-run で評価できるチェックとできないチェック
//
// このランナーは `runDryRunPipeline()`（bench/pipeline.ts の heuristic）しか呼ばない。
// dry-run は本番コードを通らず、ノート本文を Claim / Atom にほぼそのまま写す。そのため
// 5. の文字列チェックは本番の性質について何も言えない — FAIL は写したから当然で、PASS は
// 禁止語がたまたま写されない位置（2 行目以降・タイトル以外）にあっただけになる。
// これらは LIVE_ONLY_CHECKS として、dry-run では「未評価（skip）」と報告する。
// 本番側に決定的な処理（例: PII のマスキング）を入れて dry-run からも同じ関数を呼ぶように
// したら、そのチェックを LIVE_ONLY_CHECKS から外して dry-run で評価してよい。
//
// 残りのチェックも本番ではなく bench 自身の heuristic を通るので、CI の adversarial
// ジョブは「dry-run pipeline の自己テスト」と位置づける。
//
// ## baseline
//
// dry-run は決定的なので、probe ごとの判定を `bench/probes/adversarial/baseline.json`
// に記録し、毎回それと比べる。違うときだけ PR コメント用の Markdown を書き出す
// （BENCH_ADVERSARIAL_COMMENT）。bench/ を触らない PR では結果が変わらないので、
// CI はコメントを出さない。判定を意図して変えた PR は、同じ PR で
// `BENCH_ADVERSARIAL_UPDATE_BASELINE=true pnpm bench:adversarial` で取り直す。

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runDryRunPipeline } from "./pipeline.ts";
import type { BenchAtom, BenchClaim, CorpusNote } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const REPO_ROOT = join(__dirname, "..");
const PROBE_DIR = join(BENCH_DIR, "probes", "adversarial");
const BASELINE_PATH = join(PROBE_DIR, "baseline.json");
const BASELINE_DISPLAY_PATH = "bench/probes/adversarial/baseline.json";
const UPDATE_BASELINE_COMMAND = "BENCH_ADVERSARIAL_UPDATE_BASELINE=true pnpm bench:adversarial";

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
  atomTitleMustNotContain?: string[];
  atomBodyMustNotContain?: string[];
  claimContentMustNotContain?: string[];
  atomEpistemicStatusMustNotBe?: string;
};

// expected に書けるキーと、評価側が扱える値の形。型と 1 対 1 に保つため Record で列挙する
// （型にだけ足すとここがコンパイルエラーになる）。キーも値もこれに合わなければ読み込み時に
// エラーにする — 2026-05-27 の Synthesis 撤去後も maxSyntheses などが probe に残り、
// 効いていないチェックが効いているように見えていたため。値の形が違う場合も、評価側で
// 黙って読み飛ばされるのは同じ（例: pipelineCompletes: false は何も検査しない）。
const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isBannedList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0);
const EXPECTED_SHAPES: Record<keyof AdversarialExpected, (v: unknown) => boolean> = {
  // 「完了しないこと」（false）の検査は実装していない
  pipelineCompletes: (v) => v === true,
  maxDurationMs: isCount,
  maxClaims: isCount,
  minClaims: isCount,
  maxAtoms: isCount,
  minAtoms: isCount,
  atomTitleMustNotContain: isBannedList,
  atomBodyMustNotContain: isBannedList,
  claimContentMustNotContain: isBannedList,
  atomEpistemicStatusMustNotBe: (v) => typeof v === "string" && v.length > 0,
};

/** dry-run では評価しないチェック（冒頭コメント参照） */
const LIVE_ONLY_CHECKS: ReadonlySet<keyof AdversarialExpected> = new Set<keyof AdversarialExpected>([
  "atomTitleMustNotContain",
  "atomBodyMustNotContain",
  "claimContentMustNotContain",
]);

export type CheckStatus = "pass" | "fail" | "skip";

export type AdversarialCheck = {
  name: string;
  status: CheckStatus;
  reason: string;
};

export type AdversarialResult = {
  name: string;
  kind: AdversarialProbeKind;
  /** fail が 1 つでもあれば fail、未評価のチェックが残れば skip、全部評価して通れば pass */
  verdict: CheckStatus;
  checks: AdversarialCheck[];
  durationMs: number;
  /** pipeline が throw した場合のみ埋まる */
  error?: string;
  counts: { claims: number; atoms: number };
};

export type VerdictTally = { passed: number; failed: number; skipped: number };

export type AdversarialReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  probeCount: number;
  safety: VerdictTally;
  robustness: VerdictTally;
  results: AdversarialResult[];
};

/** probe JSON を検証して読む。形が違えば throw する（CI ではジョブが落ちる） */
export function parseProbe(fileName: string, raw: string): AdversarialProbe {
  const obj = JSON.parse(raw) as AdversarialProbe;
  if (obj.category !== "adversarial") {
    throw new Error(`${fileName}: category must be "adversarial"`);
  }
  if (obj.kind !== "safety" && obj.kind !== "robustness") {
    throw new Error(`${fileName}: kind must be "safety" or "robustness"`);
  }
  const expected = (obj.expected ?? {}) as Record<string, unknown>;
  const keys = Object.keys(expected);
  if (keys.length === 0) {
    throw new Error(`${fileName}: expected has no checks`);
  }
  const unknown = keys.filter((k) => !Object.hasOwn(EXPECTED_SHAPES, k));
  if (unknown.length > 0) {
    throw new Error(`${fileName}: unknown expected key(s): ${unknown.join(", ")}`);
  }
  const unsupported = keys.filter(
    (k) => !EXPECTED_SHAPES[k as keyof AdversarialExpected](expected[k]),
  );
  if (unsupported.length > 0) {
    throw new Error(`${fileName}: unsupported value for expected key(s): ${unsupported.join(", ")}`);
  }
  return obj;
}

/** probe ファイル群を読む。baseline は name をキーにするので、重複すると判定が上書きされて比較が狂う */
export function parseProbes(files: { fileName: string; raw: string }[]): AdversarialProbe[] {
  const probes = files.map((f) => parseProbe(f.fileName, f.raw));
  const seen = new Set<string>();
  for (const p of probes) {
    if (seen.has(p.name)) throw new Error(`duplicate adversarial probe name: ${p.name}`);
    seen.add(p.name);
  }
  return probes;
}

function loadProbes(): AdversarialProbe[] {
  if (!existsSync(PROBE_DIR)) return [];
  const files = readdirSync(PROBE_DIR).filter((f) => f.endsWith(".probe.json")).sort();
  return parseProbes(
    files.map((f) => ({ fileName: f, raw: readFileSync(join(PROBE_DIR, f), "utf-8") })),
  );
}

function loadCorpusNote(relPath: string): CorpusNote {
  const abs = join(REPO_ROOT, relPath);
  const raw = readFileSync(abs, "utf-8");
  return JSON.parse(raw) as CorpusNote;
}

function statusOf(ok: boolean): CheckStatus {
  return ok ? "pass" : "fail";
}

export function evaluateChecks(
  exp: AdversarialExpected,
  pipelineResult: {
    claims: BenchClaim[];
    atoms: BenchAtom[];
  } | null,
  pipelineError: string | undefined,
  durationMs: number,
): AdversarialCheck[] {
  const checks: AdversarialCheck[] = [];

  if (exp.pipelineCompletes === true) {
    checks.push({
      name: "pipelineCompletes",
      status: statusOf(!pipelineError && pipelineResult !== null),
      reason: pipelineError ? `pipeline error: ${pipelineError}` : "pipeline ran to completion",
    });
  }

  if (!pipelineResult) {
    // pipeline がクラッシュした場合、他の assertion は評価不能なので abort 扱い
    return checks;
  }
  const out = pipelineResult;

  if (typeof exp.maxDurationMs === "number") {
    checks.push({
      name: "maxDurationMs",
      status: statusOf(durationMs <= exp.maxDurationMs),
      reason: `${durationMs}ms vs limit ${exp.maxDurationMs}ms`,
    });
  }

  if (typeof exp.maxClaims === "number") {
    checks.push({
      name: "maxClaims",
      status: statusOf(out.claims.length <= exp.maxClaims),
      reason: `${out.claims.length} claim(s) vs limit ${exp.maxClaims}`,
    });
  }

  if (typeof exp.minClaims === "number") {
    checks.push({
      name: "minClaims",
      status: statusOf(out.claims.length >= exp.minClaims),
      reason: `${out.claims.length} claim(s) vs floor ${exp.minClaims}`,
    });
  }

  if (typeof exp.maxAtoms === "number") {
    checks.push({
      name: "maxAtoms",
      status: statusOf(out.atoms.length <= exp.maxAtoms),
      reason: `${out.atoms.length} atom(s) vs limit ${exp.maxAtoms}`,
    });
  }

  if (typeof exp.minAtoms === "number") {
    checks.push({
      name: "minAtoms",
      status: statusOf(out.atoms.length >= exp.minAtoms),
      reason: `${out.atoms.length} atom(s) vs floor ${exp.minAtoms}`,
    });
  }

  // 2026-05-27: maxSyntheses は synthesizer パイプライン撤退に合わせて廃止。

  // 禁止文字列のチェック。LIVE_ONLY_CHECKS に入っている間は評価しない（冒頭コメント参照）。
  const banned = (
    name: "atomTitleMustNotContain" | "atomBodyMustNotContain" | "claimContentMustNotContain",
    substrings: string[] | undefined,
    where: string,
    contains: (s: string) => boolean,
  ): void => {
    if (!Array.isArray(substrings) || substrings.length === 0) return;
    if (LIVE_ONLY_CHECKS.has(name)) {
      checks.push({ name, status: "skip", reason: "not evaluated in dry-run" });
      return;
    }
    const hits = substrings.filter(contains);
    checks.push({
      name,
      status: statusOf(hits.length === 0),
      reason: hits.length === 0
        ? `no banned substring in any ${where}`
        : `${where} contains: ${hits.join(", ")}`,
    });
  };
  banned("atomTitleMustNotContain", exp.atomTitleMustNotContain, "atom title", (s) =>
    out.atoms.some((a) => a.title.includes(s)),
  );
  banned("atomBodyMustNotContain", exp.atomBodyMustNotContain, "atom body", (s) =>
    out.atoms.some((a) => a.body.includes(s)),
  );
  banned("claimContentMustNotContain", exp.claimContentMustNotContain, "claim title/body", (s) =>
    out.claims.some((c) => c.title.includes(s) || c.body.includes(s)),
  );

  if (typeof exp.atomEpistemicStatusMustNotBe === "string") {
    const want = exp.atomEpistemicStatusMustNotBe;
    const violators = out.atoms.filter((a) => a.epistemicStatus === want).length;
    checks.push({
      name: "atomEpistemicStatusMustNotBe",
      status: statusOf(violators === 0),
      reason: violators === 0
        ? `no atom escalated to "${want}"`
        : `${violators} atom(s) at "${want}"`,
    });
  }

  // 2026-05-27: synthesizer パイプライン撤退に合わせて
  // synthesisHypothesisStatusMustNotBe / synthesisEpistemicStatusMustNotBe を廃止。

  return checks;
}

/** fail が 1 つでもあれば fail。未評価が残るか、チェックが 1 つも無ければ skip */
export function verdictOf(checks: AdversarialCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.length === 0 || checks.some((c) => c.status === "skip")) return "skip";
  return "pass";
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
    | { claims: BenchClaim[]; atoms: BenchAtom[] }
    | null = null;

  if (!pipelineError) {
    try {
      const out = runDryRunPipeline(inputs);
      pipelineResult = {
        claims: out.allClaims,
        atoms: out.allAtoms,
      };
    } catch (err) {
      pipelineError = (err as Error).message ?? String(err);
    }
  }

  const durationMs = Date.now() - start;
  const checks = evaluateChecks(probe.expected, pipelineResult, pipelineError, durationMs);

  return {
    name: probe.name,
    kind: probe.kind,
    verdict: verdictOf(checks),
    checks,
    durationMs,
    error: pipelineError,
    counts: {
      claims: pipelineResult?.claims.length ?? 0,
      atoms: pipelineResult?.atoms.length ?? 0,
    },
  };
}

function tally(results: AdversarialResult[]): VerdictTally {
  return {
    passed: results.filter((r) => r.verdict === "pass").length,
    failed: results.filter((r) => r.verdict === "fail").length,
    skipped: results.filter((r) => r.verdict === "skip").length,
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

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    probeCount: results.length,
    safety: tally(results.filter((r) => r.kind === "safety")),
    robustness: tally(results.filter((r) => r.kind === "robustness")),
    results,
  };
}

// ─── baseline ────────────────────────────────────────────────────────────────

/** baseline に残す probe 1 件分。所要時間やメッセージは揺れるので判定だけを残す */
export type ProbeSnapshot = {
  verdict: CheckStatus;
  checks: Record<string, CheckStatus>;
};

export type AdversarialBaseline = {
  note: string;
  probes: Record<string, ProbeSnapshot>;
};

export type BaselineChange = {
  probe: string;
  /** undefined = baseline に無い（新しい probe） */
  before?: ProbeSnapshot;
  /** undefined = 今回の実行に無い（消えた probe） */
  after?: ProbeSnapshot;
  checkChanges: { name: string; before?: CheckStatus; after?: CheckStatus }[];
};

export function toBaseline(report: Pick<AdversarialReport, "results">): AdversarialBaseline {
  const probes: Record<string, ProbeSnapshot> = {};
  for (const r of report.results) {
    probes[r.name] = {
      verdict: r.verdict,
      checks: Object.fromEntries(r.checks.map((c) => [c.name, c.status])),
    };
  }
  return {
    note: `Per-probe results of \`pnpm bench:adversarial\` (dry-run, deterministic). Re-record with \`${UPDATE_BASELINE_COMMAND}\`.`,
    probes,
  };
}

/** baseline と判定が違う probe を返す（チェックの並び順の違いは無視する） */
export function diffAgainstBaseline(
  baseline: AdversarialBaseline | undefined,
  current: AdversarialBaseline,
): BaselineChange[] {
  const before = baseline?.probes ?? {};
  const names = [...new Set([...Object.keys(before), ...Object.keys(current.probes)])];
  const changes: BaselineChange[] = [];
  for (const probe of names) {
    const b = before[probe];
    const a = current.probes[probe];
    const checkNames = [...new Set([...Object.keys(b?.checks ?? {}), ...Object.keys(a?.checks ?? {})])];
    const checkChanges = checkNames
      .filter((n) => b?.checks[n] !== a?.checks[n])
      .map((n) => ({ name: n, before: b?.checks[n], after: a?.checks[n] }));
    if (b?.verdict !== a?.verdict || checkChanges.length > 0) {
      changes.push({ probe, before: b, after: a, checkChanges });
    }
  }
  return changes;
}

// ─── 出力 ────────────────────────────────────────────────────────────────────

const LABEL: Record<CheckStatus, string> = { pass: "PASS", fail: "FAIL", skip: "SKIP" };
const MARK: Record<CheckStatus, string> = { pass: "✓", fail: "✗", skip: "–" };

function formatTally(t: VerdictTally): string {
  const head = `${t.passed}/${t.passed + t.failed} passed`;
  return t.skipped > 0 ? `${head} (${t.skipped} not evaluated in dry-run)` : head;
}

export function formatReport(report: AdversarialReport): string {
  const lines = [
    "========== adversarial summary ==========",
    `probes     : ${report.probeCount}`,
    `safety     : ${formatTally(report.safety)}`,
    `robustness : ${formatTally(report.robustness)}`,
    `duration   : ${report.durationMs} ms`,
    "",
  ];
  for (const r of report.results) {
    const errPart = r.error ? ` (crashed: ${r.error})` : "";
    lines.push(
      `[${LABEL[r.verdict]}] ${r.kind.padEnd(10)} ${r.name} (${r.durationMs}ms, ${r.counts.claims}c/${r.counts.atoms}a)${errPart}`,
    );
    for (const c of r.checks) {
      lines.push(`    ${MARK[c.status]} ${c.name}: ${c.reason}`);
    }
  }
  if (report.results.some((r) => r.checks.some((c) => c.status === "skip"))) {
    lines.push(
      "",
      "Checks marked \"–\" look for banned strings in the output. The dry-run pipeline copies",
      "note text into claims/atoms, so they only mean something against a live LLM, which this",
      "runner does not call yet (see docs/BENCHMARK.md).",
    );
  }
  return lines.join("\n");
}

function verdictLabel(s: ProbeSnapshot | undefined): string {
  return s ? LABEL[s.verdict] : "—";
}

function describeCheckChanges(c: BaselineChange, sep: string, code: boolean): string {
  if (!c.before) return "new probe";
  if (!c.after) return "probe removed";
  return c.checkChanges
    .map((x) => `${code ? `\`${x.name}\`` : x.name} ${x.before ?? "—"} → ${x.after ?? "—"}`)
    .join(sep);
}

function formatComparison(changes: BaselineChange[], hasBaseline: boolean): string {
  if (!hasBaseline) {
    return `baseline   : none at ${BASELINE_DISPLAY_PATH} — record it with ${UPDATE_BASELINE_COMMAND}`;
  }
  if (changes.length === 0) return `baseline   : matches ${BASELINE_DISPLAY_PATH}`;
  return [
    `baseline   : ${changes.length} probe(s) differ from ${BASELINE_DISPLAY_PATH}`,
    ...changes.map((c) => {
      const checks = describeCheckChanges(c, ", ", false);
      return `    ${c.probe}: ${verdictLabel(c.before)} → ${verdictLabel(c.after)}${checks ? ` (${checks})` : ""}`;
    }),
    `    if this is intended, re-record it with ${UPDATE_BASELINE_COMMAND}`,
  ].join("\n");
}

/** PR コメント用の Markdown。baseline と違う probe があるときだけ書き出す */
export function formatComment(changes: BaselineChange[], hasBaseline: boolean, reportText: string): string {
  const rows = changes.map((c) => {
    const checks = describeCheckChanges(c, "<br>", true) || "—";
    return `| \`${c.probe}\` | ${verdictLabel(c.before)} | ${verdictLabel(c.after)} | ${checks} |`;
  });
  return [
    "## Adversarial probes",
    "",
    hasBaseline
      ? `This PR changes the dry-run adversarial probe results recorded in \`${BASELINE_DISPLAY_PATH}\`.`
      : `There is no baseline at \`${BASELINE_DISPLAY_PATH}\` to compare with.`,
    "",
    "| probe | baseline | this PR | changed checks |",
    "|---|---|---|---|",
    ...rows,
    "",
    `If this is intended, re-record the baseline in this PR with \`${UPDATE_BASELINE_COMMAND}\`. Otherwise every later PR repeats this comment.`,
    "",
    "<details><summary>Full probe results</summary>",
    "",
    "```",
    reportText,
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

function main(): void {
  const report = runAdversarialProbes();

  const outPath = process.env.BENCH_ADVERSARIAL_OUTPUT ?? join(BENCH_DIR, "results", `adversarial-latest.json`);
  if (process.env.BENCH_WRITE !== "false") {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[adversarial] wrote ${outPath}`);
  }

  const reportText = formatReport(report);
  console.log(reportText);
  console.log("");

  const current = toBaseline(report);
  // PR コメント用 Markdown の書き出し先（CI が渡す）。baseline と同じなら消しておき、
  // CI はファイルが無いことを見て「コメントを出さない / 前のコメントを消す」を決める。
  const commentPath = process.env.BENCH_ADVERSARIAL_COMMENT;

  if (process.env.BENCH_ADVERSARIAL_UPDATE_BASELINE === "true") {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
    console.log(`[adversarial] wrote ${BASELINE_DISPLAY_PATH}`);
    if (commentPath) rmSync(commentPath, { force: true });
    return;
  }

  const baseline = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as AdversarialBaseline)
    : undefined;
  const changes = diffAgainstBaseline(baseline, current);
  console.log(formatComparison(changes, baseline !== undefined));

  if (commentPath) {
    if (changes.length > 0) {
      writeFileSync(commentPath, formatComment(changes, baseline !== undefined, reportText), "utf-8");
    } else {
      rmSync(commentPath, { force: true });
    }
  }

  // 判定の変化は warning 扱い（exit 0）。probe 定義の誤りなどでスクリプト自体が
  // 落ちたときだけ非 0 で終わり、CI は pipefail でそれを拾ってジョブを落とす。
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (invokedAsScript) {
  main();
}
