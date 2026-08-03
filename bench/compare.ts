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

function tryLoadJson(path: string): BenchRunOutput | null {
  try {
    return loadJson(path);
  } catch {
    return null;
  }
}

function fetchBaselineFromBranch(branch: string): BenchRunOutput {
  // git show <branch>:bench/baseline.json でファイル取得
  const out = execSync(`git show ${branch}:bench/baseline.json`, { encoding: "utf-8" });
  return JSON.parse(out) as BenchRunOutput;
}

/** baseline が見つからないときに CI コメントへ出す説明（throw で落とさない）。
 *  bench.yml は stdout を delta.md にリダイレクトして sticky comment に貼るため、
 *  ここで exit 1 すると pnpm の ELIFECYCLE エラーがそのまま PR コメントになる
 *  （#366 で baseline.json が撤去されて以来、実際にそうなっていた）。 */
function renderMissingBaseline(detail: string): string {
  return [
    "# Bench delta",
    "",
    `比較できませんでした: ${detail}`,
    "",
    "delta 表を出すには、tracked の \`bench/baseline.json\` が必要です。",
    "\`pnpm bench:run\`（baseline プロファイル）が \`bench/baseline.json\` を書くので、",
    "内容を確認のうえコミットすると、以後の PR で main との差分が出ます。",
  ].join("\n");
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
  const leftMeta = `${left.profile} / ${left.mode} / n=${left.n ?? 1}${left.aggregate ? ` ${left.aggregate.statistic}` : ""} / ${left.startedAt}`;
  const rightMeta = `${right.profile} / ${right.mode} / n=${right.n ?? 1}${right.aggregate ? ` ${right.aggregate.statistic}` : ""} / ${right.startedAt}`;
  lines.push(`- left  (${leftMeta})`);
  lines.push(`- right (${rightMeta})`);
  lines.push("");
  lines.push("| metric | left | right | Δ | Δ% |");
  lines.push("|---|---|---|---|---|");
  for (const d of deltas) {
    const arrow = d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : "·";
    lines.push(`| ${d.metric} | ${d.left} | ${d.right} | ${arrow} ${d.delta} | ${d.pct ?? "-"} |`);
  }
  // n>=2 の片側があれば、range も併記（noise floor の可視化）
  if (left.aggregate || right.aggregate) {
    lines.push("");
    lines.push("### Per-sample range (left, right)");
    lines.push("");
    lines.push("| metric | left range | right range |");
    lines.push("|---|---|---|");
    for (const d of deltas) {
      const key = d.metric as keyof BenchRunOutput["metrics"];
      const lRange = left.aggregate?.distribution?.[key];
      const rRange = right.aggregate?.distribution?.[key];
      const lCell = lRange ? `${lRange.min}–${lRange.max}` : "—";
      const rCell = rRange ? `${rRange.min}–${rRange.max}` : "—";
      lines.push(`| ${d.metric} | ${lCell} | ${rCell} |`);
    }
  }
  return lines.join("\n");
}

function main(): void {
  const arg = process.argv[2];
  let left: BenchRunOutput | null;
  let right: BenchRunOutput | null;

  const leftEnv = process.env.BENCH_LEFT;
  const rightEnv = process.env.BENCH_RIGHT;
  if (leftEnv && rightEnv) {
    // 明示パス指定は従来どおり厳格（打ち間違いは早く気づきたい）
    left = loadJson(leftEnv);
    right = loadJson(rightEnv);
  } else if (arg) {
    // git ブランチ指定: 左 = <branch>:bench/baseline.json、右 = ローカル bench/baseline.json
    // （CI では直前の bench:run が bench/baseline.json を dry-run 結果で上書きして
    //   いるので、右 = この PR の実測、左 = 比較先ブランチの tracked baseline になる）
    let branchBaseline: BenchRunOutput | null = null;
    try {
      branchBaseline = fetchBaselineFromBranch(arg);
    } catch (err) {
      console.error(`[bench] ${arg} の baseline.json 取り出しに失敗: ${(err as Error).message}`);
    }
    const localBaseline = tryLoadJson(join(BENCH_DIR, "baseline.json"));
    if (!branchBaseline || !localBaseline) {
      const detail =
        !branchBaseline && !localBaseline
          ? `${arg} にも作業ツリーにも bench/baseline.json がありません`
          : !branchBaseline
            ? `${arg} に bench/baseline.json がありません（この PR がベースラインを初めて追加する場合、マージ後の PR から delta が出ます）`
            : `作業ツリーに bench/baseline.json がありません（${arg} 側には存在します）`;
      console.log(renderMissingBaseline(detail));
      return;
    }
    left = branchBaseline;
    right = localBaseline;
  } else {
    left = tryLoadJson(join(BENCH_DIR, "baseline.json"));
    if (!left) {
      console.log(renderMissingBaseline("bench/baseline.json がありません"));
      return;
    }
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
