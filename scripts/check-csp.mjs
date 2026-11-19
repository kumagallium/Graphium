#!/usr/bin/env node
/**
 * ビルド済み dist の入口 HTML を検査する（node だけで動く。CI からも使える）。
 *   - dist/index.html と dist/app/index.html に CSP の <meta> がちょうど 1 つある
 *   - 残っているインラインの <script> が、すべて script-src のハッシュに載っている
 *   - script-src に 'unsafe-inline' / 'unsafe-eval' が無い
 * 使い方: node scripts/check-csp.mjs [dist のパス]（既定 dist）
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const files = ["index.html", join("app", "index.html")];
let failed = 0;
const fail = (file, msg) => {
  console.error(`[csp:check] NG ${file}: ${msg}`);
  failed++;
};

for (const f of files) {
  const html = readFileSync(join(dist, f), "utf8");
  const metas = [...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi)];
  if (metas.length !== 1) {
    fail(f, `CSP の meta が ${metas.length} 個（1 個であるべき）`);
    continue;
  }
  const content = /content\s*=\s*"([^"]*)"/i.exec(metas[0][0])?.[1] ?? "";
  const scriptSrc = content.split(";").map((s) => s.trim()).find((d) => d.startsWith("script-src ")) ?? "";
  // script-src は許可リスト以外（* / https: / data: / blob: / unsafe-* など）を通さない
  const allowed = ["'self'", "'wasm-unsafe-eval'", "https://accounts.google.com/gsi/client"];
  for (const tok of scriptSrc.split(/\s+/).slice(1)) {
    if (!allowed.includes(tok) && !/^'sha256-[A-Za-z0-9+/=]+'$/.test(tok)) fail(f, `script-src に許可リスト外の指定: ${tok}`);
  }
  // 必須の指定が欠けていないこと
  const dirs = new Map(content.split(";").map((s) => s.trim()).filter(Boolean).map((s) => [s.split(/\s+/)[0], s.split(/\s+/).slice(1)]));
  for (const tok of allowed) if (!dirs.get("script-src")?.includes(tok)) fail(f, `script-src に ${tok} が無い`);
  const need = { "default-src": "'self'", "base-uri": "'self'", "object-src": "blob:", "frame-src": "https://accounts.google.com/gsi/" };
  // frame-src は GIS と PDF プレビュー（blob:）だけ
  const frameOk = new Set(["https://accounts.google.com/gsi/", "blob:"]);
  for (const [d, v] of Object.entries(need)) {
    if (!dirs.get(d)?.includes(v)) fail(f, `${d} に ${v} が無い`);
  }
  if (dirs.get("object-src")?.some((v) => v !== "blob:" && v !== "'none'")) fail(f, "object-src に blob: 以外の許可がある");
  if (!dirs.get("frame-src")?.includes("blob:")) fail(f, "frame-src に blob:（PDF プレビュー）が無い");
  if (dirs.get("frame-src")?.some((v) => !frameOk.has(v))) fail(f, "frame-src に許可リスト外の指定がある");
  // 値の一覧（配列）の中に、この指定そのものがあるかを見る（文字列の部分一致ではない）
  if (!dirs.get("style-src")?.some((v) => v === "https://accounts.google.com/gsi/style")) fail(f, "style-src に GIS が無い");
  // インラインのイベントハンドラ属性（onclick= など）は script-src のハッシュでは許可できない
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) fail(f, "インラインのイベントハンドラ属性がある");
  if (/upgrade-insecure-requests|frame-ancestors/.test(content)) fail(f, "meta で効かない / 入れない方針の指定がある");

  let inline = 0;
  // 終了タグは </script > のような空白入りも拾う（ブラウザはそれも終了タグとして読む）
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1]) || m[2].trim() === "") continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    inline++;
    const hash = `'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`;
    if (!scriptSrc.includes(hash)) fail(f, `インラインスクリプトのハッシュが script-src に無い: ${hash}`);
  }
  console.log(`[csp:check] ${f}: meta 1 個・インライン script ${inline} 個を確認`);
}

if (failed) process.exit(1);
console.log("[csp:check] OK");
