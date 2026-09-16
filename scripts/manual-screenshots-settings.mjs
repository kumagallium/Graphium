/**
 * マニュアル用スクリーンショット撮影（設定モーダルのタブ）
 *
 * 設定画面は実アプリでしか撮れない（Storybook だとモーダルの背後が
 * 灰色一色になり、他のスクショと様式が揃わない）。開発サーバーを
 * 隔離データで起動しておき、このスクリプトが英語 UI で開いて撮る。
 *
 * 使い方:
 *   PORT=<api> node_modules/.bin/vite --port 5189 --strictPort   # 別ターミナル
 *   node scripts/manual-screenshots-settings.mjs --port 5189
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）を先に閉じないと、オーバーレイが
 *   すべてのクリックを横取りして設定ボタンにも届かない
 * - Service Worker を block しないと PWA の自動リロードが click と競合する
 * - タブのボタンはモーダルの外にも同名の要素がありうるので
 *   [data-modal-portal="true"] にスコープする
 * - AI タブはモデルが 1 つも無いと機能セクションを出さない（それが仕様）。
 *   マニュアルは登録済みの状態を説明しているので localStorage に 1 件 seed する
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
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 5189;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

const BASE_URL = `http://localhost:${port}/Graphium/app/`;
const VIEWPORT = { width: 1280, height: 800 };

/** AI タブ用の表示専用モデル。API キーはダミーで、推論は一切走らせない */
const SAMPLE_MODELS = [
  { id: "m1", name: "Claude Sonnet 5", provider: "anthropic", modelId: "claude-sonnet-5", apiKey: "dummy", apiBase: null },
];

const SHOTS = [
  { tab: "Display & Language", name: "settings-display-tab" },
  { tab: "Storage", name: "settings-storage" },
  // AI は既定の高さだと一番下の「Advanced」が切れる
  { tab: "AI", name: "settings-ai-tab", viewport: { width: 1280, height: 900 } },
];

const targets = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
if (targets.length === 0) {
  console.error(`--only ${only} に一致するスクショがありません`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});

// 言語とモデルは初回描画より先に置く（設定モーダルは開いた瞬間に読む）
await ctx.addInitScript(
  ([models]) => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-llm-models", JSON.stringify(models));
    // 折りたたみは既定（畳んだ状態）で撮る。前回の撮影が残した開閉を持ち越さない
    Object.keys(localStorage)
      .filter((k) => k.startsWith("graphium-settings-group:"))
      .forEach((k) => localStorage.removeItem(k));
  },
  [SAMPLE_MODELS],
);

/**
 * ボタンをテキストで探して押す。
 *
 * getByRole("button", { name }) は使わない — サイドバーの設定ボタンは
 * アクセシビリティツリー側で拾えず（lucide のアイコンとステータス点を含む
 * 組み方のため）空振りする。DOM の click() でも React の合成イベントは発火する。
 */
async function clickByText(page, text, scopeSelector = null) {
  const ok = await page.evaluate(
    ([t, s]) => {
      const root = s ? document.querySelector(s) : document;
      if (!root) return false;
      const btn = Array.from(root.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === t,
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    [text, scopeSelector],
  );
  if (!ok) throw new Error(`ボタンが見つかりません: ${text}`);
}

const page = await ctx.newPage();
console.log(`dev server: ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

// ウェルカムモーダルのオーバーレイは全クリックを横取りするうえ、背後の
// サイドバーごとアクセシビリティツリーから外すので、出るのを待って先に閉じる
// （出る前に読みに行くと「設定ボタンが無い」ように見えて空振りする）
const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
if (await welcome.count()) {
  await welcome.click();
  await page.waitForTimeout(1200);
}

await clickByText(page, "Settings");
await page.waitForTimeout(1500);

for (const shot of targets) {
  await page.setViewportSize(shot.viewport ?? VIEWPORT);
  await clickByText(page, shot.tab, '[data-modal-portal="true"]');
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: out });
  console.log(`  ✓ ${shot.name}.png  (${shot.tab})`);
}

await ctx.close();
await browser.close();
console.log(`出力先: ${OUTPUT_DIR}`);
