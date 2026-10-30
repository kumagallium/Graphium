/**
 * マニュアル用スクリーンショット撮影（AI の接続先の選び方・クラウドサービスの一覧）
 *
 * Storybook の AiConnect「ChooserCloudOpen」を英語で開き、560px の枠ごと切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-ai-connect.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *
 * 出力先: manual/public/screenshots/settings-ai-free-providers.png
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
// 縦に長い一覧なので、全体が 1 画面に入る高さにする
const ctx = await browser.newContext({ viewport: { width: 900, height: 1800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/iframe.html?id=molecules-aiconnect--chooser-cloud-open&viewMode=story`);
const frame = page.locator("#storybook-root > div").first();
await frame.waitFor({ state: "visible" });
await page.getByText("Where do you want to connect?").waitFor({ state: "visible" });
await page.waitForTimeout(1500);
const out = resolve(OUTPUT_DIR, "settings-ai-free-providers.png");
await frame.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
