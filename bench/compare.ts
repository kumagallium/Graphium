// Phase μ-1: ブランチ間 delta 計算
//
// 使い方:
//   pnpm bench:compare main           # 作業ツリーの bench/baseline.json（bench:run の実測）を main の baseline と比較
//   BENCH_RIGHT=bench/latest-baseline.json pnpm bench:compare origin/main   # CI: 右に実測のファイルを渡す
//   BENCH_LEFT=path/to/old.json BENCH_RIGHT=path/to/new.json pnpm bench:compare
//
// 引数は git の ref（ブランチ名・origin/main・SHA）で、<ref>:bench/baseline.json を左にする。
// 引数なしなら、左 = bench/baseline.json、右 = bench/latest-baseline.json を比較する。

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
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

type RefBaseline = { baseline: BenchRunOutput } | { missing: string; advice?: string };

/**
 * <ref>:bench/baseline.json を取り出す。「ref が無い」と「ref にファイルが無い」を分けて返す。
 * 以前は区別せず「main に bench/baseline.json がありません」と出していたため、CI の
 * チェックアウトにローカルの main ブランチが無いだけ（origin/main はある）なのを見誤った。
 */
function fetchBaselineFromRef(ref: string): RefBaseline {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { stdio: "ignore" });
  } catch {
    return {
      missing: `\`${ref}\` という ref が見つかりません`,
      advice: ref.startsWith("origin/")
        ? "比較先のブランチを fetch してください。"
        : `リモート追跡ブランチしか無い環境（CI の actions/checkout など）では \`origin/${ref}\` を渡してください。`,
    };
  }
  let raw: string;
  try {
    raw = execFileSync("git", ["show", `${ref}:bench/baseline.json`], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return {
      missing: `${ref} に bench/baseline.json がありません（この PR がベースラインを初めて追加する場合、マージ後の PR から delta が出ます）`,
    };
  }
  try {
    return { baseline: JSON.parse(raw) as BenchRunOutput };
  } catch (err) {
    return { missing: `${ref} の bench/baseline.json を JSON として読めません（${(err as Error).message}）` };
  }
}

/** baseline が見つからないときに CI コメントへ出す説明（throw で落とさない）。
 *  bench.yml は stdout を delta.md にリダイレクトして sticky comment に貼るため、
 *  ここで exit 1 すると pnpm の ELIFECYCLE エラーがそのまま PR コメントになる
 *  （#366 で baseline.json が撤去されて以来、実際にそうなっていた）。 */
function renderMissingBaseline(detail: string, advice?: string): string {
  return [
    "# Bench delta",
    "",
    `比較できませんでした: ${detail}`,
    "",
    ...(advice
      ? [advice]
      : [
          "delta 表を出すには、tracked の \`bench/baseline.json\` が必要です。",
          "\`BENCH_MODE=dry-run pnpm bench:run\`（baseline プロファイル）が \`bench/baseline.json\` を書くので、",
          "内容を確認のうえコミットすると、以後の PR で main との差分が出ます。",
        ]),
  ].join("\n");
}

/**
 * 差分が出たときの案内。差分がこの PR の意図した変化なのに bench/baseline.json を
 * 更新しないままマージすると、以後のすべての PR に同じ差分が出続ける。
 * tracked の baseline がすでに実測と一致していれば、そう伝える。
 */
function renderBaselineHint(
  left: BenchRunOutput,
  right: BenchRunOutput,
  tracked: BenchRunOutput | null,
): string | null {
  if (computeDelta(left, right).every((d) => d.delta === 0)) return null;
  if (tracked && computeDelta(tracked, right).every((d) => d.delta === 0)) {
    return "作業ツリーの \`bench/baseline.json\` はこの実測と一致しています（コミット済みなら、マージ後の PR の差分は 0 に戻ります）。";
  }
  return [
    "差分がこの PR の意図した変化なら、\`BENCH_MODE=dry-run pnpm bench:run\` で \`bench/baseline.json\` を更新し、",
    "この PR に含めてください。含めないと、マージ後のすべての PR に同じ差分が出続けます。",
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
  let hint: string | null = null;

  const leftEnv = process.env.BENCH_LEFT;
  const rightEnv = process.env.BENCH_RIGHT;
  if (leftEnv && rightEnv) {
    // 明示パス指定は従来どおり厳格（打ち間違いは早く気づきたい）
    left = loadJson(leftEnv);
    right = loadJson(rightEnv);
  } else if (arg) {
    // git の ref 指定: 左 = <ref>:bench/baseline.json、右 = この作業ツリーの実測。
    // 右は BENCH_RIGHT があればそれ、無ければ bench/baseline.json（ローカルでは bench:run が
    // baseline プロファイルの結果をここに上書きする）。CI（bench.yml）の bench:run は
    // BENCH_OUTPUT=bench/latest-baseline.json に書くので、BENCH_RIGHT でそのファイルを渡す。
    // 渡さないと右が tracked の baseline のままになり、差分が常に 0 に見える。
    const trackedPath = join(BENCH_DIR, "baseline.json");
    const rightPath = rightEnv ?? trackedPath;
    const fetched = fetchBaselineFromRef(arg);
    if ("missing" in fetched) {
      console.log(renderMissingBaseline(fetched.missing, fetched.advice));
      return;
    }
    const measured = tryLoadJson(rightPath);
    if (!measured) {
      console.log(
        renderMissingBaseline(
          `比較する実測（${rightPath}）がありません`,
          "先に \`BENCH_MODE=dry-run pnpm bench:run\` を実行してください。",
        ),
      );
      return;
    }
    left = fetched.baseline;
    right = measured;
    const tracked = resolve(rightPath) === resolve(trackedPath) ? measured : tryLoadJson(trackedPath);
    hint = renderBaselineHint(left, right, tracked);
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
  if (hint) console.log(`\n${hint}`);
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
