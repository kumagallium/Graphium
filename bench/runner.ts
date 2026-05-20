// Phase μ-1 follow-up: bench runner with n=3 averaging
//
// 1. corpus / probes / ground-truth をロード
// 2. パイプラインを N 回独立に実行（live or dry-run）
// 3. 各 run の metric を計算し、N≥2 なら集約（median を代表値）
// 4. baseline.json または latest.json に書き出し
//
// 環境変数:
//   BENCH_PROFILE         profile 名 (default: baseline)
//   BENCH_MODE            live / dry-run (default: API key 有無で自動判定)
//   BENCH_N               独立サンプル数 (default: 3 in live, 1 in dry-run)
//   BENCH_OUTPUT          出力先パス
//   BENCH_WRITE           true で書き込み (default: true)
//   BENCH_API_KEY         live mode 用 LLM API key
//   BENCH_MODEL_ID        default: gpt-oss-120b
//   BENCH_API_BASE        default: https://api.ai.sakura.ad.jp/v1
//   BENCH_CORPUS_LIMIT    smoke 用に corpus を先頭 N 件に絞る
//
// 集約の方針:
//   - 代表値は median（外れ値に強い、奇数 n で再現性が高い）
//   - 各 metric 個別に median を取り、合成統計 (distribution) も残す
//   - pipelineByNote / allClaims / allAtoms / allSyntheses は「median lift_score の run」の
//     素データを保存する。複数 run の素データを全部残すと baseline.json が肥大化するため
//     代表 run 1 つに絞る。各 run の生 metric は runs[] に残る。

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, loadGroundTruthMap, loadProbes, BENCH_DIR } from "./load.ts";
import { runDryRunPipeline, runLivePipeline, type DryRunResult } from "./pipeline.ts";
import { computeMetricsWithJudges } from "./metrics.ts";
import { evaluateProbes } from "./probes-eval.ts";
import { buildJudges } from "./judge.ts";
import { getBenchModelConfig, resolveMode } from "./config.ts";
import type {
  BenchAggregate,
  BenchMetrics,
  BenchMetricSummary,
  BenchProfile,
  BenchRunOutput,
  BenchRunSample,
  ProbeResult,
} from "./types.ts";

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function summarize(values: number[]): BenchMetricSummary {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return {
    median: round3(median(values)),
    mean: round3(mean(values)),
    min: round3(min),
    max: round3(max),
    range: round3(max - min),
  };
}

function aggregateMetrics(samples: BenchRunSample[]): {
  metrics: BenchMetrics;
  aggregate: BenchAggregate;
} {
  const keys: (keyof BenchMetrics)[] = [
    "lift_score",
    "mode_distribution_entropy",
    "epistemic_preservation",
    "adversarial_pass_rate",
    "novelty_score",
    "claim_count_total",
    "atom_count_total",
    "synthesis_count_total",
    "observation_atom_ratio",
    "cross_language_consistency",
    "domain_balance_score",
  ];
  const distribution = {} as Record<keyof BenchMetrics, BenchMetricSummary>;
  for (const k of keys) {
    const values = samples.map((s) => s.metrics[k]);
    distribution[k] = summarize(values);
  }
  const representativeMetrics = {} as BenchMetrics;
  for (const k of keys) {
    representativeMetrics[k] = distribution[k].median;
  }
  // 代表 run を選ぶ: lift_score が median に最も近い run（同点なら最初）
  const lifts = samples.map((s) => s.metrics.lift_score);
  const med = median(lifts);
  let representativeRunIndex = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs(samples[i].metrics.lift_score - med);
    if (d < bestDelta) {
      bestDelta = d;
      representativeRunIndex = i;
    }
  }
  return {
    metrics: representativeMetrics,
    aggregate: {
      statistic: "median",
      representativeRunIndex,
      distribution,
    },
  };
}

function resolveN(mode: "live" | "dry-run"): number {
  const raw = process.env.BENCH_N;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  // live は noise が大きいので default n=3。dry-run は決定的なので n=1。
  return mode === "live" ? 3 : 1;
}

