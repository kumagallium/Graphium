// Material-science benchmark runner（v1.2 open-set 化以降）。
//
// 1. fixtures/ から (*.input.txt, *.gold.json) のペアを読む
// 2. open-set prompt（src/server/services/prov-ingester.ts）+ さくら AI engine で抽出
// 3. evaluator で 5 集合（Activities / Materials / Tools / Edges / Parameters）を比較
// 4. reports/ に CSV と JSON を出力、stdout にサマリ表示
//
// 使い方:
//   pnpm test:benchmark                       # 全 fixture を実行
//   pnpm test:benchmark -- --fixture seed-*  # 部分実行
//
// 必須 env:
//   SAKURA_AI_ENDPOINT, SAKURA_AI_API_KEY, SAKURA_AI_MODEL

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProvIngesterSystemPrompt,
  buildProvIngesterUserMessage,
  parseProvIngesterOutput,
  type ProvIngesterOutput,
} from "../../../src/server/services/prov-ingester.js";
import {
  evaluateSample,
  aggregate,
  extractSetsFromGold,
  extractSetsFromOutput,
  prf,
  type MatProvOutput,
  type SampleMetric,
  type SpanSets,
} from "./evaluator.js";
import { readSakuraOptionsFromEnv, runSakuraChat } from "./sakura-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const REPORTS_DIR = join(__dirname, "reports");

type FixturePair = {
  id: string;
  inputPath: string;
  goldPath: string;
};

type SampleResult = {
  id: string;
  predicted: ProvIngesterOutput[];
  gold: MatProvOutput;
  metric: SampleMetric;
  durationMs: number;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filterPattern = args.fixture ? new RegExp(args.fixture) : null;
  const dryRun = args.dryRun ?? false;
  const language = args.language ?? "en";

  const pairs = listFixtures(filterPattern);
  if (pairs.length === 0) {
    console.error(
      "No fixtures found. Run `tsx tests/benchmark/material-science/fetch-dataset.ts` first,",
    );
    console.error("then fill in *.input.txt for each fixture.");
    process.exit(1);
  }
  console.log(`Found ${pairs.length} fixture(s).`);

  const sakura = readSakuraOptionsFromEnv();
  if (!dryRun && !sakura) {
    console.error(
      "SAKURA_AI_ENDPOINT / SAKURA_AI_API_KEY / SAKURA_AI_MODEL が .env に設定されていません。",
    );
    console.error("Set them in provnote/.env (or worktree .env) and re-run.");
    process.exit(2);
  }

  const systemPrompt = buildProvIngesterSystemPrompt(language);

  const results: SampleResult[] = [];
  for (const pair of pairs) {
    const inputText = readFileSync(pair.inputPath, "utf-8").trim();
    if (!inputText || isPlaceholder(inputText)) {
      console.log(`[skip] ${pair.id} — input.txt is empty or placeholder`);
      continue;
    }
    const gold = JSON.parse(readFileSync(pair.goldPath, "utf-8")) as MatProvOutput;

    console.log(`\n[run] ${pair.id} (input ${inputText.length} chars, gold ${gold.length} procedure(s))`);

    if (dryRun) {
      results.push({
        id: pair.id,
        predicted: [],
        gold,
        metric: evaluateSample(pair.id, [], gold),
        durationMs: 0,
      });
      continue;
    }

    const userMessage = buildProvIngesterUserMessage({
      url: `bench://${pair.id}`,
      title: pair.id,
      text: inputText,
    });
    let predicted: ProvIngesterOutput[] = [];
    let durationMs = 0;
    let tokenUsage: SampleResult["tokenUsage"];
    try {
      const llm = await runSakuraChat(sakura!, systemPrompt, userMessage);
      durationMs = llm.durationMs;
      tokenUsage = llm.usage;
      const parsed = parseProvIngesterOutput(llm.message);
      if (parsed.blocks.length === 0) {
        const dumpPath = join(REPORTS_DIR, `raw-${pair.id}-${Date.now()}.txt`);
        mkdirSync(REPORTS_DIR, { recursive: true });
        writeFileSync(dumpPath, llm.message);
        console.log(`  ! parse returned 0 blocks (raw size ${llm.message.length} chars). Dumped to ${dumpPath}`);
      } else {
        predicted = [parsed];
      }
    } catch (err) {
      console.log(`  ! LLM call failed: ${err instanceof Error ? err.message : err}`);
    }

    const metric = evaluateSample(pair.id, predicted, gold);
    printSampleSummary(metric);
    results.push({ id: pair.id, predicted, gold, metric, durationMs, tokenUsage });
  }

  // 集計
  const totals = aggregate(results.map((r) => r.metric));
  console.log("\n=== Aggregate (all samples) ===");
  console.log(formatSummary(totals));

  // レポート出力
  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = join(REPORTS_DIR, `report-${stamp}.csv`);
  const jsonPath = join(REPORTS_DIR, `report-${stamp}.json`);
  writeFileSync(csvPath, buildCsv(results));
  writeFileSync(jsonPath, buildJson(results, totals));
  console.log(`\nReports:\n  ${csvPath}\n  ${jsonPath}`);
}

