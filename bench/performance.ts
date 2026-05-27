// Phase μ-3: performance regression test
//
// 2026-05-27: synthesizer 自動生成パイプライン撤退に合わせて、Atomizer までの
// 2-stage pipeline を計測対象とする。
//
// 3 軸を baseline と比較する:
//   1. Pipeline 完走時間  — Atom 100 件相当の 2-stage パイプラインを通す時間
//   2. メモリ使用量 peak  — heapUsed の最大値（< 100 MB を維持）
//   3. INDEX サイズの肥大化 — Atom 100 件の dry-run pipeline 出力 JSON サイズ
//
// 結果は `bench/performance/baseline.json` と比較し、20% 以上の悪化で warning。
// 「LLM call なし」で完全に決定的に走るため、CI で毎 PR 走らせても無償。
//
// baseline 更新: `BENCH_PERF_UPDATE_BASELINE=true pnpm bench:performance`
// （Phase μ-3 の最初は baseline.json を新規生成）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { runDryRunPipeline } from "./pipeline.ts";
import type { CorpusNote } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const PERF_DIR = join(BENCH_DIR, "performance");
const BASELINE_PATH = join(PERF_DIR, "baseline.json");

/** 1 ノート分のテンプレート本文。100 ノート合成のために repeat させる。 */
const TEMPLATE_BODIES = [
  "[Step] サンプル A を 850℃ で 5 分焼結した。\n[Output] 緻密度 95% を達成。XRD で主相が確認された。",
  "[Step] ZnSb 粉末を機械合金化で 3 時間処理した。\n[Output] 平均粒径 200 nm に揃った。後段 SPS に投入予定。",
  "もしかして、ペレット表面の白い相は Zn の蒸発由来なのかもしれない。データはない。",
  "再現実験を 3 回繰り返した。標準偏差は 0.04（平均比約 4%）で、再現性は許容範囲内。",
  "ただし、温度が分解点を超えた条件ではこの傾向は逆転する。境界条件として明示しておく。",
];

const TEMPLATE_TITLES = [
  "焼結条件 A の評価",
  "機械合金化の前処理",
  "casual 思いつき: 白相の起源",
  "再現性確認",
  "境界条件メモ",
];

const TEMPLATE_CATEGORIES: CorpusNote["category"][] = [
  "clean-lab",
  "clean-lab",
  "casual-musing",
  "clean-lab",
  "contradiction-pair",
];

/** 100 ノート相当の合成 corpus を作る（決定的）。 */
function buildSyntheticCorpus(size: number): CorpusNote[] {
  const out: CorpusNote[] = [];
  for (let i = 0; i < size; i++) {
    const idx = i % TEMPLATE_BODIES.length;
    out.push({
      noteId: `perf-${String(i).padStart(3, "0")}`,
      title: `${TEMPLATE_TITLES[idx]} #${i}`,
      body: TEMPLATE_BODIES[idx],
      category: TEMPLATE_CATEGORIES[idx],
      language: "ja",
    });
  }
  return out;
}

/** ms 単位の wall-clock 時間。process.hrtime のほうが精度が高いが Number で十分。 */
function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export type PerformanceResult = {
  corpusSize: number;
  /** 合成 corpus を dry-run pipeline に通した完走時間 (ms)。3 回計測の median */
  durationMedianMs: number;
  durationSamplesMs: number[];
  /** heapUsed の peak (bytes)。pipeline 終了直後の heapUsed - pipeline 開始時 heapUsed */
  heapDeltaPeakBytes: number;
  /** 全 atoms の JSON byte size。INDEX 肥大化の代理 */
  atomsJsonBytes: number;
  /** pipeline が出した件数 */
  counts: { claims: number; atoms: number };
};

export type PerformanceBaseline = {
  recordedAt: string;
  result: PerformanceResult;
};

export type PerformanceReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: PerformanceResult;
  baseline?: PerformanceResult;
  regressions: PerformanceRegression[];
  passed: boolean;
};

export type PerformanceRegression = {
  metric: string;
  baseline: number;
  current: number;
  deltaPct: number;
  thresholdPct: number;
  isRegression: boolean;
};

const REGRESSION_THRESHOLD_PCT = 20;
const SYNTH_CORPUS_SIZE = 100;
const SAMPLES = 3;

