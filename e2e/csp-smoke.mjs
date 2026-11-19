#!/usr/bin/env node
/**
 * Web 版 CSP（<meta>）のスモークテスト。
 *
 * ビルド済みの dist（`pnpm build` 済み）を vite preview で静的配信し、Playwright で開いて、
 *   (1) ランディング（/Graphium/）とエディタ（/Graphium/app/）が開く
 *   (2) securitypolicyviolation を全部集める
 *   (3) /api が無くても動く操作（ノート作成・入力・数式・コード・設定・検索）を通す
 *   (4) GSI スクリプトを google-auth.ts と同じ方法（動的 <script src>）で読み、window.google.accounts.oauth2 が使える（ログインはしない）
 *   (5) 違反 0 件・コンソールの CSP エラー 0 件
 * を検査して終了コードで返す。あわせて「CSP が効いている証拠」として、
 * インライン <script> の注入が実行されないこと・外部オリジンのスクリプトが違反として記録されることを見る。
 *
 * 実行: pnpm build && node e2e/csp-smoke.mjs
 *   - preview ポート: E2E_CSP_PORT（既定 5191。5174 / 3001 は使わない）
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_CSP_PORT ?? 5191);
if (PORT === 5174 || PORT === 3001) throw new Error("5174 / 3001 は本番アプリが使う");
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.E2E_HEADED !== "1";
const log = (m) => console.log(`[csp-smoke] ${m}`);

let preview = null;
function stopPreview() {
  if (preview?.pid && preview.exitCode === null) {
    preview.__expectedExit = true;
    try { process.kill(-preview.pid, "SIGTERM"); } catch { try { preview.kill("SIGTERM"); } catch { /* 終了済み */ } }
  }
}
process.on("SIGINT", () => { stopPreview(); process.exit(130); });
process.on("SIGTERM", () => { stopPreview(); process.exit(143); });

async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* 未起動 */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const problems = [];
const fail = (m) => { problems.push(m); console.error(`[csp-smoke] NG ${m}`); };

// 逆向きの確認で「わざと」起こす違反はここに印を付けて、本番の違反と分ける
const EXPECTED_MARK = "example.invalid";

