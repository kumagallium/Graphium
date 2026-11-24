// 会議の要約（サーバーの POST /meeting/summarize を呼ぶ薄い層）
// 長い会議は分けて順に送り、最後に POST /meeting/summarize-merge で重なりをまとめる。

import { apiBase, isTauri } from "../../lib/platform";
import { toAsciiJson } from "../../lib/ascii-json";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { t } from "../../i18n";
import { getMeetingAiLLMModel, getMeetingAiModelName } from "../settings/store";
import { badOutputMessage } from "./bad-output";
import type { GenerationLanguage } from "../../lib/language";

/** そのまま 1 行で見せる文言のエラー（「要約できませんでした」で包まない） */
export class SummaryMessageError extends Error {}

export type SummaryUtterance = {
  id: string;
  track: "system" | "mic" | null;
  startMs: number;
  text: string;
};

export type SummaryResult = {
  decisions: Array<{ text: string; sources: string[] }>;
  todos: Array<{ text: string; owner?: string; due?: string; sources: string[] }>;
  issues: Array<{ text: string; sources: string[] }>;
  model: string;
  /** 名前などを伏せたか（サーバーが伏せたと返したときだけ true） */
  masked?: boolean;
};

// 翻訳と同じ流儀: デスクトップ以外ではブラウザ側のモデル設定をヘッダーで渡す
function summaryHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getMeetingAiLLMModel();
    if (model) {
      h["X-LLM-API-Key"] = toAsciiJson({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
        rate: model.rate,
      });
    }
  }
  return h;
}

/**
 * 1 回に送る発言数と、整形後のおおよその字数の上限（サーバー上限 1,500 発言 / 60,000 字より小さく）。
 * これに収まる会議は今までどおり 1 回で要約する。超える会議は分けて要約し、最後に重なりをまとめる
 */
export const SUMMARY_CHUNK_MAX_UTTERANCES = 1_200;
export const SUMMARY_CHUNK_MAX_CHARS = 50_000;
/** `[u1234] [123:45] 相手: ` と改行の見積もり字数 */
const SUMMARY_LINE_OVERHEAD = 28;

/**
 * 発言を順序を保ったまま分割する。
 * 1 件で字数上限を超える発言も、単独の塊として必ず 1 回で送る（落とさない）。
 */
