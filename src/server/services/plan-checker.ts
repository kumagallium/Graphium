// 実験計画の「根拠の照合」。
//
// チャットの回答から作った計画ノート（plan-note-builder.ts）について、計画の具体的な要素
// （振る条件と値、材料とその純度・形状、装置、固定の条件、手順）を 1 つずつ取り出し、
// 何を根拠にしているかを分ける:
//   - source      … 参考にしたノート（論文から抽出した手順ノートなど）に書かれている
//   - answer      … 参考ノートには無いが、チャットの回答が提案している（新しい案。悪くはない）
//   - unsupported … どちらにも無い（計画を組む段で AI が足した）
//   - conflict    … 参考ノートか回答と食い違う（同じ工程で温度が違う、など）
// 「良い計画か」は判定しない。でっち上げと食い違いを人が見落とさないための照合。

import { jsonrepair } from "jsonrepair";

export type PlanCheckStatus = "source" | "answer" | "unsupported" | "conflict";
export type PlanCheckKind = "variable" | "material" | "tool" | "condition" | "step";

export type PlanCheckItem = {
  kind: PlanCheckKind;
  /** 計画の中の書き方（例: "焼成温度 800–1100 °C"、"Ba(NO3)2 (purity: 99%)"） */
  text: string;
  status: PlanCheckStatus;
  /** status が source / conflict のとき、根拠または食い違いのあるノートの題 */
  source?: string;
  /** conflict のとき参考ノート側の内容、unsupported のとき補足（1 文） */
  detail?: string;
};

export type PlanCheckInput = {
  /** 参考にしたノート（題と本文の Markdown） */
  sources: { title: string; text: string }[];
  /** チャットの回答 */
  answer: string;
  /** 計画ノートと工程ノート 1 本の Markdown（条件の表と共通の手順） */
  plan: string;
};

/** 参考ノート 1 本あたり・合計の文字数の上限（prompt を大きくしすぎない） */
const PER_SOURCE_CHARS = 14000;
const TOTAL_SOURCE_CHARS = 60000;
const ANSWER_CHARS = 12000;
const PLAN_CHARS = 16000;

const KINDS: PlanCheckKind[] = ["variable", "material", "tool", "condition", "step"];
const STATUSES: PlanCheckStatus[] = ["source", "answer", "unsupported", "conflict"];

export function buildPlanCheckerSystemPrompt(language: string): string {
  const lang = language === "ja" ? "Japanese" : language === "ko" ? "Korean" : "English";
  return `You audit an experiment plan against the material it was built from. You do NOT judge whether the plan is a good idea; you only report where each concrete element of the plan comes from.

You receive:
- SOURCES: notes the user already has (usually procedures extracted from papers), each with a title.
- ANSWER: the chat answer that proposed the plan.
- PLAN: the plan note (purpose, table of varied conditions) and one run note with the common procedure.

List every concrete element of the PLAN, one item each:
- "variable": each varied parameter with its values or range (e.g. "calcination temperature 800–1100 °C")
- "material": each material, with purity / form / amount if the plan gives them
- "tool": each instrument or vessel
- "condition": each fixed condition of a step (temperature, time, atmosphere, rate, pH, pressure …)
- "step": each operation of the common procedure
Skip characterization the plan only mentions in passing, and skip generic words ("sample", "powder") that are not a specific material.

For each item give "status":
- "source": the same thing (same value, allowing unit conversion and rounding) appears in a SOURCE. Give "source": the exact title of that note.
- "answer": not in the SOURCES, but the ANSWER proposes it. New ideas are expected here; this is not an error.
- "unsupported": neither the SOURCES nor the ANSWER contains it. The plan added it.
- "conflict": a SOURCE or the ANSWER states a different value or choice for the same thing in the same role (e.g. the same calcination step at 950 °C in the source but 1500 °C in the plan, or air in the source but argon in the plan, without the answer proposing the change). Give "source" (the note title, or "ANSWER") and "detail": what that source says.
A value inside a range the answer proposes is "answer". A value the answer proposes that differs from a source is "answer", not "conflict" — the answer chose to change it.

Output ONLY a JSON object:
{"items": [{"kind": "condition", "text": "<as written in the plan>", "status": "source", "source": "<note title>"}, {"kind": "material", "text": "…", "status": "unsupported", "detail": "<one short sentence>"}]}
Write "text" and "detail" in ${lang}.`;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s;
}

export function buildPlanCheckerUserMessage(input: PlanCheckInput): string {
  let budget = TOTAL_SOURCE_CHARS;
  const sources: string[] = [];
  for (const s of input.sources) {
    if (budget <= 0) break;
    const text = clip(s.text, Math.min(PER_SOURCE_CHARS, budget));
    budget -= text.length;
    sources.push(`### SOURCE: ${s.title}\n${text}`);
  }
  return `## SOURCES\n${sources.join("\n\n") || "(none)"}\n\n## ANSWER\n${clip(input.answer, ANSWER_CHARS)}\n\n## PLAN\n${clip(input.plan, PLAN_CHARS)}`;
}

/** 照合の答えを検証して整える。source は渡した題（または ANSWER）に実在するものだけ残す */
export function parsePlanCheckOutput(raw: string, input: PlanCheckInput): PlanCheckItem[] {
  const t = raw.trim();
  const s = t.indexOf("{");
  if (s < 0) return [];
  const e = t.lastIndexOf("}");
  let obj: any;
  try {
    obj = JSON.parse(jsonrepair(e > s ? t.slice(s, e + 1) : t.slice(s)));
  } catch {
    return [];
  }
  const titles = new Set(input.sources.map((x) => x.title));
  const out: PlanCheckItem[] = [];
  for (const it of Array.isArray(obj?.items) ? obj.items : []) {
    const kind = KINDS.includes(it?.kind) ? (it.kind as PlanCheckKind) : null;
    const status = STATUSES.includes(it?.status) ? (it.status as PlanCheckStatus) : null;
    const text = typeof it?.text === "string" ? it.text.trim() : "";
    if (!kind || !status || !text) continue;
    const source = typeof it?.source === "string" && (titles.has(it.source) || it.source === "ANSWER") ? it.source : undefined;
    const detail = typeof it?.detail === "string" && it.detail.trim() ? it.detail.trim() : undefined;
    // 根拠のノートが特定できない「source」は、回答にあるかどうか分からないので answer 扱いにはせず残す
    out.push({ kind, text, status, ...(source ? { source } : {}), ...(detail ? { detail } : {}) });
  }
  return out;
}
