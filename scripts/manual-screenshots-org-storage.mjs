/**
 * マニュアル用スクリーンショット撮影（組織の置き場に合わせる機能の 4 枚）
 *
 * - note-menu-word          ノートのメニューの Word (.docx)（実アプリの見本モード ?demo=bread-en）
 * - readable-copies-setting 共有フォルダの詳細にある「読める写しも置く」のスイッチ（Storybook）
 * - linked-file-details     リンクした素材の詳細（Storybook。デスクトップ版だけの機能）
 * - settings-data-places    設定 → ストレージ → データの置き場（Storybook。デスクトップ版だけの機能）
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open --exact-port   # 別ターミナルで起動
 *   pnpm exec vite build
 *   PORT=<使っていない API ポート> pnpm exec vite preview --port 5981 --strictPort
 *   node scripts/manual-screenshots-org-storage.mjs --sb 6013 --app 5981
 *   node scripts/manual-screenshots-org-storage.mjs --sb 6013 --only linked-file-details
 *
 * 見本モードはブラウザ内の専用 IndexedDB だけを使い、API には繋がない。
 *
 * 出力先: manual/public/screenshots/<名前>.png（--out で変更可）
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) !== -1 ? args[args.indexOf(k) + 1] : d);
const sbPort = parseInt(val("--sb", "6013"), 10);
const appPort = parseInt(val("--app", "5981"), 10);
const only = val("--only", null);
const OUTPUT_DIR = resolve(val("--out", resolve(__dirname, "../manual/public/screenshots")));
mkdirSync(OUTPUT_DIR, { recursive: true });
const want = (n) => !only || only === n;
const out = (n) => resolve(OUTPUT_DIR, `${n}.png`);
const PAD = 12;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();

async function openStory(id) {
  await page.goto(`http://localhost:${sbPort}/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(1500);
}

/** ストーリーの枠（decorator の外側の div）を余白ごと切り抜く */
async function shootRoot(name) {
  const root = page.locator("#storybook-root > div").first();
  await root.screenshot({ path: out(name) });
  console.log(`saved ${name}.png`);
}

// ------------------------------------------------------------------ Word (.docx)
if (want("note-menu-word")) {
  await page.goto(`http://localhost:${appPort}/Graphium/?demo=bread-en`);
  const open = page.getByRole("button", { name: "Open Graphium" });
  await open.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  if (await open.count()) await open.click();
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="Menu"]').first().click();
  const item = page.getByRole("button", { name: "Word (.docx)" });
  await item.waitFor({ state: "visible" });
  await item.hover();
  await page.waitForTimeout(300);
  // ツールチップは図に入れない（項目の位置が分かれば足りる）
  await page.addStyleTag({ content: "[role=tooltip],.graphium-tooltip{display:none!important}" });
  const panel = item.locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  // 余白を付けるとメニューの背後のノートが写るので、メニューの枠ぴったりで切り抜く
  await panel.screenshot({ path: out("note-menu-word") });
  console.log("saved note-menu-word.png");
}

// ------------------------------------------------------------------ 読める写しのスイッチ
if (want("readable-copies-setting")) {
  await openStory("molecules-sharedfolderssection--readable-copies-on");
  await page.getByText("Whole bakery").first().click();
  await page.getByText("Also keep readable copies").first().waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await page.mouse.move(1200, 780);
  await page.waitForTimeout(300);
  await shootRoot("readable-copies-setting");
}

// ------------------------------------------------------------------ リンクした素材の詳細
if (want("linked-file-details")) {
  await openStory("assetbrowser-linkedfileview--changed");
  await page.getByText("Record the current state").first().waitFor({ state: "visible" });
  // ストーリーの枠は画面幅いっぱいなので、カードの周りだけを切り抜く
  const b = await page.locator("#storybook-root > div > *").first().boundingBox();
  await page.screenshot({
    path: out("linked-file-details"),
    clip: { x: b.x - PAD, y: b.y - PAD, width: b.width + PAD * 2, height: b.height + PAD * 2 },
  });
  console.log("saved linked-file-details.png");
}

// ------------------------------------------------------------------ データの置き場
if (want("settings-data-places")) {
  // 届く置き場と届かない置き場の 2 行。届かない行を開いて、場所と案内まで見せる
  await openStory("molecules-dataplacessection--one-unreachable");
  await page.getByText("Sourdough team").first().click();
  await page.waitForTimeout(600);
  await page.mouse.move(1200, 780);
  await page.waitForTimeout(300);
  await shootRoot("settings-data-places");
}

await browser.close();
