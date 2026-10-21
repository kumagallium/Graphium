// 会議の要約（サーバーの POST /meeting/summarize を呼ぶだけの薄い層）

import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { t } from "../../i18n";
import { getMeetingAiLLMModel, getMeetingAiModelName } from "../settings/store";

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
      h["X-LLM-API-Key"] = JSON.stringify({
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

export async function summarizeMeeting(params: {
  utterances: SummaryUtterance[];
  language: "ja" | "en";
  /** ノートに書かれたメモ（議題・会議中のメモ）。何が大事だったかの手がかり */
  notes?: string;
  /** 名前などを伏せる（ブロックのチェック）。terms は設定の「必ず伏せる語」 */
  mask?: { terms: string };
}): Promise<SummaryResult> {
  const res = await fetch(`${apiBase()}/meeting/summarize`, {
    method: "POST",
    headers: summaryHeaders(),
    body: JSON.stringify({
      language: params.language,
      utterances: params.utterances,
      ...(params.notes ? { notes: params.notes } : {}),
      ...(params.mask ? { mask: true, maskTerms: params.mask.terms } : {}),
      // 清書と要約は「音声ノート」の設定で選んだモデル（空ならチャット → デフォルト）
      ...(getMeetingAiModelName() ? { model: getMeetingAiModelName() } : {}),
    }),
  });
  // 入力が大きすぎる（INPUT_TOO_LARGE）/ AI の出力が JSON として読めない は、固定の文言で返す
  if (res.status === 413) throw new SummaryMessageError(t("meetingBlock.summaryTooLarge"));
  if (res.status === 502) throw new SummaryMessageError(t("meetingBlock.summaryBadOutput"));
  if (!res.ok) throw await aiErrorFromResponse(res, `Summarize failed (${res.status})`);
  const json = (await res.json()) as Partial<SummaryResult>;
  return {
    decisions: Array.isArray(json.decisions) ? json.decisions : [],
    todos: Array.isArray(json.todos) ? json.todos : [],
    issues: Array.isArray(json.issues) ? json.issues : [],
    model: typeof json.model === "string" ? json.model : "",
    masked: !!params.mask && json.masked === true,
  };
}
