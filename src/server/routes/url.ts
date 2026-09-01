// URL Reader Mode 用 API ルート (PR3-d)
// POST /api/url/reader      — URL を Readability で抽出して Reader 表示用ペイロードを返す
// GET  /api/url/pdf-proxy   — リモート PDF をサーバ経由でストリームし PdfViewer に表示させる
// GET  /api/url/image-proxy — リモート画像をサーバ経由でストリームする（Reader 本文の表示 +「Graphium に保存」）

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
    return c.json({ error: "url is required" }, 400);
  }

  // 簡易バリデーション: http(s) のみ受け付ける
  if (!/^https?:\/\//i.test(url)) {
    return c.json({ error: "Only http(s):// URLs are supported" }, 400);
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
    const message = err instanceof Error ? err.message : "Unknown error";
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
    return c.json({ error: "A url query parameter starting with http(s):// is required" }, 400);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": PDF_PROXY_USER_AGENT, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(PDF_PROXY_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return c.json({ error: "Failed to fetch the PDF" }, 502);
  }

  if (!res.ok || !res.body) {
    return c.json({ error: `Failed to fetch the PDF (${res.status})` }, 502);
  }

  // HTML のエラーページ等をそのまま PDF として返さない。拡張子だけで PDF を配る
  // サーバは octet-stream を返すことがあるので、それも PDF 候補として許容する。
  const contentType = res.headers.get("content-type") ?? "";
  const looksPdf =
    contentType.includes("application/pdf") || contentType.includes("application/octet-stream");
  if (!looksPdf) {
    return c.json({ error: "This URL is not a PDF" }, 415);
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

// GET /api/url/image-proxy?url=<encoded>
//
// 用途は 2 つ:
//   1. Reader 本文の画像表示。url-reader.ts の sanitizeReaderHtml が https の画像参照
//      （<img src> とインライン SVG の <image href>）をここに書き換えるので、記事を
//      開いた時点でユーザー操作なしに叩かれる
//   2. 表示中の記事画像を「Graphium に保存」する動線。バイトを取り込むには canvas の
//      cross-origin taint を避けて別経路で取得する必要がある
//
// このプロキシが実際に消すもの: Cookie の送出（undici に cookie jar は無い）、上流の
// Set-Cookie（下でヘッダを組み直すので伝播しない）、Referer、WebView の実 UA /
// client hints、WebView の HTTP キャッシュ（ETag による再識別）。
// 消さないもの: リクエストそのものと送信元 IP。sidecar は同じマシンで動くので、配信元には
// 「その IP がその時刻にその画像を取った」記録が変わらず残る。第三者ホストへの接続を
// 無くす仕組みではない。
//
// http(s) のみ許可し、content-type が image/* でなければ 415 で弾いて汎用プロキシへの
// 転用を防ぐ。加えて 1. でユーザー操作なしに叩かれるようになったため、宛先がループバック /
// プライベート / リンクローカルなら拒否する（isBlockedProxyTarget）。
const IMAGE_PROXY_TIMEOUT_MS = 15_000;
/** content-length で分かる範囲の上限。chunked で延々流してくる相手までは止められない。 */
const IMAGE_PROXY_MAX_BYTES = 32 * 1024 * 1024;

app.get("/image-proxy", async (c) => {
  const url = c.req.query("url")?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return c.json({ error: "A url query parameter starting with http(s):// is required" }, 400);
  }
  if (isBlockedProxyTarget(url)) {
    return c.json({ error: "This host is not allowed" }, 403);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      // pdf-proxy と同じ実在ブラウザ UA。非ブラウザ UA を 403 にする配信元への互換性。
      headers: { "User-Agent": PDF_PROXY_USER_AGENT, Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(IMAGE_PROXY_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return c.json({ error: "Failed to fetch the image" }, 502);
  }

  // redirect: "follow" なので、公開ホストからプライベート宛へ飛ばされていないか最終 URL で
  // 見直す。ホスト名がプライベート IP に解決されるケース（DNS rebinding 含む）はここでは
  // 防げない —— それにはカスタム DNS lookup とソケット単位の検査が要る。
  // res.url はリダイレクト後の最終 URL。空になる実装もあるので元の url にフォールバックする。
  if (isBlockedProxyTarget(res.url || url)) {
    void res.body?.cancel();
    return c.json({ error: "This host is not allowed" }, 403);
  }

  if (!res.ok || !res.body) {
    return c.json({ error: `Failed to fetch the image (${res.status})` }, 502);
  }

  // 画像以外（HTML エラーページ等）を画像として返さない。image/* のみ許可する。
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    void res.body.cancel();
    return c.json({ error: "This URL is not an image" }, 415);
  }

  const len = res.headers.get("content-length");
  if (len && Number(len) > IMAGE_PROXY_MAX_BYTES) {
    void res.body.cancel();
    return c.json({ error: "This image is too large" }, 413);
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    // 上流の content-type をそのまま返すので、sniff で別物として解釈されないようにする
    "X-Content-Type-Options": "nosniff",
    // 再取得を軽くする短期キャッシュ（sidecar はローカルなので private）
    "Cache-Control": "private, max-age=300",
  };
  if (len) headers["Content-Length"] = len;

  return c.body(res.body, 200, headers);
});

/**
 * プロキシ先として拒否すべき URL か。
 *
 * 目的は「Reader 本文の画像が自動でプロキシされる」ことで新たに増える到達性を塞ぐこと。
 * 記事側が `<img src="http://192.168.1.1/admin?action=reboot">` を仕込んでも sidecar に
 * LAN を叩かせない。本文側は https だけを書き換え対象にしているので二重の防御だが、
 * 保存動線や将来の呼び出し元も含めてここで一括して止める。
 *
 * 見るのは URL の hostname だけ。WHATWG URL parser が `http://2130706433/` や
 * `http://0x7f.0.0.1/` を 127.0.0.1 に正規化するので数値表記は素通りしないが、
 * プライベート IP に解決される「普通のホスト名」は判定できない。
 */
export function isBlockedProxyTarget(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[")) return isPrivateIpv6(host);
  return isPrivateIpv4(host);
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return false; // IP リテラルとして不正 → ホスト名扱い
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 ("this network")
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local（169.254.169.254 = クラウドのメタデータ）
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved / 255.255.255.255
  );
}

function isPrivateIpv6(bracketed: string): boolean {
  const h = bracketed.replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
  // IPv4-mapped / IPv4-compatible は埋め込まれた v4 で判定する。URL parser は
  // ::ffff:127.0.0.1 を ::ffff:7f00:1 に畳むので 16bit グループ 2 つからも復元する。
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return isPrivateIpv4(dotted[1]);
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return false;
}

export default app;
