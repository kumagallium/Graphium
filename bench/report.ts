// Phase μ-1: report 生成
//
// pnpm bench:report — 最新の bench 出力を Markdown table で表示する。
// 入力: bench/baseline.json (BENCH_INPUT で override 可)。

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BENCH_DIR } from "./load.ts";
import type { BenchRunOutput } from "./types.ts";

function loadRun(path: string): BenchRunOutput {
  if (!existsSync(path)) {
    throw new Error(`bench output not found: ${path}. Run \`pnpm bench:run\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as BenchRunOutput;
}

export function renderReport(run: BenchRunOutput): string {
  const lines: string[] = [];
  lines.push(`# Bench Report — profile: ${run.profile}`);
  lines.push("");
  lines.push(`- mode: ${run.mode}`);
  lines.push(`- model: \`${run.modelId}\` (${run.modelProvider})`);
  lines.push(`- started: ${run.startedAt}`);
  lines.push(`- duration: ${run.durationMs} ms`);
  lines.push(`- corpus / probes: ${run.corpusSize} / ${run.probeCount}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("| metric | value |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(run.metrics)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("");
  lines.push("## Probes");
  lines.push("");
  lines.push("| probe | passed | reason |");
  lines.push("|---|---|---|");
  for (const p of run.probeResults) {
    const reason = p.reason.replace(/\|/g, "/");
    lines.push(`| ${p.name} | ${p.passed ? "✓" : "✗"} | ${reason} |`);
  }
  lines.push("");
  lines.push("## Synthesis mode distribution");
  lines.push("");
  const modeCounts: Record<string, number> = { deductive: 0, abductive: 0, analogical: 0, dialectic: 0 };
  for (const s of run.allSyntheses) modeCounts[s.mode] = (modeCounts[s.mode] ?? 0) + 1;
  lines.push("| mode | count |");
  lines.push("|---|---|");
  for (const [m, c] of Object.entries(modeCounts)) lines.push(`| ${m} | ${c} |`);
  lines.push("");
  if (run.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const n of run.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

function main(): void {
  const inputPath = process.env.BENCH_INPUT ?? join(BENCH_DIR, "baseline.json");
  const run = loadRun(inputPath);
  console.log(renderReport(run));
}

if (process.argv[1]?.endsWith("report.ts")) {
  main();
}
