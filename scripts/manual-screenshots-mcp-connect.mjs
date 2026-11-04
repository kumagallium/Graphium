/**
 * マニュアル用スクリーンショット撮影（外部ツール（MCP）を選んでつなぐ画面）
 *
 * Storybook の McpConnect を英語で開き、枠ごと切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6017 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-mcp-connect.mjs --port 6017
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮る
 *                   settings-mcp-connect / settings-mcp-connect-key
 *
 * settings-mcp-connect: 厳選の接続先（Tavily）と、公式レジストリを探した結果（PickSearched）
 * settings-mcp-connect-key: Tavily のキーの画面（KeyStart）
 *
 * 出力先: manual/public/screenshots/settings-mcp-connect.png / settings-mcp-connect-key.png
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

const SHOTS = [
  { name: "settings-mcp-connect", story: "molecules-mcpconnect--pick-searched", ready: "Search the official list" },
  { name: "settings-mcp-connect-key", story: "molecules-mcpconnect--key-start", ready: "Connect Tavily" },
];

const browser = await chromium.launch({ headless: true });
for (const shot of SHOTS) {
  if (!want(shot.name)) continue;
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/iframe.html?id=${shot.story}&viewMode=story`);
  const frame = page.locator("#storybook-root > div").first();
  await frame.waitFor({ state: "visible" });
  await page.getByText(shot.ready).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await frame.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}
await browser.close();
