/**
 * マニュアル用スクリーンショット撮影（履歴の「証拠として固定する」）
 *
 * VersionSnapshots/SnapshotRow の Manual (English, bread world) を開き、
 * 固定済みの行と固定できる行を並べた枠を切り抜く。
 *   → manual/public/screenshots/history-seal.png
 * 先例: scripts/manual-screenshots-copy-link.mjs
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6007 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-seal.mjs --port 6007
 */
import { chromium } from "playwright";
import path from "path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 6006;
const OUT = path.resolve(import.meta.dirname, "../manual/public/screenshots/history-seal.png");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2, locale: "en-US" });
const page = await context.newPage();
await page.goto(
  `http://localhost:${port}/iframe.html?id=features-versionsnapshots-snapshotrow--manual-english&viewMode=story`,
  { waitUntil: "load" },
);
const frame = page.locator("[data-manual-shot]");
// 初回はストーリーのコンパイルに時間がかかる
await frame.waitFor({ state: "visible", timeout: 120000 });
await page.waitForTimeout(300);
await frame.screenshot({ path: OUT });
console.log(`saved: ${OUT}`);
await browser.close();
