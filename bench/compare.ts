// Phase μ-1: ブランチ間 delta 計算
//
// 使い方:
//   pnpm bench:compare main           # 現在の latest を main の baseline と比較
//   BENCH_LEFT=path/to/old.json BENCH_RIGHT=path/to/new.json pnpm bench:compare
//
// 引数で渡されたブランチ名は git で baseline.json を取り出すヒント。
// 単純化のため、左 = bench/baseline.json、右 = bench/latest-<profile>.json を比較する。

import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BENCH_DIR } from "./load.ts";
import type { BenchRunOutput } from "./types.ts";

function loadJson(path: string): BenchRunOutput {
  if (!existsSync(path)) throw new Error(`not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8")) as BenchRunOutput;
}

function fetchBaselineFromBranch(branch: string): BenchRunOutput {
  // git show <branch>:bench/baseline.json でファイル取得
  const out = execSync(`git show ${branch}:bench/baseline.json`, { encoding: "utf-8" });
  return JSON.parse(out) as BenchRunOutput;
}

export type Delta = {
  metric: string;
  left: number;
  right: number;
  delta: number;
  pct?: number;
};

export function computeDelta(left: BenchRunOutput, right: BenchRunOutput): Delta[] {
  const out: Delta[] = [];
  const keys = Object.keys(right.metrics) as (keyof typeof right.metrics)[];
  for (const k of keys) {
    const l = (left.metrics as Record<string, number>)[k] ?? 0;
    const r = (right.metrics as Record<string, number>)[k] ?? 0;
    const delta = r - l;
    const pct = l !== 0 ? (delta / l) * 100 : undefined;
    out.push({ metric: k, left: l, right: r, delta: round3(delta), pct: pct !== undefined ? round1(pct) : undefined });
  }
  return out;
}

export function renderDeltaTable(left: BenchRunOutput, right: BenchRunOutput): string {
  const deltas = computeDelta(left, right);
  const lines: string[] = [];
  lines.push(`# Bench delta`);
  lines.push("");
  lines.push(`- left  (${left.profile} / ${left.mode} / ${left.startedAt})`);
  lines.push(`- right (${right.profile} / ${right.mode} / ${right.startedAt})`);
  lines.push("");
  lines.push("| metric | left | right | Δ | Δ% |");
  lines.push("|---|---|---|---|---|");
  for (const d of deltas) {
    const arrow = d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : "·";
    lines.push(`| ${d.metric} | ${d.left} | ${d.right} | ${arrow} ${d.delta} | ${d.pct ?? "-"} |`);
  }
  return lines.join("\n");
}

function main(): void {
  const arg = process.argv[2];
  let left: BenchRunOutput;
  let right: BenchRunOutput;

  const leftEnv = process.env.BENCH_LEFT;
  const rightEnv = process.env.BENCH_RIGHT;
  if (leftEnv && rightEnv) {
    left = loadJson(leftEnv);
    right = loadJson(rightEnv);
  } else if (arg) {
    // git ブランチ指定: 左 = <branch>:bench/baseline.json、右 = ローカル bench/baseline.json
    try {
      left = fetchBaselineFromBranch(arg);
    } catch (err) {
      console.error(`[bench] ${arg} の baseline.json 取り出しに失敗: ${(err as Error).message}`);
      console.error(`        ローカル bench/baseline.json と bench/latest-baseline.json を比較します。`);
      left = loadJson(join(BENCH_DIR, "baseline.json"));
      right = loadJson(join(BENCH_DIR, "latest-baseline.json"));
      console.log(renderDeltaTable(left, right));
      return;
    }
    right = loadJson(join(BENCH_DIR, "baseline.json"));
  } else {
    left = loadJson(join(BENCH_DIR, "baseline.json"));
    const latest = join(BENCH_DIR, "latest-baseline.json");
    right = existsSync(latest) ? loadJson(latest) : left;
  }

  console.log(renderDeltaTable(left, right));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

if (process.argv[1]?.endsWith("compare.ts")) {
  main();
}