async function run() {
  preview = spawn(join(ROOT, "node_modules", ".bin", "vite"),
    ["preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, detached: true,
      // vite.config.ts の /api プロキシは PORT を見る。preview にも効くので、使われていないポートに向けて
      // 本番アプリの sidecar（3001）へ要求が届かないようにする
      env: { ...process.env, PORT: String(process.env.E2E_CSP_DEAD_API_PORT ?? 39999) }, stdio: ["ignore", "pipe", "pipe"] });
  preview.stderr.on("data", (d) => { if (process.env.E2E_VERBOSE) process.stderr.write(`[preview:err] ${d}`); });
  preview.on("exit", (code) => { if (!preview.__expectedExit) console.error(`[csp-smoke] preview exited (code=${code})`); });
  await waitForHttp(`${ORIGIN}/Graphium/`);
  log(`preview up: ${ORIGIN}/Graphium/`);

  const browser = await chromium.launch({ headless: HEADLESS, ...(process.env.CSP_SMOKE_CHANNEL ? { channel: process.env.CSP_SMOKE_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
    // 違反を全部集める。ページの読み込み前に仕込む
    await context.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations.push({
          directive: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile, line: e.lineNumber,
        });
      });
    });
    const consoleCsp = [];
    const collect = (page) => {
      page.on("console", (msg) => {
        const t = msg.text();
        if (/Content Security Policy|Content-Security-Policy|Refused to/i.test(t)) consoleCsp.push(t);
      });
      page.on("pageerror", (e) => log(`pageerror: ${String(e).slice(0, 160)}`));
    };
    const violations = async (page) => page.evaluate(() => window.__cspViolations ?? []);

    // (1) ランディング
    const landing = await context.newPage();
    collect(landing);
    await landing.goto(`${ORIGIN}/Graphium/?intro=1`, { waitUntil: "load" });
    await landing.waitForSelector("#root *", { timeout: 20_000 });
    log("landing opened");
    const landingV = await violations(landing);
    if (landingV.length) fail(`landing: 違反 ${JSON.stringify(landingV)}`);
    await landing.close();

    // (1b) 再訪者リダイレクトのインラインスクリプトがハッシュで実行される（localStorage に graphium キー → /app/ へ）
    const redir = await context.newPage();
    collect(redir);
    await redir.addInitScript(() => { try { localStorage.setItem("graphium-csp-smoke", "1"); } catch { /* */ } });
    await redir.goto(`${ORIGIN}/Graphium/`, { waitUntil: "load" });
    try {
      await redir.waitForURL(/\/Graphium\/app\//, { timeout: 15_000 });
      log("inline redirect script ran (hash allowed)");
    } catch {
      fail("再訪者リダイレクトのインラインスクリプトが実行されなかった（ハッシュ不一致の疑い）");
    }
    await redir.close();

    // (1c) エディタ
    const page = await context.newPage();
    collect(page);
    await page.goto(`${ORIGIN}/Graphium/app/`, { waitUntil: "load" });
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // ウェルカムダイアログ（初回のみ表示）を閉じる
    await page.getByRole("button", { name: "Open Graphium" }).click({ timeout: 30_000 });

    // (3) ノート作成・入力
    await page.getByRole("button", { name: "+ Note" }).click({ timeout: 20_000 });
    const title = page.getByPlaceholder("Note title");
    await title.waitFor({ timeout: 20_000 });
    await title.fill("CSP smoke");
    const editor = page.locator(".bn-editor").first();
    await editor.click();
    await page.keyboard.type("hello csp ");
    log("typed into a note");

    // 数式（mathlive）とコードブロック（shiki）をスラッシュメニューから。出なければ unverified 扱いで警告
    for (const [query, label] of [["math", "math"], ["code", "code block"]]) {
      // 直前に挿入したブロック（数式のフィールドなど）にフォーカスが残るため、最初の段落の末尾から新しい段落を作る
      await page.locator(".bn-editor").getByText("hello csp").first().click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`/${query}`);
      await page.waitForTimeout(500);
      const item = page.locator(".bn-suggestion-menu-item").first();
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        await page.waitForTimeout(1500);
        log(`inserted ${label}`);
      } else {
        fail(`スラッシュメニューに ${label} が出ない（UI 文言の変更で検査が空振りしていないか確認）`);
        await page.keyboard.press("Escape");
      }
    }
    await page.keyboard.press("Escape");

    // 設定画面・検索
    const settingsBtn = page.getByRole("button", { name: /settings/i }).first();
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1000);
      log("opened settings");
      await page.keyboard.press("Escape");
    } else {
      fail("設定ボタンが見つからない（UI 文言の変更で検査が空振りしていないか確認）");
    }
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(800);
    log("opened search (Ctrl+K)");
    await page.keyboard.press("Escape");

    // PWA: service worker の登録が CSP で潰れていない
    const sw = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10_000))]);
      return reg ? "ready" : "timeout";
    });
    log(`service worker: ${sw}`);
    if (sw !== "ready") fail(`service worker が ready にならない: ${sw}`);

    // (4) GSI を google-auth.ts と同じ方法で読む（ログインはしない）
    const gsi = await page.evaluate(() => new Promise((resolveP) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolveP({ ok: !!window.google?.accounts?.oauth2 });
      s.onerror = () => resolveP({ ok: false, error: "load error" });
      document.head.appendChild(s);
      setTimeout(() => resolveP({ ok: false, error: "timeout" }), 20_000);
    }));
    if (gsi.ok) log("GSI loaded: window.google.accounts.oauth2 available");
    else fail(`GSI を読めない / oauth2 が無い: ${JSON.stringify(gsi)}（ネットワーク不通の可能性も）`);

    // wasm・worker の素の確認（PDF / OCR / 画像デコードの下回り）。実機能そのものは動かさない
    const rt = await page.evaluate(async () => {
      const r = {};
      try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); r.wasm = true; } catch (e) { r.wasm = String(e); }
      const spawn = (url, opts) => new Promise((res) => {
        try {
          const w = new Worker(url, opts);
          w.onerror = (e) => { res(`error ` + (e.message || "")); w.terminate(); };
          setTimeout(() => { res(true); w.terminate(); }, 1000);
        } catch (e) { res(String(e)); }
      });
      const blobUrl = URL.createObjectURL(new Blob(["self.onmessage=()=>{}"], { type: "text/javascript" }));
      r.blobWorker = await spawn(blobUrl);
      r.pdfWorker = await spawn("/Graphium/pdfjs/pdf.worker.min.js", { type: "module" });
      r.tesseractWorker = await spawn("/Graphium/tesseract/worker.min.js");
      return r;
    });
    log(`runtime probes: ${JSON.stringify(rt)}`);
    for (const [k, v] of Object.entries(rt)) if (v !== true) fail(`${k}: ${v}`);

    // 共有ライブラリの PDF プレビューと同じ形（<embed type=application/pdf src=blob:>）が object-src で遮断されない
    await page.evaluate(() => {
      const url = URL.createObjectURL(new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }));
      const em = document.createElement("embed");
      em.type = "application/pdf";
      em.src = url;
      document.body.appendChild(em);
    });
    await page.waitForTimeout(800);
    log("inserted blob: PDF embed (shared library preview shape)");
    // 同梱の headless Chromium には PDF ビューアが無く、この経路は frame-src を通らず空振りする。
    // 実 Chrome（PDF ビューア有効）で確かめるときは CSP_SMOKE_CHANNEL=chrome を付ける
    const pdfViewer = await page.evaluate(() => navigator.pdfViewerEnabled);
    if (!pdfViewer) log("WARN: PDF ビューア無しのブラウザ。PDF embed の検査は空振り（CSP_SMOKE_CHANNEL=chrome で再実行）");

    // ここまでの違反（逆向きの確認の前）
    const real = await violations(page);
    if (real.length) fail(`editor: 違反 ${JSON.stringify(real)}`);
    if (consoleCsp.length) fail(`コンソールの CSP エラー ${consoleCsp.length} 件: ${consoleCsp[0].slice(0, 200)}`);

    // 逆向きの確認: CSP が効いている証拠
    const probe = await page.evaluate(() => new Promise((resolveP) => {
      window.__injected = false;
      const inline = document.createElement("script");
      inline.textContent = "window.__injected = true;";
      document.body.appendChild(inline);
      const ext = document.createElement("script");
      ext.src = "https://example.invalid/x.js";
      document.body.appendChild(ext);
      setTimeout(() => resolveP({ injected: window.__injected, v: window.__cspViolations }), 1500);
    }));
    if (probe.injected) fail("注入したインライン <script> が実行された（CSP が効いていない）");
    else log("injected inline script was blocked");
    const inlineV = probe.v.some((v) => v.directive.startsWith("script-src") && /inline/.test(v.blocked));
    const extV = probe.v.some((v) => String(v.blocked).includes(EXPECTED_MARK));
    if (!inlineV) fail("インライン script の違反が記録されなかった");
    if (!extV) fail("外部オリジン script の違反が記録されなかった");
    if (inlineV && extV) log("violations recorded for inline + external script (CSP is active)");
  } finally {
    await browser.close();
  }
}

try {
  await run();
} catch (e) {
  fail(`例外: ${e?.stack ?? e}`);
} finally {
  stopPreview();
}
if (problems.length) { console.error(`[csp-smoke] FAILED (${problems.length})`); process.exit(1); }
console.log("[csp-smoke] PASSED");
process.exit(0);
