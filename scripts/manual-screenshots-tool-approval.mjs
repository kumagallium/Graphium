/**
 * マニュアル用スクリーンショット撮影（チャットの実行前の確認ダイアログ）
 *
 * Storybook の ToolApprovalDialog「PostMessage」を英語で開き、ダイアログの枠を切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6018 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-tool-approval.mjs --port 6018
 *
 * 出力先: manual/public/screenshots/chat-tool-approval.png
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

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/iframe.html?id=molecules-toolapprovaldialog--post-message&viewMode=story`);
await page.getByText("Allow this tool?").waitFor({ state: "visible" });
await page.waitForTimeout(1200);
// オーバーレイの上の白い枠（Modal のコンテンツパネル）
const panel = page.locator('[data-modal-portal="true"] > div.relative').first();
const out = resolve(OUTPUT_DIR, "chat-tool-approval.png");
await panel.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
