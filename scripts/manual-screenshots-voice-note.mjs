/**
 * マニュアル用スクリーンショット撮影（音声ノートのブロック）
 *
 * 音声ノートはデスクトップ（Tauri）専用で、録音と AI が要るので本物のアプリでは撮りにくい。
 * Storybook の英語・パン作り世界観のストーリー（Manual (English, bread world)）を開いて、
 * ブロックだけを切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-voice-note.mjs --port 6013
 *
 * 出力先: manual/public/screenshots/voice-note-block.png
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
const PAD = 16;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
// 英語 UI で描く（i18n は localStorage の graphium_locale を見る）
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(`${SB}?id=blocks-meetingtranscriptblock--manual-english&viewMode=story`);
const card = page.locator("#storybook-root [contenteditable=false]").first();
await card.waitFor({ state: "visible" });
await page.waitForTimeout(1500);
const box = await card.boundingBox();
if (!box) throw new Error("ブロックが見つかりません");
const out = resolve(OUTPUT_DIR, "voice-note-block.png");
await page.screenshot({
  path: out,
  clip: { x: Math.max(0, box.x - PAD), y: Math.max(0, box.y - PAD), width: box.width + PAD * 2, height: box.height + PAD * 2 },
});
console.log(`saved ${out}`);
await browser.close();
