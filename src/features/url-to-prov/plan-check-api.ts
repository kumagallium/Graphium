// 計画の根拠の照合をサーバーに頼む（/api/prov/plan-check）。
import { apiBase } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getSelectedModel } from "../settings/store";
import { provHeaders } from "./prov-ingester-api";
import type { PlanCheckItem } from "./plan-note-builder";

export async function checkPlan(input: {
  sources: { title: string; text: string }[];
  answer: string;
  plan: string;
  language: string;
}): Promise<PlanCheckItem[]> {
  const res = await fetch(`${apiBase()}/prov/plan-check`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({ ...input, ...(getSelectedModel() ? { model: getSelectedModel() } : {}) }),
  });
  if (!res.ok) throw await aiErrorFromResponse(res, `Plan check failed (${res.status})`);
  const json = (await res.json()) as { items?: PlanCheckItem[] };
  return json.items ?? [];
}
