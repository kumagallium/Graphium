/**
 * マニュアル用スクリーンショット撮影（全体グラフの島レイアウト）
 *
 * 英語・パン作り世界観のストーリー（GlobalGraphStructure の Manual (English, bread world)）を
 * 800×700 @2x で開いて、島の名前（Display の「Island names」・既定オン）が出た状態で撮る。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-graph.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *
 * 出力先: manual/public/screenshots/global-graph-islands_en.png
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
const SB = `http://localhost:${port}/iframe.html`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(`${SB}?id=graph-globalgraphstructure--manual-english&viewMode=story`);
await page.getByText("Global Graph").first().waitFor({ state: "visible" });
// 力学配置が落ち着くまで待つ
await page.waitForTimeout(6000);
const out = resolve(OUTPUT_DIR, "global-graph-islands_en.png");
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
