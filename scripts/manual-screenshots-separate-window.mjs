/**
 * マニュアル用スクリーンショット撮影（別ウィンドウで開く）
 *
 * 見本データ（?demo=bread-en）で、メインのウィンドウと別ウィンドウを同じブラウザに開き、
 * 別ウィンドウ（編集できる状態・ステップのパネルを開いた状態）を 1 枚撮る。
 *   → manual/public/screenshots/separate-window.png
 *
 * 別ウィンドウは、メインのウィンドウから「開いているノートの一覧」が届くまで表示のみになる。
 * そのため、メインのページを先に開いておく（メインは別のノートを開いている）。
 *
 * 使い方:
 *   PORT=<API> pnpm exec tsx --env-file .env src/server/index.ts          # 別ターミナル（DATA_DIR は隔離）
 *   PORT=<API> pnpm exec vite --port <dev> --strictPort                   # 別ターミナル
 *   node scripts/manual-screenshots-separate-window.mjs --port <dev>
 *
 * オプション:
 *   --port <port>   dev サーバーのポート（既定 5174）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 */
import { chromium } from "playwright";
import path from "path";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const port = Number(opt("--port")) || 5174;
const OUT_DIR = path.resolve(opt("--out") ?? path.join(import.meta.dirname, "../manual/public/screenshots"));

// 見本データのノート（public/demo/bread-en.json）
const MAIN_NOTE = "60b67452-d66d-421a-b221-0d0f9c739aad"; // Trial plan and log（メインが開いておく）
const VIEWER_NOTE = "65abd8cf-abb4-499e-885d-369bfdba7f9b"; // Trial 3（手順のあるノート）

const base = `http://localhost:${port}/Graphium/app/`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1180, height: 720 },
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium:viewer-window:panel-tab", "prov");
  } catch {
    // 保存できなくても撮影は続ける
  }
});

// メイン: 見本データを読み込み、別のノートを開いておく
const main = await context.newPage();
await main.goto(`${base}?demo=bread-en#note/${MAIN_NOTE}`, { waitUntil: "load" });
await main.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 120000 });
await main.waitForTimeout(1500);

// 別ウィンドウ
const viewer = await context.newPage();
await viewer.goto(`${base}?demo=bread-en&viewer=note&id=${VIEWER_NOTE}`, { waitUntil: "load" });
await viewer.locator('[data-viewer-mode="edit"]').waitFor({ state: "visible", timeout: 60000 });
await viewer.locator(".bn-editor").first().waitFor({ state: "visible" });

// ステップのパネル（覚えた開閉が効かなかったときは押して開く）
const panel = viewer.locator("[data-standalone-panel]");
if ((await panel.count()) === 0) {
  await viewer.locator('[data-standalone-panel-toggle="prov"]').click();
}
await panel.waitFor({ state: "visible" });
await viewer.locator("[data-standalone-panel] .react-flow__node").first().waitFor({ state: "visible", timeout: 30000 });
// グラフの自動配置と fitView が落ち着くのを待つ
await viewer.waitForTimeout(2000);
// マウスを余白へ逃がす（ツールチップやブロックのハンドルを出さない）
await viewer.mouse.move(5, 715);
await viewer.waitForTimeout(300);
// ブロックの ⠿ ハンドルはマウスを外しても残ることがあるので、撮る間だけ隠す
await viewer.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });

const out = path.join(OUT_DIR, "separate-window.png");
await viewer.screenshot({ path: out });
console.log(`saved: ${out}`);

await browser.close();
