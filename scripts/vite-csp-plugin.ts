import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/**
 * Web 版（GitHub Pages / Vercel / セルフホスト）の入口 HTML に入れる CSP を作る。
 *
 * Web 版は静的配信で応答ヘッダーを設定できない（GitHub Pages）ため <meta> で入れる。
 * デスクトップ版は src-tauri/tauri.conf.json の app.security.csp が担当するので、
 * ここは Tauri のビルドでは何も入れない（呼び出し側が isTauri で外す）。
 * 方針はデスクトップ版と同じ厳しさ（script-src 'self'）。Web 版に固有の違いだけ書く。
 */

/** インラインスクリプトの中身から CSP のハッシュ指定（'sha256-…'）を作る */
export function scriptHash(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

/** HTML に残っているインライン <script>（src なし・中身あり）の中身を集める */
export function findInlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1];
    const body = m[2];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    // JSON など実行されない型（application/json 等）はハッシュ不要
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== "module" && type !== "text/javascript" && type !== "application/javascript") continue;
    if (body.trim() === "") continue;
    out.push(body);
  }
  return out;
}

/**
 * Web 版の CSP 文字列を組み立てる（純粋関数）。
 * @param inlineScripts HTML に残るインラインスクリプトの中身（ハッシュで許可する）
 */
export function buildWebCsp(inlineScripts: string[] = []): string {
  const hashes = [...new Set(inlineScripts.map(scriptHash))];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        // wasm のコンパイルだけ許可する（Tesseract OCR / pdf.js / 埋め込みモデルの ORT）。JS の eval は許可しない
        "'wasm-unsafe-eval'",
        // Drive ログイン（Google Identity Services）。google-auth.ts が動的に読む。
        // パスまで絞って accounts.google.com 全体は許可しない
        "https://accounts.google.com/gsi/client",
        // index.html の再訪者リダイレクトなど、残るインラインスクリプトは中身のハッシュで許可
        ...hashes,
      ],
    ],
    // React のインライン style 属性・BlockNote・mathlive が使うため 'unsafe-inline' が必要。GIS のスタイルは公式要件
    ["style-src", ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"]],
    ["font-src", ["'self'", "data:"]],
    // ブックマーク画像・ユーザーが貼った URL のプレビュー・セルフホストの LAN(http) 上の画像を許可
    ["img-src", ["'self'", "data:", "blob:", "https:", "http:"]],
    ["media-src", ["'self'", "data:", "blob:", "https:", "http:"]],
    // ユーザーが設定した AI プロバイダ・Drive API・URL 取り込みなど任意の https 先へ接続する。
    // セルフホストの API は同一オリジン（'self'）
    ["connect-src", ["'self'", "https:", "blob:", "data:"]],
    // tesseract / pdf.js / 画像デコードの worker（blob: 経由のものを含む）
    ["worker-src", ["'self'", "blob:"]],
    // GIS の公式要件（ログインのポップアップ/iframe）。
    // blob: は共有ライブラリの PDF プレビュー用。Chrome の PDF ビューアは <embed> の blob: を
    // object-src ではなく frame-src で検査するため、両方に必要（実 Chrome で確認済み）
    ["frame-src", ["https://accounts.google.com/gsi/", "blob:"]],
    ["manifest-src", ["'self'"]],
    // 共有ライブラリの PDF プレビュー（SharedEntryBody の <embed type="application/pdf" src="blob:…">）が
    // object-src にも従うため、blob: だけ許可する（https: や 'self' は許可しない）。
    // blob: は同一オリジンのコードが作ったものに限られ、攻撃者が先にスクリプトを実行できている場合しか作れない
    ["object-src", ["blob:"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // upgrade-insecure-requests は入れない（セルフホストは LAN の http で使う）。
    // frame-ancestors は <meta> では効かないので入れない。
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/** 既に CSP の meta があれば置き換え、無ければ <meta charset> の直後（無ければ <head> 直後）に入れる */
export function injectCspMeta(html: string): string {
  const csp = buildWebCsp(findInlineScripts(html));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  const existing = /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i;
  if (existing.test(html)) return html.replace(existing, meta);
  const charset = /<meta\b[^>]*charset[^>]*>/i;
  if (charset.test(html)) return html.replace(charset, (m) => `${m}\n    ${meta}`);
  return html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${meta}`);
}

/** CSP の meta を入れるか。Tauri のビルドは tauri.conf.json の CSP を使うので入れない */
export function shouldInjectCsp(env: Record<string, string | undefined>): boolean {
  return env.TAURI_ENV_PLATFORM === undefined;
}

/** CSP を入れる HTML か（アプリの入口 2 つだけ） */
export function isAppEntryHtml(path: string): boolean {
  return /^\/?(app\/)?index\.html$/.test(path);
}

/** Web 版のビルドだけに CSP の <meta> を入れる Vite プラグイン */
export function cspPlugin(): Plugin {
  return {
    name: "graphium-web-csp",
    apply: "build",
    transformIndexHtml: {
      // VitePWA など他プラグインが足したタグを見てからハッシュを計算する
      order: "post",
      handler(html, ctx) {
        // アプリの入口（index.html と app/index.html）だけに入れる。Storybook のビルドもこの設定を読むので、
        // ほかの HTML（iframe.html など）には入れない
        if (!isAppEntryHtml(ctx.path)) return html;
        return injectCspMeta(html);
      },
    },
  };
}
