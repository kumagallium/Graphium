// チャットの回答（次の実験の提案）を、計画ノート＋工程ノートの材料に組み直す。
//
// 2 段で作る:
//   1. この prompt で「振る条件・行（試料）・共通の手順の文章」を JSON にさせる
//   2. 共通の手順の文章を、論文と同じ手順抽出（prov-ingester）に通してラベル付きのブロックにする
// 2 を論文と同じ経路にするのは、手順・材料・道具の名前の付け方を論文のノートと揃えるため
// （さらにクライアントで論文と同じ名寄せを通す）。手順の書式の規則を二重に持たずに済む。

import { jsonrepair } from "jsonrepair";

export type PlanVariable = {
  /** 手順の中で使うパラメータのキー（例: x / temperature）。行ごとの値の差し替えに使う */
  key: string;
  /** 表の見出し（例: Co-Ni 置換量 x / 焼成温度） */
  label: string;
  unit?: string;
};

export type PlanRun = {
  /** 行の名前＝工程ノートの題（書庫の中で他と区別できる名前） */
  name: string;
  /** キー → 値（単位込み） */
  values: Record<string, string>;
};

export type ExperimentPlanDraft = {
  title: string;
  background: string;
  expectedOutcome: string;
  variables: PlanVariable[];
  runs: PlanRun[];
  /** 1 行分の共通手順を、論文の Experimental 節のように書いた文章 */
  procedure: string;
};

const MAX_RUNS = 12;
const MAX_VARIABLES = 4;

function languageName(language: string): string {
  if (language === "ja") return "Japanese";
  if (language === "ko") return "Korean";
  return "English";
}

export function buildExperimentPlannerSystemPrompt(language: string): string {
  const lang = languageName(language);
  return `You turn a proposal for the next experiment into a structured experiment plan for a lab notebook.

You receive the user's question and the assistant's answer. The answer was written after reading the user's notes (often procedures extracted from papers). Build the plan ONLY from what the answer proposes. Do not add new chemistry, instruments or conditions the answer does not mention.

The plan is a comparison: one or more parameters are varied, and every run (sample) follows the same procedure with different values.

Output ONLY a JSON object (no prose, no code fence):
{
  "title": "<short plan title, ${lang}>",
  "background": "<1-3 sentences: purpose and what it builds on, ${lang}>",
  "expectedOutcome": "<1-3 sentences: what result would confirm or refute the idea, ${lang}>",
  "variables": [{"key": "<parameter key used in the procedure, e.g. x, temperature, time>", "label": "<table column header, ${lang}>", "unit": "<unit or empty string>"}],
  "runs": [{"name": "<run name>", "values": {"<key>": "<value with unit>"}}],
  "procedure": "<the common procedure for ONE run, written like the Experimental section of a paper, ${lang}>"
}

Rules:
- variables: 1 to ${MAX_VARIABLES} parameters that change between runs. Fixed conditions belong in the procedure, not here.
- runs: 2 to ${MAX_RUNS} runs. If the answer gives explicit values, use them. If it gives only a range, pick evenly spaced values inside the range and include both ends. If it proposes no variation at all, make a single variable from the most important condition and 2-3 runs around the proposed value. Every run has a value for every variable key.
- run names: short and unique in a whole notebook, so they can be note titles — include the material and the varied value (e.g. "BaFe11.6Co0.2Ni0.2O19 (x = 0.2)", "Cu2S film 450 °C"). Not "S-01".
- procedure: write it for the FIRST run, but it must stay true for EVERY run once the varied values are swapped in. List every material any run needs (a reagent that is zero in the first run is still listed), and never write a sentence that only holds for the first run's values (not "since x = 0, no Co is added"). State materials (with purity/form if the answer gives them), instruments, every step in order, and every condition as "<key>: <value>". For each varied parameter, write the FIRST run's value exactly as it appears in runs[0].values (same number, same unit spelling) — the other runs are made by replacing that exact value, so do not round it, convert units, or write it as a range. Do not describe characterization the answer does not propose.
- Write all text in ${lang}. Chemical formulas and units stay as they are.`;
}

export function buildExperimentPlannerUserMessage(input: { question: string; answer: string }): string {
  return `## Question\n${input.question.trim()}\n\n## Answer\n${input.answer.trim()}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** 計画の JSON を検証して整える。使えないときは null */
export function parseExperimentPlanDraft(raw: string): ExperimentPlanDraft | null {
  const text = raw.trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  const end = text.lastIndexOf("}");
  let obj: any;
  try {
    obj = JSON.parse(jsonrepair(end > start ? text.slice(start, end + 1) : text.slice(start)));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const variables: PlanVariable[] = [];
  const seenKeys = new Set<string>();
  for (const v of Array.isArray(obj.variables) ? obj.variables : []) {
    const key = str(v?.key);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    variables.push({ key, label: str(v?.label) || key, ...(str(v?.unit) ? { unit: str(v.unit) } : {}) });
    if (variables.length >= MAX_VARIABLES) break;
  }

  const runs: PlanRun[] = [];
  const seenNames = new Set<string>();
  for (const r of Array.isArray(obj.runs) ? obj.runs : []) {
    let name = str(r?.name).replace(/\s+/g, " ");
    if (!name) continue;
    // 題に使うので同名は番号で分ける
    if (seenNames.has(name)) name = `${name} (${runs.length + 1})`;
    seenNames.add(name);
    const values: Record<string, string> = {};
    const raw = r?.values && typeof r.values === "object" ? r.values : {};
    for (const v of variables) {
      const val = str(raw[v.key]);
      if (val) values[v.key] = val;
    }
    runs.push({ name, values });
    if (runs.length >= MAX_RUNS) break;
  }

  const procedure = str(obj.procedure);
  const title = str(obj.title);
  if (!title || !procedure || runs.length === 0) return null;
  return {
    title,
    background: str(obj.background),
    expectedOutcome: str(obj.expectedOutcome),
    variables,
    runs,
    procedure,
  };
}