export async function runBench(
  profile: BenchProfile = "baseline",
): Promise<BenchRunOutput> {
  const startedAt = new Date();
  const mode = resolveMode();
  const n = resolveN(mode);
  const cfg = getBenchModelConfig();

  let corpus = loadCorpus();
  const limitRaw = process.env.BENCH_CORPUS_LIMIT;
  if (limitRaw) {
    const limit = parseInt(limitRaw, 10);
    if (Number.isFinite(limit) && limit > 0 && limit < corpus.length) {
      corpus = corpus.slice(0, limit);
    }
  }
  const probes = loadProbes();
  const gtMap = loadGroundTruthMap();

  const notes: string[] = [];
  notes.push(`profile=${profile}`);
  notes.push(`mode=${mode}`);
  notes.push(`n=${n}`);
  notes.push(`model=${cfg.modelId} via ${cfg.apiBase ?? "(default)"}`);
  notes.push(`corpusSize=${corpus.length}, probeCount=${probes.length}`);

  // probe は LLM-stub なくしても再現性が高いので 1 回だけ走らせる
  const { probeResults } = evaluateProbes(probes);

  const judges = buildJudges(mode);
  notes.push(`judge=${judges.kind} (${judges.meta.modelId})`);

  type PerRun = {
    sample: BenchRunSample;
    pipeline: DryRunResult;
    perMetricFull: BenchMetrics;
    probeResults: ProbeResult[];
    liftDetails: { passed: boolean; reason: string; atomTitle: string }[];
    noveltyDetails: { passed: boolean; reason: string; synthesisTitle: string }[];
  };
  const runs: PerRun[] = [];
  for (let i = 0; i < n; i++) {
    const runStart = new Date();
    if (n > 1) console.log(`[bench] === sample ${i + 1}/${n} ===`);
    const pipeline = mode === "live" ? await runLivePipeline(corpus) : runDryRunPipeline(corpus);
    const judged = await computeMetricsWithJudges({
      claims: pipeline.allClaims,
      atoms: pipeline.allAtoms,
      syntheses: pipeline.allSyntheses,
      gtMap,
      probeResults,
      judges,
      corpus,
    });
    const runEnd = new Date();
    runs.push({
      sample: {
        index: i,
        startedAt: runStart.toISOString(),
        durationMs: runEnd.getTime() - runStart.getTime(),
        metrics: judged.metrics,
        probePassCount: probeResults.filter((p) => p.passed).length,
      },
      pipeline,
      perMetricFull: judged.metrics,
      probeResults,
      liftDetails: judged.liftDetails,
      noveltyDetails: judged.noveltyDetails,
    });
  }

  const samples = runs.map((r) => r.sample);
  let representativeMetrics: BenchMetrics;
  let aggregate: BenchAggregate | undefined;
  let representativeRun: PerRun;

  if (n >= 2) {
    const agg = aggregateMetrics(samples);
    representativeMetrics = agg.metrics;
    aggregate = agg.aggregate;
    representativeRun = runs[agg.aggregate.representativeRunIndex];
  } else {
    representativeMetrics = samples[0].metrics;
    representativeRun = runs[0];
  }

  const finishedAt = new Date();

  const out: BenchRunOutput = {
    profile,
    mode,
    modelId: cfg.modelId,
    modelProvider: cfg.provider,
    judge: { kind: judges.kind, ...judges.meta },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    corpusSize: corpus.length,
    probeCount: probes.length,
    n,
    pipelineByNote: representativeRun.pipeline.pipelineByNote,
    allClaims: representativeRun.pipeline.allClaims,
    allAtoms: representativeRun.pipeline.allAtoms,
    allSyntheses: representativeRun.pipeline.allSyntheses,
    metrics: representativeMetrics,
    probeResults,
    liftJudgments: representativeRun.liftDetails,
    noveltyJudgments: representativeRun.noveltyDetails,
    runs: n >= 2 ? samples : undefined,
    aggregate,
    notes,
  };

  return out;
}

function fmt(n: number): string {
  return n.toFixed(3);
}

function summaryLine(label: string, metric: keyof BenchMetrics, out: BenchRunOutput): string {
  const dist = out.aggregate?.distribution?.[metric];
  if (!dist) return `${label.padEnd(22)}: ${fmt(out.metrics[metric] as number)}`;
  return `${label.padEnd(22)}: ${fmt(dist.median)} (mean ${fmt(dist.mean)}, range ${fmt(dist.min)}–${fmt(dist.max)})`;
}

async function main(): Promise<void> {
  const profile = (process.env.BENCH_PROFILE ?? "baseline") as BenchProfile;
  const out = await runBench(profile);

  const defaultPath =
    profile === "baseline"
      ? join(BENCH_DIR, "baseline.json")
      : join(BENCH_DIR, `latest-${profile}.json`);
  const outPath = process.env.BENCH_OUTPUT ?? defaultPath;
  const shouldWrite = process.env.BENCH_WRITE !== "false";

  if (shouldWrite) {
    writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
    console.log(`[bench] wrote ${outPath}`);
  }

  console.log("\n========== bench summary ==========");
  console.log(`profile               : ${out.profile}`);
  console.log(`mode                  : ${out.mode}  (n=${out.n}${out.aggregate ? `, statistic=${out.aggregate.statistic}` : ""})`);
  console.log(`model                 : ${out.modelId} (${out.modelProvider})`);
  console.log(`judge                 : ${out.judge?.kind ?? "n/a"} (${out.judge?.modelId ?? "n/a"})`);
  console.log(`duration              : ${out.durationMs} ms`);
  console.log(`corpus / probes       : ${out.corpusSize} / ${out.probeCount}`);
  console.log(`claims/atoms/synth    : ${out.metrics.claim_count_total} / ${out.metrics.atom_count_total} / ${out.metrics.synthesis_count_total}`);
  console.log(summaryLine("lift_score", "lift_score", out));
  console.log(summaryLine("mode_entropy", "mode_distribution_entropy", out));
  console.log(summaryLine("epistemic_preservation", "epistemic_preservation", out));
  console.log(summaryLine("adversarial_pass_rate", "adversarial_pass_rate", out));
  console.log(summaryLine("novelty_score", "novelty_score", out));
  console.log(summaryLine("observation_atom_ratio", "observation_atom_ratio", out));
  console.log(summaryLine("cross_language_consistency", "cross_language_consistency", out));
  console.log(summaryLine("domain_balance_score", "domain_balance_score", out));
  if (out.runs) {
    console.log("\nper-run lift / entropy / obs_ratio:");
    for (const r of out.runs) {
      console.log(
        `  #${r.index + 1}: ${fmt(r.metrics.lift_score)} / ${fmt(r.metrics.mode_distribution_entropy)} / ${fmt(r.metrics.observation_atom_ratio)}`,
      );
    }
  }
  if (out.mode === "dry-run") {
    console.log("\n[note] dry-run mode で実行されました。実 LLM ベースの baseline を取るには");
    console.log("       BENCH_API_KEY (or SAKURA_AI_API_KEY) を設定して再実行してください。");
  }
}

const invokedAsScript = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedAsScript || process.argv[1]?.endsWith("runner.ts")) {
  main().catch((err) => {
    console.error("[bench] error:", err);
    process.exit(1);
  });
}
