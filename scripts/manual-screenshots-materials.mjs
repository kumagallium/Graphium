/**
 * マニュアル用スクリーンショット撮影（素材ギャラリー: ドキュメントを種類で絞り込むチップ）
 *
 * 英語・パン作り世界観のストーリー（AssetBrowser/AssetGalleryView の
 * Manual (English, bread world)）を Playwright で開いて撮る。
 * 先例: scripts/manual-screenshots-windows.mjs
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6007 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-materials.mjs --port 6007
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *
 * 出力先: manual/public/screenshots/material-gallery.png
 */
import { chromium } from "playwright";
import path from "path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 6006;
const OUT = path.resolve(import.meta.dirname, "../manual/public/screenshots/material-gallery.png");

const browser = await chromium.launch();
// 幅はアプリでサイドバーを除いたギャラリーの幅に近づける。解像度は既存のマニュアル図に合わせて @2x
const context = await browser.newContext({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
const page = await context.newPage();
await page.goto(
  `http://localhost:${port}/iframe.html?id=assetbrowser-assetgalleryview--manual-english&viewMode=story`,
  { waitUntil: "load" },
);
// 初回はストーリーのコンパイルに時間がかかる
await page.getByText("baking-workshop.pptx").waitFor({ state: "visible", timeout: 120000 });
await page.waitForTimeout(500);

// 見出しから表の最後の行まで（下に 16px 余白）を切り出す。幅は全幅
const table = await page.locator("#storybook-root table").boundingBox();
if (!table) throw new Error("一覧の表が見つかりません");
await page.screenshot({
  path: OUT,
  clip: { x: 0, y: 0, width: 960, height: Math.ceil(table.y + table.height + 16) },
});
console.log(`saved: ${OUT}`);

await browser.close();
