// PROV Ingester API クライアント (Word .docx 経路)
// mammoth で .docx から raw text を抽出し、サーバー /api/prov/ingest-pdf に投げて
// 構造化済みブロック列を受け取る。
//
// サーバー側エンドポイントは PDF 用と兼用（テキスト + タイトルを LLM に流すだけで、
// PDF 固有のロジックは含まれていないため）。

import { apiBase, isTauri } from "../../lib/platform";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import type { ProvIngesterBlock } from "./prov-note-builder";

export type IngestDocxResult = {
  title: string;
  blocks: ProvIngesterBlock[];
  sourceTitle: string;
  sourceFetchedAt: string;
  model: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
};

function provHeaders(): Record<string, string> {
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
      });
    }
  }
  return h;
}

/**
 * Word (.docx) Blob から PROV ラベル付き構造化ブロックを取得する。
 * mammoth で raw text を抽出し、PDF 経路と同じサーバーエンドポイントに送る。
 */
export async function ingestDocxToProv(
  blob: Blob,
  fileName: string,
  language: string = "en",
): Promise<IngestDocxResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = await import("mammoth");
  const extracted = await mammoth.extractRawText({ arrayBuffer });
  const text = (extracted.value ?? "").trim();

  if (!text || text.length < 50) {
    throw new Error("Word から十分なテキストを抽出できませんでした");
  }

  const title = fileName.replace(/\.(docx|doc)$/i, "");

  const res = await fetch(`${apiBase()}/prov/ingest-pdf`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({
      text,
      title,
      language,
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Ingest failed (${res.status})`);
  }

  return await res.json();
}
