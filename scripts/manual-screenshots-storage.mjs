/**
 * マニュアル用スクリーンショット撮影（設定ダイアログのストレージタブ・デスクトップ版）
 *
 * 「ノートの保存先」（保存先フォルダと変更ボタン）はデスクトップ版（Tauri）にしか出ない。
 * ブラウザ版で撮ると Server storage が写って保存先の欄が無いので、Storybook の
 * StorageDesktop ストーリー（Tauri の invoke を偽装して英語で描画）から切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6016 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-storage.mjs --port 6016
 *
 * 出力先: manual/public/screenshots/settings-storage.png
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
const URL = `http://localhost:${port}/iframe.html?id=organisms-settingsmodal--storage-desktop&viewMode=story`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
await page.goto(URL);
const portal = page.locator('[data-modal-portal="true"]').first();
await portal.waitFor({ state: "visible" });
await page.getByText("Where your notes are saved").waitFor({ state: "visible" });
await page.waitForTimeout(1200);
const dialog = portal.locator('[role="dialog"]').first();
const target = (await dialog.count()) ? dialog : portal;
const out = resolve(OUTPUT_DIR, "settings-storage.png");
await target.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
