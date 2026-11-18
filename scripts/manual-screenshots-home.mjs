/**
 * マニュアル用スクリーンショット撮影（ホーム＝記録の画面）
 *
 * ホームの全体と、フォルダで絞るメニューを、Storybook の英語・パン作り世界観のストーリー
 * （Record Dashboard/3 Dashboard の BFindFoldersEnglish）から撮る。本物のアプリでは、3 か月分の
 * 記録とフォルダを用意しにくいので、Storybook で撮る（チャット画面・共有ライブラリと同じ作法）。
 * 部品はアプリのホームと同じ RecordDashboard で、絞り込みは仮データの上で実際に動く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6031 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-home.mjs --port 6031
 *
 * 出力先: manual/public/screenshots/home-records.png（日ごとの記録・カレンダー・探す欄）
 *         manual/public/screenshots/home-folder-filter.png（フォルダのメニューを開いたところ）
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 6006;
const outIdx = args.indexOf("--out");
const outDir = outIdx !== -1 ? resolve(args[outIdx + 1]) : OUTPUT_DIR;
mkdirSync(outDir, { recursive: true });
const STORY = `http://localhost:${port}/iframe.html?id=record-dashboard-3-dashboard--b-find-folders-english&viewMode=story`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(STORY);
await page.waitForSelector(".rd-folder-button", { timeout: 60000 });
await page.waitForTimeout(800);

// 1. ホームの全体
await page.screenshot({ path: resolve(outDir, "home-records.png") });
console.log("saved home-records.png");

// 2. フォルダのメニュー。開いて、絞り込みの行からメニューの下端までを切り抜く
await page.click(".rd-folder-button");
await page.waitForSelector(".rd-folder-menu", { timeout: 5000 });
await page.waitForTimeout(300);
const clip = await page.evaluate(() => {
  const root = document.querySelector(".rd-root").getBoundingClientRect();
  const button = document.querySelector(".rd-folder-button").getBoundingClientRect();
  const menu = document.querySelector(".rd-folder-menu").getBoundingClientRect();
  const top = Math.max(0, button.top - 56);
  return { x: Math.max(0, root.left - 8), y: top, width: Math.min(window.innerWidth, root.width + 16), height: menu.bottom + 24 - top };
});
await page.screenshot({ path: resolve(outDir, "home-folder-filter.png"), clip });
console.log("saved home-folder-filter.png", JSON.stringify(clip));

await browser.close();
