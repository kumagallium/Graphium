// Phase μ-1: bench runner（pnpm bench:run のエントリポイント）
//
// 1. corpus / probes / ground-truth をロード
// 2. パイプラインを実行（live or dry-run）
// 3. metrics を計算
// 4. baseline.json または latest.json に書き出し
//
// 環境変数:
//   BENCH_PROFILE   profile 名 (default: baseline)
//   BENCH_MODE      live / dry-run (default: API key 有無で自動判定)
//   BENCH_OUTPUT    出力先パス (default: bench/baseline.json か bench/latest.json)
//   BENCH_WRITE     true なら出力ファイルに書き込む (default: true)
//   BENCH_API_KEY   live mode 用 LLM API key
//   BENCH_MODEL_ID  default: gpt-oss-120b
//   BENCH_API_BASE  default: https://api.ai.sakura.ad.jp/v1

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, loadGroundTruthMap, loadProbes, BENCH_DIR } from "./load.ts";
import { runDryRunPipeline, runLivePipeline } from "./pipeline.ts";
import { computeMetrics } from "./metrics.ts";
import { evaluateProbes } from "./probes-eval.ts";
import { getBenchModelConfig, resolveMode } from "./config.ts";
import type { BenchProfile, BenchRunOutput } from "./types.ts";

export async function runBench(
  profile: BenchProfile = "baseline",
): Promise<BenchRunOutput> {
  const startedAt = new Date();
  const mode = resolveMode();
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
  notes.push(`model=${cfg.modelId} via ${cfg.apiBase ?? "(default)"}`);
  notes.push(`corpusSize=${corpus.length}, probeCount=${probes.length}`);

  const pipelineResult = mode === "live"
    ? await runLivePipeline(corpus)
    : runDryRunPipeline(corpus);

  const { probeResults } = evaluateProbes(probes);

  const metrics = computeMetrics({
    claims: pipelineResult.allClaims,
    atoms: pipelineResult.allAtoms,
    syntheses: pipelineResult.allSyntheses,
    gtMap,
    probeResults,
  });

  const finishedAt = new Date();

  const out: BenchRunOutput = {
    profile,
    mode,
    modelId: cfg.modelId,
    modelProvider: cfg.provider,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    corpusSize: corpus.length,
    probeCount: probes.length,
    pipelineByNote: pipelineResult.pipelineByNote,
    allClaims: pipelineResult.allClaims,
    allAtoms: pipelineResult.allAtoms,
    allSyntheses: pipelineResult.allSyntheses,
    metrics,
    probeResults,
    notes,
  };

  return out;
}

async function main(): Promise<void> {
  const profile = (process.env.BENCH_PROFILE ?? "baseline") as BenchProfile;
  const out = await runBench(profile);

  // 出力先: BENCH_OUTPUT 優先。なければ profile によって baseline.json / latest.json
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

  // 標準出力に metrics summary を出す
  console.log("\n========== bench summary ==========");
  console.log(`profile               : ${out.profile}`);
  console.log(`mode                  : ${out.mode}`);
  console.log(`model                 : ${out.modelId} (${out.modelProvider})`);
  console.log(`duration              : ${out.durationMs} ms`);
  console.log(`corpus / probes       : ${out.corpusSize} / ${out.probeCount}`);
  console.log(`claims/atoms/synth    : ${out.metrics.claim_count_total} / ${out.metrics.atom_count_total} / ${out.metrics.synthesis_count_total}`);
  console.log(`lift_score            : ${out.metrics.lift_score}`);
  console.log(`mode_entropy          : ${out.metrics.mode_distribution_entropy}`);
  console.log(`epistemic_preservation: ${out.metrics.epistemic_preservation}`);
  console.log(`adversarial_pass_rate : ${out.metrics.adversarial_pass_rate}`);
  console.log(`novelty_score         : ${out.metrics.novelty_score}`);
  console.log(`observation_atom_ratio: ${out.metrics.observation_atom_ratio}`);
  if (out.mode === "dry-run") {
    console.log("\n[note] dry-run mode で実行されました。実 LLM ベースの baseline を取るには");
    console.log("       BENCH_API_KEY (or SAKURA_AI_API_KEY) を設定して再実行してください。");
  }
}

// tsx で直接実行された場合のみ main を走らせる
const invokedAsScript = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedAsScript || process.argv[1]?.endsWith("runner.ts")) {
  main().catch((err) => {
    console.error("[bench] error:", err);
    process.exit(1);
  });
}

// Re-export for compare.ts と test 用
export { existsSync };
