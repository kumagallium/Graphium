/**
 * マニュアル用スクリーンショット撮影（Web クリップ）
 *
 * 次の図を実アプリと実際の拡張機能から撮る（パン作りの世界観・英語 UI）:
 *   web-clip-note       「Web clips」フォルダにできたページのノート（ブックマーク＋引用 3 つ）
 *   web-clip-settings   設定 → Storage → Share with other people の「Web clip」節（コードは伏せた状態）
 *   web-clip-extension  拡張機能の設定画面（コードを貼って Test connection を押した後）
 *
 * クリップは拡張機能と同じ口（POST /api/clip ＋ 合言葉）へ送り、アプリが受け取るのを待つ。
 *
 * 使い方（空の隔離データで起動しておく）:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port <port> --strictPort                              # 別ターミナル
 *   node scripts/manual-screenshots-web-clip.mjs --port <port> --api <api> [--only <name>]
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる
 * - Service Worker は block（PWA の自動リロードが入力と競合する）
 * - 拡張機能は headless でも読み込める（launchPersistentContext + --load-extension）。
 *   ただしショートカット・右クリックメニューはブラウザの UI なので Playwright からは押せない
 */
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const port = parseInt(opt("--port", "5189"), 10);
const api = parseInt(opt("--api", "3001"), 10);
const only = opt("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
const EXT = resolve(__dirname, "../extensions/chrome");
const BASE = `http://localhost:${port}/Graphium/app/`;
const API = `http://127.0.0.1:${api}/api`;
mkdirSync(OUT, { recursive: true });
const want = (name) => only.length === 0 || only.includes(name);

// ── クリップを送る（拡張機能と同じ口） ──
const { code } = await (await fetch(`${API}/clip/pairing`)).json();
const token = code.slice(code.indexOf(".") + 1);
const clips = [
  ["Gluten develops as flour hydrates; kneading only speeds it up.", "2026-11-03T09:00:00Z"],
  ["An autolyse of 20–30 minutes makes the dough easier to shape.", "2026-11-03T09:02:00Z"],
  ["Stop kneading when the dough passes the windowpane test.", "2026-11-03T09:05:00Z"],
];
for (const [text, clippedAt] of clips) {
  const res = await fetch(`${API}/clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Graphium-Clip-Token": token },
    body: JSON.stringify({
      url: "https://bread.example/guides/kneading?utm_source=newsletter",
      title: "How kneading builds gluten",
      text,
      clippedAt,
    }),
  });
  if (res.status !== 201) throw new Error(`clip failed: ${res.status}`);
}

// ── アプリ ──
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await ctx.addInitScript(() => {
  localStorage.setItem("graphium_locale", "en");
  localStorage.setItem("graphium-zoom-hint-dismissed", "1");
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
if (await welcome.count()) {
  await welcome.click();
  await page.waitForTimeout(1200);
}

// アプリが受け取り待ちを空にするまで待つ
for (let i = 0; i < 30; i++) {
  const { clips: pending } = await (await fetch(`${API}/clip/inbox`)).json();
  if (pending.length === 0) break;
  await page.waitForTimeout(1000);
}

if (want("web-clip-note")) {
  const noteId = await page.evaluate(async (apiBase) => {
    const res = await fetch(`${apiBase}/storage/notes`);
    const files = await res.json();
    for (const f of files) {
      const doc = await (await fetch(`${apiBase}/storage/notes/${f.id}`)).json();
      if (doc.title === "How kneading builds gluten") return f.id;
    }
    return null;
  }, "/api");
  if (!noteId) throw new Error("clip note not found");
  await page.goto(`${BASE}#note/${noteId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });
  // 題・フォルダのチップ・ブックマーク・引用の範囲
  const editor = page.locator(".bn-editor").first();
  const box = await editor.boundingBox();
  // 同じ文字列は上部バー・本文の題・ブックマークの 3 か所にある。本文の題（エディタより上で最も近いもの）を選ぶ
  const matches = page.getByText("How kneading builds gluten", { exact: true });
  let title = matches.first();
  for (let i = 0; i < (await matches.count()); i++) {
    const b = await matches.nth(i).boundingBox();
    if (b && b.y > 60 && b.y < box.y) title = matches.nth(i);
  }
  const tbox = await title.boundingBox();
  const top = Math.max(0, (tbox?.y ?? box.y) - 8);
  await page.screenshot({
    path: join(OUT, "web-clip-note.png"),
    clip: { x: box.x - 24, y: top, width: Math.min(box.width + 48, 760), height: box.y + box.height - top + 24 },
  });
  console.log("saved web-clip-note.png");
}

if (want("web-clip-settings")) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Storage", exact: true }).click();
  await page.waitForTimeout(600);
  const group = page.locator("button[aria-expanded]").filter({ hasText: "Share with other people" });
  if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
  const codeEl = page.getByTestId("web-clip-pairing-code");
  await codeEl.waitFor({ state: "visible", timeout: 10000 });
  // SettingSection の外枠（h3 → 見出しの列 → 見出しの行 → 外枠）
  const section = page.locator("h3", { hasText: "Web clip" }).locator("xpath=ancestor::div[3]");
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await section.screenshot({ path: join(OUT, "web-clip-settings.png") });
  console.log("saved web-clip-settings.png");
}
await browser.close();

// ── 拡張機能の設定画面 ──
if (want("web-clip-extension")) {
  const extCtx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "clip-ext-")), {
    channel: "chromium",
    headless: true,
    locale: "en-US",
    deviceScaleFactor: 2,
    viewport: { width: 720, height: 560 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = extCtx.serviceWorkers();
  if (!sw) sw = await extCtx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  const opt = await extCtx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.fill("#code", code);
  await opt.click("#save");
  await opt.click("#test");
  await opt.waitForTimeout(1000);
  // chrome.i18n は OS の表示言語に従い、headless では --lang が効かない（macOS が日本語だと日本語で出る）。
  // 図は英語 UI で揃えるので、表示中の文言だけ _locales/en の同じキーで差し替える（配置・状態は実物のまま）
  const en = JSON.parse(readFileSync(join(EXT, "_locales/en/messages.json"), "utf8"));
  await opt.evaluate((m) => {
    const set = (id, key, n) => {
      const el = document.getElementById(id);
      if (el && m[key]) el.textContent = m[key].message.replace("$COUNT$", n ?? "");
    };
    document.title = m.optTitle.message;
    set("title", "optTitle");
    set("codeLabel", "optCodeLabel");
    set("help", "optHelp");
    set("save", "optSave");
    set("test", "optTest");
    set("sendNow", "optSendNow");
    // 接続確認が実際に通ったときだけ「つながっている」の英語に差し替える
    if (document.getElementById("status")?.className === "ok") set("status", "optConnected");
    set("queueCount", "optQueue", "0");
  }, en);
  await opt.screenshot({ path: join(OUT, "web-clip-extension.png"), fullPage: true });
  console.log("saved web-clip-extension.png");
  await extCtx.close();
}
