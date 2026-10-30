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
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮る
 *                   settings-ai-free-providers / ai-connect-key-form
 *
 * ai-connect-key-form: 「Connect to OpenAI」でキー（伏せ字）を貼って接続できた状態＋Advanced settings を開いた状態
 *   （FormReadyAdvanced。キーは入れず、ストーリーの偽の応答で Connected になる）
 *
 * 出力先: manual/public/screenshots/settings-ai-free-providers.png / ai-connect-key-form.png
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

const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
const want = (n) => !only || only === n;

const browser = await chromium.launch({ headless: true });
// 縦に長い一覧なので、全体が 1 画面に入る高さにする
if (want("settings-ai-free-providers")) {
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
await ctx.close();
}

if (want("ai-connect-key-form")) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/iframe.html?id=molecules-aiconnect--form-ready-advanced&viewMode=story`);
  const frame = page.locator("#storybook-root > div").first();
  await frame.waitFor({ state: "visible" });
  await page.getByText("Connect to OpenAI").waitFor({ state: "visible" });
  await page.getByText(/Connected\. Using/).waitFor({ state: "visible" });
  await page.getByText("API Base URL").waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, "ai-connect-key-form.png");
  await frame.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}
await browser.close();
