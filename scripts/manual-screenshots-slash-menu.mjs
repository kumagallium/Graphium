/**
 * マニュアル用スクリーンショット撮影（スラッシュメニュー）
 *
 * notes-and-editor.md の「Slash menu reference」に載せる 1 枚。隔離データで起動した
 * 開発サーバーに英語 UI で入り、ノートに 1 文書いてから `/` を打ち、メニューを
 * 「Advanced」の見出しが先頭に来るところまで送って撮る（Advanced と Media の
 * 2 グループが 1 画面に入る）。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port 5189 --strictPort --host 127.0.0.1               # 別ターミナル
 *   node scripts/manual-screenshots-slash-menu.mjs --port 5189
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *   --out <path>    出力先（既定 manual/public/screenshots/slash-menu.png）
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）を先に閉じないと、オーバーレイが
 *   すべてのクリックを横取りする
 * - Service Worker を block しないと PWA の自動リロードが入力と競合する
 * - `/` は Playwright のキーボードで打つ（ProseMirror に届き、BlockNote が候補を開く）
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const port = parseInt(opt("--port", "5189"), 10);
const out = resolve(opt("--out", resolve(OUTPUT_DIR, "slash-menu.png")));

const BASE_URL = `http://127.0.0.1:${port}/Graphium/app/`;
const VIEWPORT = { width: 1280, height: 800 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await ctx.addInitScript(() => {
  localStorage.setItem("graphium_locale", "en");
  localStorage.setItem("graphium-zoom-hint-dismissed", "1");
});

const page = await ctx.newPage();
console.log(`dev server: ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
if (await welcome.count()) {
  await welcome.click();
  await page.waitForTimeout(1200);
}

// 題名と本文（パン作りの世界観）
await page.locator('textarea[placeholder="Note title"]').first().fill("Sourdough starter log");
const editor = page.locator(".bn-editor").first();
await editor.click();
await page.keyboard.type("Day 5: doubled in 6 hours after feeding. Smells mildly sour.");
await page.keyboard.press("Enter");
await page.keyboard.type("/");
const menu = page.locator(".bn-suggestion-menu").first();
await menu.waitFor({ state: "visible", timeout: 10000 });
await page.waitForTimeout(400);

// 「Advanced」の見出しが上から 2 項目目あたりに来るまで送る（前のグループとの境の罫線と
// 小さな見出し、その下にアイコン付きの項目が並ぶ様子が 1 画面に入る）
const scrolled = await page.evaluate(() => {
  const m = document.querySelector(".bn-suggestion-menu");
  const label = Array.from(m.querySelectorAll(".bn-suggestion-menu-label")).find(
    (el) => el.textContent.trim() === "Advanced",
  );
  if (!label) return "no Advanced label";
  m.scrollTop = label.offsetTop - m.offsetTop - 96;
  return `scrollTop=${m.scrollTop}`;
});
console.log(scrolled);
// 開いている間は "Unsaved" が出る。ヘッダーの保存状態の文字だけ隠して撮る（内容は偽らない）
await page.evaluate(() => {
  for (const el of document.querySelectorAll("span, div")) {
    if (el.children.length === 0 && el.textContent.trim() === "Unsaved") el.style.visibility = "hidden";
  }
});
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(`  ✓ ${out}`);

await ctx.close();
await browser.close();
