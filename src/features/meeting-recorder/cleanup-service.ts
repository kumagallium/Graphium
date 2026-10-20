// 会議の清書（サーバーの POST /meeting/cleanup を呼ぶだけの薄い層）
// 長い会議は分割して順に送り、結果を連結する。1 回でも失敗したら全体を失敗にする。

import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { t } from "../../i18n";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import type { SummaryUtterance } from "./summary-service";

/** そのまま 1 行で見せる文言のエラー（「清書できませんでした」で包まない） */
export class CleanupMessageError extends Error {}

export type CleanupParagraphResult = { text: string; sources: string[] };

/** 1 回に送る発言数と、整形後のおおよその字数の上限（サーバー上限 300 発言 / 12,000 字より小さく） */
export const CLEANUP_CHUNK_MAX_UTTERANCES = 120;
export const CLEANUP_CHUNK_MAX_CHARS = 5_000;
/** `[u123] [mm:ss] 相手: ` と改行の見積もり字数 */
const LINE_OVERHEAD = 24;

/**
 * 発言を順序を保ったまま分割する。
 * 1 件で字数上限を超える発言も、単独の塊として必ず 1 回で送る（落とさない）。
 */
export function chunkUtterances(utterances: SummaryUtterance[]): SummaryUtterance[][] {
  const chunks: SummaryUtterance[][] = [];
  let cur: SummaryUtterance[] = [];
  let chars = 0;
  for (const u of utterances) {
    const len = u.text.length + LINE_OVERHEAD;
    if (cur.length > 0 && (cur.length >= CLEANUP_CHUNK_MAX_UTTERANCES || chars + len > CLEANUP_CHUNK_MAX_CHARS)) {
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

// 要約と同じ流儀: デスクトップ以外ではブラウザ側のモデル設定をヘッダーで渡す
function cleanupHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getDefaultLLMModel();
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

async function cleanupOnce(
  utterances: SummaryUtterance[],
  language: "ja" | "en",
  vocabulary: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ paragraphs: CleanupParagraphResult[]; model: string }> {
  const res = await fetch(`${apiBase()}/meeting/cleanup`, {
    method: "POST",
    headers: cleanupHeaders(),
    signal,
    body: JSON.stringify({
      language,
      utterances,
      ...(vocabulary ? { vocabulary } : {}),
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });
  if (res.status === 413) throw new CleanupMessageError(t("meetingBlock.cleanupTooLarge"));
  if (res.status === 502) throw new CleanupMessageError(t("meetingBlock.cleanupBadOutput"));
  if (!res.ok) throw await aiErrorFromResponse(res, `Cleanup failed (${res.status})`);
  const json = (await res.json()) as { paragraphs?: unknown; model?: unknown };
  return {
    paragraphs: Array.isArray(json.paragraphs) ? (json.paragraphs as CleanupParagraphResult[]) : [],
    model: typeof json.model === "string" ? json.model : "",
  };
}

export async function cleanupMeeting(params: {
  utterances: SummaryUtterance[];
  language: "ja" | "en";
  vocabulary?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ paragraphs: CleanupParagraphResult[]; model: string }> {
  const chunks = chunkUtterances(params.utterances.filter((u) => u.text.trim().length > 0));
  const paragraphs: CleanupParagraphResult[] = [];
  let model = "";
  params.onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    // 途中の失敗は握りつぶさず投げる（部分的な結果は返さない）
    const r = await cleanupOnce(chunks[i], params.language, params.vocabulary, params.signal);
    paragraphs.push(...r.paragraphs);
    if (r.model) model = r.model;
    params.onProgress?.(i + 1, chunks.length);
  }
  return { paragraphs, model };
}
