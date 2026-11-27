// AI 使用量 API ルート
// GET /api/usage → 直近 raw events と月次サマリを返す。
// ダッシュボード UI はこのレスポンスを元にクライアント側で日/月/年の集計を行う。

import { Hono } from "hono";
import {
  loadUsageLog,
  loadUsageSummary,
  makeRateResolver,
  recalculateUsageCosts,
} from "../services/llm-usage.js";
import { getServerMode, listModels } from "../config/models.js";

const app = new Hono();

app.get("/", (c) => {
  if (getServerMode() === "vercel") {
    return c.json({
      raw: [],
      summary: [],
      mode: "vercel",
      note: "Usage logging is not supported in Vercel mode",
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
    return c.json({ error: "Usage logging is not supported in Vercel mode" }, 400);
  }
  // 単価の一覧はここで 1 回だけ読む（listModels は呼ぶたびに Keychain を読むため、
  // event ごとに getModel を呼ぶと数万件で何時間も止まる）
  const result = recalculateUsageCosts(makeRateResolver(listModels()));
  return c.json(result);
});

export default app;
