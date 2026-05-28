// AI 使用量 API ルート
// GET /api/usage → 直近 raw events と月次サマリを返す。
// ダッシュボード UI はこのレスポンスを元にクライアント側で日/月/年の集計を行う。

import { Hono } from "hono";
import { loadUsageLog, loadUsageSummary } from "../services/llm-usage.js";
import { getServerMode } from "../config/models.js";

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

export default app;
