// semantic-eval.ts の出力をモデルごとに集計する。判定役の対応表（mapping）と予測（pred）を保存してあるので、
// 採点の式を変えても判定をやり直さずに数え直せる（scoreWithMapping をここで呼び直す）。
// 論文をまたいで tp / pred / gold を足してから割る。
//   pnpm exec tsx tests/benchmark/material-science/semantic-summary.ts <out.jsonl> <gold-map.json> [idPrefix,!excludePrefix] [--json]
import { readFileSync } from "node:fs";
import { addScores, emptyScore, goldGraphFromMatProv, scoreWithMapping, summarize, type SemanticScore } from "./semantic-judge";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const [file, goldMapFile, prefix] = args.filter((a) => a !== "--json");
const goldMap = JSON.parse(readFileSync(goldMapFile, "utf8")) as Record<string, string>;
const match = (id: string) =>
  !prefix ||
  prefix.split(",").every((p) => (p.startsWith("!") ? !id.startsWith(p.slice(1)) : true)) &&
    (prefix.split(",").filter((p) => !p.startsWith("!")).length === 0 || prefix.split(",").some((p) => !p.startsWith("!") && id.startsWith(p)));
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => match(r.id));
const by = new Map<string, { s: SemanticScore; n: number }>();
for (const r of rows) {
  const gold = goldGraphFromMatProv(JSON.parse(readFileSync(goldMap[r.id], "utf8")));
  const score = scoreWithMapping(r.pred, gold, r.mapping);
  const b = by.get(r.model) ?? { s: emptyScore(), n: 0 };
  b.s = addScores(b.s, score);
  b.n++;
  by.set(r.model, b);
}
const KINDS = ["activities", "materials", "tools", "edges", "parameters"] as const;
if (asJson) {
  const out: Record<string, unknown> = {};
  for (const [model, { s, n }] of by) out[model] = { n, ...Object.fromEntries(KINDS.map((k) => [k, summarize(s[k])])) };
  console.log(JSON.stringify(out, null, 1));
} else {
  const f = (x: number) => x.toFixed(2);
  for (const [model, { s, n }] of by) {
    const parts = KINDS.map((k) => {
      const v = summarize(s[k]);
      return `${k.slice(0, 5)} P${f(v.p)}/Pin${f(v.pIn)} R${f(v.r)} F1in${f(v.f1In)}`;
    });
    console.log(`${model} (n=${n})\n  ${parts.join("\n  ")}`);
  }
}
