// URL Reader Mode 用 API ルート (PR3-d)
// POST /api/url/reader    — URL を Readability で抽出して Reader 表示用ペイロードを返す
// GET  /api/url/pdf-proxy — リモート PDF をサーバ経由でストリームし PdfViewer に表示させる

import { Hono } from "hono";
import {
  fetchAsReaderArticle,
  getCachedReaderArticle,
  setCachedReaderArticle,
  type ReaderError,
} from "../services/url-reader.js";

const app = new Hono();

// PDF プロキシ用。多くの配信元は非ブラウザ UA を 403 にするため実在ブラウザ UA を使う
// （url-reader.ts と同じ意図。Cloudflare 等の JS チャレンジは UA では突破できない）。
const PDF_PROXY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PDF_PROXY_TIMEOUT_MS = 20_000;

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
    // PDF は Readability で読めないが PdfViewer なら表示できる。エラーにせず
    // 「これは PDF」というシグナルを 200 で返し、クライアントに PdfViewer へ
    // 切り替えさせる（実体は /pdf-proxy 経由で描画）。
    if (e?.code === "pdf") {
      return c.json({ kind: "pdf", url }, 200);
    }
    if (typeof e?.status === "number" && typeof e?.message === "string") {
      return c.json({ error: e.message }, e.status);
    }
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("URL reader error:", err);
    return c.json({ error: message }, 500);
  }
});

// GET /api/url/pdf-proxy?url=<encoded>
//
// リモート PDF をサーバ経由でクライアントに中継する。react-pdf(<Document file>) は
// ブラウザから直接クロスオリジンの PDF を fetch できない（CORS）ため、同一オリジンの
// この sidecar ルートを噛ませることで表示可能にする。
//
// これは /reader が既に行っている「任意ユーザー URL をサーバ側で fetch する」のと
// 同じ信頼レベルであり、新たな到達性を増やすものではない。http(s) のみ許可し、
// content-type が PDF でなければ 415 で弾いて汎用プロキシへの転用を防ぐ。
app.get("/pdf-proxy", async (c) => {
  const url = c.req.query("url")?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return c.json({ error: "http(s):// で始まる url クエリが必要です" }, 400);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": PDF_PROXY_USER_AGENT, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(PDF_PROXY_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return c.json({ error: "PDF の取得に失敗しました" }, 502);
  }

  if (!res.ok || !res.body) {
    return c.json({ error: `PDF の取得に失敗しました (${res.status})` }, 502);
  }

  // HTML のエラーページ等をそのまま PDF として返さない。拡張子だけで PDF を配る
  // サーバは octet-stream を返すことがあるので、それも PDF 候補として許容する。
  const contentType = res.headers.get("content-type") ?? "";
  const looksPdf =
    contentType.includes("application/pdf") || contentType.includes("application/octet-stream");
  if (!looksPdf) {
    return c.json({ error: "この URL は PDF ではありません" }, 415);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": "inline",
    // 再オープン時の取得を軽くする短期キャッシュ（sidecar はローカルなので private）
    "Cache-Control": "private, max-age=300",
  };
  const len = res.headers.get("content-length");
  if (len) headers["Content-Length"] = len;

  return c.body(res.body, 200, headers);
});

export default app;
