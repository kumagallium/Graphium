/**
 * マニュアル用スクリーンショット撮影（「リンクをコピー」とサイドピークの ⋯）
 *
 * 英語・パン作り世界観のストーリーを Playwright で開き、⋯ を開いてから
 * ピークのヘッダーとメニューをまとめて切り抜く。
 *   - AssetBrowser/MaterialSidePeek の Manual (English, bread world): copy link
 *     → manual/public/screenshots/material-copy-link.png
 *   - Molecules/PeekNoteMenu の Manual (English, bread world)
 *     → manual/public/screenshots/side-peek-menu.png
 * 先例: scripts/manual-screenshots-materials.mjs
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6007 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-copy-link.mjs --port 6007
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 */
import { chromium } from "playwright";
import path from "path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 6006;
const OUT_DIR = path.resolve(import.meta.dirname, "../manual/public/screenshots");

const SHOTS = [
  {
    story: "assetbrowser-materialsidepeek--manual-english",
    // 素材のメニューはヘッダーの中に absolute で開く
    panel: "div.absolute.right-0.top-full",
    out: "material-copy-link.png",
  },
  {
    story: "molecules-peeknotemenu--manual-english",
    // ノートのピークのメニューは body へ portal で出る
    panel: "body > div.fixed",
    out: "side-peek-menu.png",
  },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2, locale: "en-US" });
const page = await context.newPage();

for (const shot of SHOTS) {
  await page.goto(`http://localhost:${port}/iframe.html?id=${shot.story}&viewMode=story`, { waitUntil: "load" });
  // 初回はストーリーのコンパイルに時間がかかる
  const menuButton = page.locator('#storybook-root button[aria-label="Menu"]').last();
  await menuButton.waitFor({ state: "visible", timeout: 120000 });
  await menuButton.click();
  const panel = page.locator(shot.panel).last();
  await panel.waitFor({ state: "visible" });
  await page.waitForTimeout(300);

  // ヘッダー = ⋯ ボタンから上へたどって最初に下線（border-bottom）を持つ要素
  const header = await menuButton.evaluate((btn) => {
    let el = btn.parentElement;
    while (el && parseFloat(getComputedStyle(el).borderBottomWidth) === 0) el = el.parentElement;
    const r = (el ?? btn).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const menu = await panel.boundingBox();
  if (!menu) throw new Error(`メニューが見つかりません: ${shot.story}`);

  // ヘッダーとメニューを囲む矩形（下に 16px 余白）。左右はヘッダーの幅
  const x = Math.floor(header.x);
  const y = Math.floor(header.y);
  const right = Math.ceil(Math.max(header.x + header.width, menu.x + menu.width));
  const bottom = Math.ceil(menu.y + menu.height + 16);
  const out = path.join(OUT_DIR, shot.out);
  await page.screenshot({ path: out, clip: { x, y, width: right - x, height: bottom - y } });
  console.log(`saved: ${out}`);
}

await browser.close();
