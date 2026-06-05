// AI 使用量 API ルート
// GET /api/usage → 直近 raw events と月次サマリを返す。
// ダッシュボード UI はこのレスポンスを元にクライアント側で日/月/年の集計を行う。

import { Hono } from "hono";
import { loadUsageLog, loadUsageSummary, recalculateUsageCosts } from "../services/llm-usage.js";
import { getServerMode, getModel, listModels } from "../config/models.js";

const app = new Hono();

app.get("/", (c) => {
  if (getServerMode() === "vercel") {
    return c.json({
      raw: [],
      summary: [],
      mode: "vercel",
      note: "Vercel モードでは使用量ログは未対応です",
    });
  }
  const raw = loadUsageLog();
  const summary = loadUsageSummary();
  return c.json({ raw, summary, mode: "node" });
});

// POST /api/usage/recalculate
// 直近 90 日の raw event を、現在登録されているモデルの単価で計算し直す。
// 単価を後から修正したときに過去のコスト表示を揃え直す用途。
app.post("/recalculate", (c) => {
  if (getServerMode() === "vercel") {
    return c.json({ error: "Vercel モードでは使用量ログは未対応です" }, 400);
  }
  const models = listModels();
  const result = recalculateUsageCosts((ev) => {
    // 1) modelConfigId で厳密一致（Tauri / Docker のローカル登録モデル）
    if (ev.modelConfigId) {
      const byId = getModel(ev.modelConfigId);
      if (byId?.rate) return byId.rate;
    }
    // 2) provider + modelId で一致。Web / header 経由の呼び出しは
    //    modelConfigId が "header-injected" になり ID 一致しないため、
    //    モデル名で現在の登録モデルに紐づけて単価を引く。
    return models.find((m) => m.provider === ev.provider && m.modelId === ev.modelId)?.rate;
  });
  return c.json(result);
});

export default app;
