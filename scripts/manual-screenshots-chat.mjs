/**
 * マニュアル用スクリーンショット撮影（ノートを開かずに話すチャット画面）
 *
 * チャット画面（左ナビのチャットのタブ・会話・横の全体グラフ）と、画像を添えた会話を、
 * Storybook の英語・パン作り世界観のストーリー（Manual (English, bread world)）から撮る。本物のアプリでは AI が付けた題の
 * 一覧を用意しにくいので、Storybook で撮る（共有ライブラリ・音声ノートと同じ作法）。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6016 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-chat.mjs --port 6016
 *
 * 出力先: manual/public/screenshots/chat-images.png（画像を添えた会話と、入力欄に添えた画像）
 *         manual/public/screenshots/chat-beside-graph.png（左ナビのチャットのタブ・会話・横の全体グラフ。
 *           画面全体を撮る。グラフの配置が終わり、答えの一度きりの火花が消えるまで待つ）
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

const shots = [
  // 入力欄の画像は play が貼り付けるので、送る前の画像の列が出るまで待つ
  { story: "molecules-chatimages--manual-english", file: "chat-images.png", waitFor: '[data-testid="pending-chat-images"] img' },
  { story: "organisms-standalonechat-chatbesidegraph--manual-english-bread", file: "chat-beside-graph.png", graph: true },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
for (const { story, file, waitFor, graph } of shots) {
  await page.goto(`${SB}?id=${story}&viewMode=story`);
  if (graph) {
    // 使ったページに印（act）が付く＝配置が終わった。火花の canvas が消えるまで待つ
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll("div")].find((d) => d._cyreg);
      return !!el && el._cyreg.cy.nodes("[act > 0]").length > 0;
    }, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('canvas[aria-hidden="true"]'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const out = resolve(OUTPUT_DIR, file);
    await page.screenshot({ path: out });
    console.log(`saved ${out}`);
    continue;
  }
  // ストーリーの decorator が作る枠（幅 1100 の div）をそのまま切り抜く
  const frame = page.locator("#storybook-root > div").first();
  await frame.waitFor({ state: "visible" });
  if (waitFor) await page.locator(waitFor).first().waitFor({ state: "visible" });
  else await page.getByText("Chat list", { exact: true }).or(page.getByRole("navigation")).first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, file);
  await frame.screenshot({ path: out });
  console.log(`saved ${out}`);
}
await browser.close();
