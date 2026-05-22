// URL Reader Mode 用 API ルート (PR3-d)
// POST /api/url/reader — URL を Readability で抽出して Reader 表示用ペイロードを返す

import { Hono } from "hono";
import {
  fetchAsReaderArticle,
  getCachedReaderArticle,
  setCachedReaderArticle,
  type ReaderError,
} from "../services/url-reader.js";

const app = new Hono();

app.post("/reader", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
  const url = body?.url?.trim();

  if (!url) {
    return c.json({ error: "url は必須です" }, 400);
  }

  // 簡易バリデーション: http(s) のみ受け付ける
  if (!/^https?:\/\//i.test(url)) {
    return c.json({ error: "http(s):// で始まる URL のみ対応しています" }, 400);
  }

  // キャッシュヒット
  const cached = getCachedReaderArticle(url);
  if (cached) {
    return c.json(cached);
  }

  try {
    const article = await fetchAsReaderArticle(url);
    setCachedReaderArticle(url, article);
    return c.json(article);
  } catch (err) {
    const e = err as ReaderError;
    if (typeof e?.status === "number" && typeof e?.message === "string") {
      return c.json({ error: e.message }, e.status);
    }
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("URL reader error:", err);
    return c.json({ error: message }, 500);
  }
});

export default app;
