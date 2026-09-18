/**
 * マニュアル用スクリーンショット撮影（v0.80.0: 長い資料の窓読み・引用の位置）
 *
 * どちらも「実際に長い PDF を取り込む」か「出典照合を実行する」必要がある画面なので、
 * 英語・パン作り世界観のストーリー（Manual (English, …)）を Playwright で開いて撮る。
 * 先例: scripts/manual-screenshots-shared.mjs
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-windows.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 出力先: manual/public/screenshots/
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 6006;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const OUT_DIR = path.resolve(import.meta.dirname, "../manual/public/screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  {
    name: "source-check-quote-location",
    story: "molecules-sourcecheck--manual-quote-location",
    // 詳細欄は折りたたまれて出るので開いてから撮る（見出しのテキストを押す）
    prepare: async (page) => {
      await page.getByText("Source check details", { exact: false }).first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "ingest-window-progress",
    story: "molecules-ingesttoast--manual-window-progress",
    prepare: async (page) => {
      await page.waitForTimeout(500);
    },
    // トーストは画面右下に fixed 配置されるので、#storybook-root ではなくトースト自体を切り出す
    clipFrom: "text=Generating Knowledge",
  },
];

for (const shot of SHOTS) {
  if (only && only !== shot.name) continue;
  const browser = await chromium.launch();
  // 図の解像度は既存のマニュアル図に合わせる（1280x800 @2x）
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
  const page = await context.newPage();
  await page.goto(`http://localhost:${port}/iframe.html?id=${shot.story}&viewMode=story`, { waitUntil: "load" });
  await page.waitForSelector("#storybook-root", { state: "attached" });
  await shot.prepare(page);

  // ストーリーの中身だけを切り出す（背景の余白は 8px 残す）
  const target = shot.clipFrom
    // fixed 配置の部品は、テキストから一番近い「枠を持つ祖先」を切り出す
    ? page.locator(shot.clipFrom).first().locator("xpath=ancestor::div[contains(@class,'rounded') or contains(@class,'shadow')][1]")
    : page.locator("#storybook-root");
  const box = await target.boundingBox();
  if (!box) throw new Error(`bounding box が取れない: ${shot.story}`);
  const clip = {
    x: Math.max(0, box.x - 8),
    y: Math.max(0, box.y - 8),
    width: Math.min(1280, box.width + 16),
    height: Math.min(800, box.height + 16),
  };
  const out = path.join(OUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`撮影: ${out} (${Math.round(clip.width)}x${Math.round(clip.height)})`);
  await browser.close();
}