export function chunkSummaryUtterances(utterances: SummaryUtterance[]): SummaryUtterance[][] {
  const chunks: SummaryUtterance[][] = [];
  let cur: SummaryUtterance[] = [];
  let chars = 0;
  for (const u of utterances) {
    const len = u.text.length + SUMMARY_LINE_OVERHEAD;
    if (cur.length > 0 && (cur.length >= SUMMARY_CHUNK_MAX_UTTERANCES || chars + len > SUMMARY_CHUNK_MAX_CHARS)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(u);
    chars += len;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

type SummaryParams = {
  utterances: SummaryUtterance[];
  language: GenerationLanguage;
  /** ノートに書かれたメモ（議題・会議中のメモ）。何が大事だったかの手がかり */
  notes?: string;
  /** 名前などを伏せる（ブロックのチェック）。terms は設定の「必ず伏せる語」 */
  mask?: { terms: string };
};

function readSummary(json: Partial<SummaryResult>, mask: boolean): SummaryResult {
  return {
    decisions: Array.isArray(json.decisions) ? json.decisions : [],
    todos: Array.isArray(json.todos) ? json.todos : [],
    issues: Array.isArray(json.issues) ? json.issues : [],
    model: typeof json.model === "string" ? json.model : "",
    masked: mask && json.masked === true,
  };
}

// 清書と要約は「音声ノート」の設定で選んだモデル（空ならチャット → デフォルト）
function modelField(): { model?: string } {
  const name = getMeetingAiModelName();
  return name ? { model: name } : {};
}

async function summarizeOnce(params: SummaryParams, utterances: SummaryUtterance[]): Promise<SummaryResult> {
  const res = await fetch(`${apiBase()}/meeting/summarize`, {
    method: "POST",
    headers: summaryHeaders(),
    body: JSON.stringify({
      language: params.language,
      utterances,
      ...(params.notes ? { notes: params.notes } : {}),
      ...(params.mask ? { mask: true, maskTerms: params.mask.terms } : {}),
      ...modelField(),
    }),
  });
  // 入力が大きすぎる（INPUT_TOO_LARGE）/ AI の出力が JSON として読めない は、固定の文言で返す
  if (res.status === 413) throw new SummaryMessageError(t("meetingBlock.summaryTooLarge"));
  if (res.status === 502) throw new SummaryMessageError(await badOutputMessage(res, t("meetingBlock.summaryBadOutput")));
  if (!res.ok) throw await aiErrorFromResponse(res, `Summarize failed (${res.status})`);
  return readSummary((await res.json()) as Partial<SummaryResult>, !!params.mask);
}

/** 分けて要約した結果を、時間の順にそのままつなげる（まとめられなかったときの結果） */
export function concatSummaries(parts: SummaryResult[], mask: boolean): SummaryResult {
  return {
    decisions: parts.flatMap((p) => p.decisions),
    todos: parts.flatMap((p) => p.todos),
    issues: parts.flatMap((p) => p.issues),
    model: parts.map((p) => p.model).filter(Boolean).pop() ?? "",
    // 分けて送ったうち 1 回でも伏せていなければ、全体を伏せたとは扱わない
    masked: mask && parts.every((p) => p.masked === true),
  };
}

/** つなげた結果の重なりを AI にまとめてもらう。うまくいかなければ null（つなげた結果を使う） */
async function mergeOnce(params: SummaryParams, joined: SummaryResult): Promise<SummaryResult | null> {
  try {
    const res = await fetch(`${apiBase()}/meeting/summarize-merge`, {
      method: "POST",
      headers: summaryHeaders(),
      body: JSON.stringify({
        language: params.language,
        summary: { decisions: joined.decisions, todos: joined.todos, issues: joined.issues },
        ...(params.mask ? { mask: true, maskTerms: params.mask.terms } : {}),
        ...modelField(),
      }),
    });
    if (!res.ok) {
      console.warn(`要約のまとめに失敗（${res.status}）。つなげた結果を使う`);
      return null;
    }
    const merged = readSummary((await res.json()) as Partial<SummaryResult>, !!params.mask);
    // 伏せるときは、分けた回とまとめの両方で伏せられたときだけ伏せた扱いを保つ
    return { ...merged, model: merged.model || joined.model, masked: joined.masked === true && merged.masked === true };
  } catch (e) {
    console.warn("要約のまとめに失敗（つなげた結果を使う）:", e);
    return null;
  }
}

/**
 * 会議を要約する。収まる長さなら 1 回で、長い会議は分けて要約してから重なりをまとめる。
 * 分けた回のどれかが失敗したら全体を失敗にする（部分的な要約は返さない）。
 * まとめる回だけは失敗しても止めず、つなげた結果を返す（どの項目も根拠付きで揃っているため）
 */
export async function summarizeMeeting(
  params: SummaryParams & { onProgress?: (done: number, total: number) => void },
): Promise<SummaryResult> {
  const chunks = chunkSummaryUtterances(params.utterances.filter((u) => u.text.trim().length > 0));
  if (chunks.length <= 1) {
    // 空の発言だけのときも、今までどおりサーバーに判断させる
    params.onProgress?.(0, 1);
    const r = await summarizeOnce(params, chunks[0] ?? params.utterances);
    params.onProgress?.(1, 1);
    return r;
  }
  // 分けた回の数 + まとめる 1 回
  const total = chunks.length + 1;
  params.onProgress?.(0, total);
  const parts: SummaryResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    parts.push(await summarizeOnce(params, chunks[i]));
    params.onProgress?.(i + 1, total);
  }
  const joined = concatSummaries(parts, !!params.mask);
  const count = joined.decisions.length + joined.todos.length + joined.issues.length;
  const merged = count > 1 ? await mergeOnce(params, joined) : null;
  params.onProgress?.(total, total);
  return merged ?? joined;
}
