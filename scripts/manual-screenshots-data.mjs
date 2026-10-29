/**
 * マニュアル用スクリーンショット撮影（データ素材の一覧と右パネルの「元のテキスト」）
 *
 * 英語・パン作り世界観のストーリーを Playwright で開いて切り抜く。
 *   - AssetBrowser/AssetGalleryView の Data (list, bread world): 一覧の表
 *     → manual/public/screenshots/material-data-list.png
 *   - AssetBrowser/DataPreview の Long File: 「Raw text」タブ
 *     → manual/public/screenshots/material-data-raw-text.png
 * 先例: scripts/manual-screenshots-copy-link.mjs
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6007 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-data.mjs --port 6007
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 */
import { chromium } from "playwright";
import path from "path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 6006;
const OUT_DIR = path.resolve(import.meta.dirname, "../manual/public/screenshots");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2, locale: "en-US" });
const page = await context.newPage();

const open = async (story) => {
  await page.goto(`http://localhost:${port}/iframe.html?id=${story}&viewMode=story`, { waitUntil: "load" });
};

// 1. 一覧: 線が 3 本・表アイコン・読めない行が出そろってから表を切り抜く
await open("assetbrowser-assetgalleryview--data-list");
const table = page.locator("#storybook-root table").first();
// 初回はストーリーのコンパイルに時間がかかる
await table.waitFor({ state: "visible", timeout: 120000 });
await page.locator("#storybook-root table polyline").nth(3).waitFor({ state: "attached" });
await page.getByText("Could not be read").waitFor();
await page.waitForTimeout(300);
await table.screenshot({ path: path.join(OUT_DIR, "material-data-list.png") });

// 2. 右パネル: Raw text タブ（行番号と「先頭 500 行」の注記）を上の方だけ
await open("assetbrowser-datapreview--long-file");
const rawTab = page.getByRole("tab", { name: "Raw text" });
await rawTab.waitFor({ state: "visible", timeout: 120000 });
await rawTab.click();
await page.getByText("Showing the first").waitFor();
const root = await page.locator("#storybook-root > div").first().boundingBox();
await page.screenshot({
  path: path.join(OUT_DIR, "material-data-raw-text.png"),
  clip: { x: root.x, y: root.y, width: root.width, height: 260 },
});

await browser.close();
console.log("saved: material-data-list.png, material-data-raw-text.png");
