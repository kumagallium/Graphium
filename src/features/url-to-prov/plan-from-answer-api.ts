// チャットの回答から計画（振る条件・行・共通手順のラベル付きブロック）をもらう。
// 組み立てと保存は plan-note-builder.ts と呼び出し側（note-app）。

import { apiBase } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getSelectedModel } from "../settings/store";
import { provHeaders } from "./prov-ingester-api";
import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary } from "./label-vocabulary";
import type { ExperimentPlanDraft } from "./plan-note-builder";

export type PlanFromAnswerResult = {
  plan: ExperimentPlanDraft;
  blocks: ProvIngesterBlock[];
  model: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
};

export async function planFromAnswer(
  question: string,
  answer: string,
  language: string,
  vocabulary?: ProvVocabulary,
): Promise<PlanFromAnswerResult> {
  const res = await fetch(`${apiBase()}/prov/plan-from-answer`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({
      question,
      answer,
      language,
      ...(vocabulary ? { vocabulary } : {}),
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });
  if (!res.ok) throw await aiErrorFromResponse(res, `Plan failed (${res.status})`);
  return res.json();
}