function measureOnce(corpus: CorpusNote[]): PerformanceResult {
  // GC を呼んで heap 計測をクリーンにする（node --expose-gc 起動時のみ）
  // global.gc は標準では undef。あれば使う、なくても問題なし。
  if (typeof (globalThis as any).gc === "function") {
    (globalThis as any).gc();
  }
  const heapStart = process.memoryUsage().heapUsed;
  const t0 = nowMs();
  const result = runDryRunPipeline(corpus);
  const t1 = nowMs();
  const heapEnd = process.memoryUsage().heapUsed;
  const heapDelta = Math.max(0, heapEnd - heapStart);

  const atomsJsonBytes = Buffer.byteLength(JSON.stringify(result.allAtoms), "utf-8");

  return {
    corpusSize: corpus.length,
    durationMedianMs: t1 - t0,
    durationSamplesMs: [t1 - t0],
    heapDeltaPeakBytes: heapDelta,
    atomsJsonBytes,
    counts: {
      claims: result.allClaims.length,
      atoms: result.allAtoms.length,
    },
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runPerformanceTest(): PerformanceReport {
  const startedAt = new Date();
  const corpus = buildSyntheticCorpus(SYNTH_CORPUS_SIZE);

  const samples: PerformanceResult[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(measureOnce(corpus));
  }

  const durations = samples.map((s) => s.durationMedianMs);
  const heapPeaks = samples.map((s) => s.heapDeltaPeakBytes);
  const atomsSizes = samples.map((s) => s.atomsJsonBytes);

  // 代表サンプル（counts は決定的なので samples[0] でよい）
  const representative: PerformanceResult = {
    corpusSize: SYNTH_CORPUS_SIZE,
    durationMedianMs: median(durations),
    durationSamplesMs: durations,
    // peak は最大値（複数 run の中で最も悪い値を「peak」とする）
    heapDeltaPeakBytes: Math.max(...heapPeaks),
    atomsJsonBytes: median(atomsSizes),
    counts: samples[0].counts,
  };

  let baseline: PerformanceResult | undefined;
  const regressions: PerformanceRegression[] = [];
  if (existsSync(BASELINE_PATH)) {
    const baselineRaw = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as PerformanceBaseline;
    baseline = baselineRaw.result;
    regressions.push(
      regressionOf("duration_ms", baseline.durationMedianMs, representative.durationMedianMs),
      regressionOf("heap_peak_bytes", baseline.heapDeltaPeakBytes, representative.heapDeltaPeakBytes),
      regressionOf("atoms_json_bytes", baseline.atomsJsonBytes, representative.atomsJsonBytes),
    );
  }

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    result: representative,
    baseline,
    regressions,
    passed: regressions.every((r) => !r.isRegression),
  };
}

function regressionOf(metric: string, base: number, cur: number): PerformanceRegression {
  if (base <= 0) {
    return { metric, baseline: base, current: cur, deltaPct: 0, thresholdPct: REGRESSION_THRESHOLD_PCT, isRegression: false };
  }
  const deltaPct = ((cur - base) / base) * 100;
  return {
    metric,
    baseline: base,
    current: cur,
    deltaPct,
    thresholdPct: REGRESSION_THRESHOLD_PCT,
    isRegression: deltaPct > REGRESSION_THRESHOLD_PCT,
  };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`;
  return `${(b / 1024 / 1024).toFixed(2)} MiB`;
}

function main(): void {
  const report = runPerformanceTest();

  const updateBaseline = process.env.BENCH_PERF_UPDATE_BASELINE === "true" || !existsSync(BASELINE_PATH);
  if (updateBaseline) {
    const newBaseline: PerformanceBaseline = {
      recordedAt: new Date().toISOString(),
      result: report.result,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2), "utf-8");
    console.log(`[perf] wrote new baseline at ${BASELINE_PATH}`);
  }

  const outPath =
    process.env.BENCH_PERF_OUTPUT ?? join(BENCH_DIR, "results", `performance-latest.json`);
  if (process.env.BENCH_WRITE !== "false") {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[perf] wrote ${outPath}`);
  }

  console.log("\n========== performance summary ==========");
  console.log(`corpus size       : ${report.result.corpusSize}`);
  console.log(`duration (median) : ${report.result.durationMedianMs.toFixed(2)} ms`);
  console.log(`heap delta peak   : ${fmtBytes(report.result.heapDeltaPeakBytes)}`);
  console.log(`atoms json size   : ${fmtBytes(report.result.atomsJsonBytes)}`);
  console.log(`counts            : ${report.result.counts.claims}c / ${report.result.counts.atoms}a`);
  console.log("");

  if (report.regressions.length === 0) {
    console.log("(no baseline yet — current run becomes the new baseline)");
  } else {
    console.log("baseline comparison:");
    for (const r of report.regressions) {
      const flag = r.isRegression ? "⚠ REGRESSION" : "ok";
      const sign = r.deltaPct >= 0 ? "+" : "";
      console.log(
        `  ${r.metric.padEnd(20)}: baseline ${r.baseline.toFixed(0)} → current ${r.current.toFixed(0)} (${sign}${r.deltaPct.toFixed(1)}%) ${flag}`,
      );
    }
  }

  // CI block は意図的にしない（パフォーマンスは noisy なので warning のみ）。
  // 強制で fail させたい場合は `BENCH_PERF_STRICT=true` で起動する。
  if (!report.passed && process.env.BENCH_PERF_STRICT === "true") {
    process.exit(1);
  }
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (invokedAsScript) {
  main();
}