function parseArgs(argv: string[]): {
  fixture?: string;
  dryRun?: boolean;
  language?: string;
} {
  const out: { fixture?: string; dryRun?: boolean; language?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") out.fixture = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--language") out.language = argv[++i];
  }
  return out;
}

function listFixtures(pattern: RegExp | null): FixturePair[] {
  const files = readdirSync(FIXTURES_DIR);
  const inputs = files.filter((f) => f.endsWith(".input.txt"));
  const pairs: FixturePair[] = [];
  for (const inputFile of inputs) {
    const id = basename(inputFile, ".input.txt");
    if (pattern && !pattern.test(id)) continue;
    const goldFile = `${id}.gold.json`;
    if (!files.includes(goldFile)) continue;
    pairs.push({
      id,
      inputPath: join(FIXTURES_DIR, inputFile),
      goldPath: join(FIXTURES_DIR, goldFile),
    });
  }
  pairs.sort((a, b) => a.id.localeCompare(b.id));
  return pairs;
}

function isPlaceholder(text: string): boolean {
  // fetch-dataset.ts が書く placeholder ヘッダだけのファイルを skip 判定
  const trimmed = text.trim();
  if (trimmed.length < 50) return true;
  const nonComment = trimmed
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("")
    .trim();
  return nonComment.length < 50;
}

function printSampleSummary(metric: SampleMetric): void {
  const t = metric.total;
  const fmt = (c: { matched: number; predicted: number; gold: number }) => {
    const p = prf(c);
    return `P=${p.precision.toFixed(2)} R=${p.recall.toFixed(2)} F1=${p.f1.toFixed(2)} (m=${c.matched}/p=${c.predicted}/g=${c.gold})`;
  };
  console.log(`  Activities:  ${fmt(t.activities)}`);
  console.log(`  Materials:   ${fmt(t.materials)}`);
  console.log(`  Tools:       ${fmt(t.tools)}`);
  console.log(`  Edges:       ${fmt(t.edges)}`);
  console.log(`  Parameters:  ${fmt(t.parameters)}`);
}

function formatSummary(total: ReturnType<typeof aggregate>): string {
  const fmt = (c: { matched: number; predicted: number; gold: number }) => {
    const p = prf(c);
    return `P=${p.precision.toFixed(3)} R=${p.recall.toFixed(3)} F1=${p.f1.toFixed(3)}  (matched=${c.matched}, pred=${c.predicted}, gold=${c.gold})`;
  };
  return [
    `Activities:  ${fmt(total.activities)}`,
    `Materials:   ${fmt(total.materials)}`,
    `Tools:       ${fmt(total.tools)}`,
    `Edges:       ${fmt(total.edges)}`,
    `Parameters:  ${fmt(total.parameters)}`,
    "",
    "Token F1 (averaged across procedures):",
    `  Activities:  ${total.tokenF1.activities.f1.toFixed(3)}`,
    `  Materials:   ${total.tokenF1.materials.f1.toFixed(3)}`,
    `  Tools:       ${total.tokenF1.tools.f1.toFixed(3)}`,
    `  Parameters:  ${total.tokenF1.parameters.f1.toFixed(3)}`,
  ].join("\n");
}

