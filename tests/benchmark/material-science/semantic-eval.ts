// 意味で照合する採点を、保存済みの抽出結果にかける（semantic-judge.ts）。
//
//   GRAPHIUM_USE_KEYCHAIN=1 DATA_DIR=<models.json のある DATA_DIR> \
//   pnpm exec tsx tests/benchmark/material-science/semantic-eval.ts \
//     --results <jsonl> --gold-map <json> --out <jsonl> [--judge claude-opus-5] [--field raw] [--concurrency 4]
//
// results の各行: { model, rep, id, <field>: ProvIngesterOutput }。gold-map: { id: "<MatPROV gold JSON のパス>" }。
// 判定役の答え（対応表）と数えた結果を out に 1 行ずつ追記する。同じ (model, rep, id, field) は飛ばす。

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { createModel } from "../../../src/server/services/llm.js";
import { runAgentLoop } from "../../../src/server/services/agent-loop.js";
import { listModels, setDataDir } from "../../../src/server/config/models.js";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  goldGraphFromMatProv,
  parseJudgeOutput,
  predGraphFromOutput,
  scoreWithMapping,
} from "./semantic-judge";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const RESULTS = opt("results")!;
const GOLD_MAP = JSON.parse(readFileSync(opt("gold-map")!, "utf8")) as Record<string, string>;
const OUT = opt("out")!;
const JUDGE = opt("judge", "claude-opus-5")!;
const FIELD = opt("field", "raw")!;
const CONC = Number(opt("concurrency", "4"));

const rows = readFileSync(RESULTS, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r[FIELD]?.blocks && GOLD_MAP[r.id]);
const done = new Set(
  existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.model}|${r.rep}|${r.id}|${r.field}`; }) : [],
);
if (process.env.DATA_DIR) setDataDir(process.env.DATA_DIR);
const config = listModels().find((m) => m.name === JUDGE);
if (!config) throw new Error(`judge model not registered: ${JUDGE}`);
const model = await createModel(config);

async function judgeOne(r: any) {
  const pred = predGraphFromOutput(r[FIELD]);
  const gold = goldGraphFromMatProv(JSON.parse(readFileSync(GOLD_MAP[r.id], "utf8")));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await runAgentLoop({
        model,
        modelId: config!.modelId,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildJudgeUserMessage(pred, gold) }],
        maxSteps: 1,
        feature: "bench.semantic-judge",
        modelConfig: config!,
      });
      const mapping = parseJudgeOutput(res.message, pred, gold);
      const score = scoreWithMapping(pred, gold, mapping);
      appendFileSync(OUT, JSON.stringify({ model: r.model, rep: r.rep, id: r.id, field: FIELD, judge: JUDGE, score, mapping, pred, at: new Date().toISOString() }) + "\n");
      console.log(`${r.model}#${r.rep} ${r.id} ${FIELD} acts ${score.activities.tp}/${score.activities.pred} edges ${score.edges.tp}/${score.edges.pred} (gold ${score.edges.gold})`);
      return;
    } catch (err) {
      console.log(`retry ${r.model}#${r.rep} ${r.id}: ${String(err).slice(0, 120)}`);
    }
  }
}

const queue = rows.filter((r) => !done.has(`${r.model}|${r.rep}|${r.id}|${FIELD}`));
console.log(`judging ${queue.length} (skip ${rows.length - queue.length})`);
let i = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (i < queue.length) await judgeOne(queue[i++]);
  }),
);
