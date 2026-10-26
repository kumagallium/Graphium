/**
 * マニュアル用スクリーンショット撮影（ノートを開かずに話すチャット画面）
 *
 * 子ナビ + 会話の 2 列画面を、Storybook の英語・パン作り世界観のストーリー
 * （Manual (English, bread world)）から切り抜く。本物のアプリでは AI が付けた題の
 * 一覧を用意しにくいので、Storybook で撮る（共有ライブラリ・音声ノートと同じ作法）。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6016 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-chat.mjs --port 6016
 *
 * 出力先: manual/public/screenshots/chat-without-note-new.png（新しいチャット）
 *         manual/public/screenshots/chat-without-note-conversation.png（会話を選択中）
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
  { story: "organisms-standalonechatworkspace--manual-english-new-chat", file: "chat-without-note-new.png" },
  { story: "organisms-standalonechatworkspace--manual-english-conversation", file: "chat-without-note-conversation.png" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
for (const { story, file } of shots) {
  await page.goto(`${SB}?id=${story}&viewMode=story`);
  // ストーリーの decorator が作る枠（幅 1100 の div）をそのまま切り抜く
  const frame = page.locator("#storybook-root > div").first();
  await frame.waitFor({ state: "visible" });
  await page.getByText("Chat list", { exact: true }).or(page.getByRole("navigation")).first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, file);
  await frame.screenshot({ path: out });
  console.log(`saved ${out}`);
}
await browser.close();