function buildCsv(results: SampleResult[]): string {
  const headers = [
    "sample_id",
    "duration_ms",
    "gold_procedures",
    "pred_procedures",
    "activities_p",
    "activities_r",
    "activities_f1",
    "materials_p",
    "materials_r",
    "materials_f1",
    "tools_p",
    "tools_r",
    "tools_f1",
    "edges_p",
    "edges_r",
    "edges_f1",
    "parameters_p",
    "parameters_r",
    "parameters_f1",
    "activities_token_f1",
    "materials_token_f1",
    "tools_token_f1",
    "parameters_token_f1",
  ];
  const rows = [headers.join(",")];
  for (const r of results) {
    const t = r.metric.total;
    const a = prf(t.activities);
    const m = prf(t.materials);
    const tl = prf(t.tools);
    const e = prf(t.edges);
    const p = prf(t.parameters);
    rows.push(
      [
        r.id,
        String(r.durationMs),
        String(r.metric.goldProcedureCount),
        String(r.metric.predictedProcedureCount),
        a.precision.toFixed(3),
        a.recall.toFixed(3),
        a.f1.toFixed(3),
        m.precision.toFixed(3),
        m.recall.toFixed(3),
        m.f1.toFixed(3),
        tl.precision.toFixed(3),
        tl.recall.toFixed(3),
        tl.f1.toFixed(3),
        e.precision.toFixed(3),
        e.recall.toFixed(3),
        e.f1.toFixed(3),
        p.precision.toFixed(3),
        p.recall.toFixed(3),
        p.f1.toFixed(3),
        t.tokenF1.activities.f1.toFixed(3),
        t.tokenF1.materials.f1.toFixed(3),
        t.tokenF1.tools.f1.toFixed(3),
        t.tokenF1.parameters.f1.toFixed(3),
      ].join(","),
    );
  }
  return rows.join("\n");
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function buildJson(results: SampleResult[], totals: ReturnType<typeof aggregate>): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: process.env.SAKURA_AI_MODEL ?? null,
      sampleCount: results.length,
      totals: {
        activities: { ...totals.activities, ...prf(totals.activities) },
        materials: { ...totals.materials, ...prf(totals.materials) },
        tools: { ...totals.tools, ...prf(totals.tools) },
        edges: { ...totals.edges, ...prf(totals.edges) },
        parameters: { ...totals.parameters, ...prf(totals.parameters) },
        tokenF1: totals.tokenF1,
      },
      samples: results.map((r) => {
        // attribute spans の生テキストを抜き出してダンプ（parameter が空のとき診断に使う）
        const attributeSpans: string[] = [];
        for (const out of r.predicted) {
          const walk = (blocks: typeof out.blocks): void => {
            for (const b of blocks) {
              for (const s of b.content ?? []) {
                if (s.role === "attribute" && s.text) attributeSpans.push(s.text);
              }
              if (b.children) walk(b.children);
            }
          };
          walk(out.blocks);
        }
        const predSets: SpanSets = r.predicted
          .map((o) => extractSetsFromOutput(o))
          .reduce(
            (acc, cur) => ({
              activities: acc.activities.concat(cur.activities),
              materials: acc.materials.concat(cur.materials),
              tools: acc.tools.concat(cur.tools),
              edges: acc.edges.concat(cur.edges),
              parameters: acc.parameters.concat(cur.parameters),
            }),
            { activities: [], materials: [], tools: [], edges: [], parameters: [] } as SpanSets,
          );
        const goldSets = extractSetsFromGold(r.gold);
        return {
          id: r.id,
          durationMs: r.durationMs,
          tokenUsage: r.tokenUsage,
          goldProcedures: r.metric.goldProcedureCount,
          predProcedures: r.metric.predictedProcedureCount,
          metric: r.metric,
          attributeSpansRaw: dedupe(attributeSpans),
          sets: {
            predicted: {
              activities: dedupe(predSets.activities),
              materials: dedupe(predSets.materials),
              tools: dedupe(predSets.tools),
              parameters: dedupe(predSets.parameters),
            },
            gold: {
              activities: dedupe(goldSets.activities),
              materials: dedupe(goldSets.materials),
              tools: dedupe(goldSets.tools),
              parameters: dedupe(goldSets.parameters),
            },
          },
        };
      }),
    },
    null,
    2,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
