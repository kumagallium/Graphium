/**
 * マニュアル用スクリーンショット撮影（設定ダイアログ・デスクトップ版の Storage > スマホから送る / About）
 *
 * Tauri 前提のタブなので、Storybook の StorageDesktop ストーリー（invoke を偽装）で撮る。
 * - mobile-upload-settings: Storage タブで「Share with other people」を開き、「Send from your phone」（QR）を上端に寄せる
 * - settings-about-updates: About タブ。版の表示はストーリーの invoke が null を返すと「–」になるので、
 *   src を触らず、ストーリーのモジュールを取得時に書き換えて版（plugin:app|version）を答えさせる
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-settings-desktop.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *   --version <v>   About に出す版（既定は package.json の version）
 *
 *   --only <name>  出力名（拡張子なし）を指定して 1 枚だけ撮る
 *                  mobile-upload-settings / settings-about-updates / settings-usage-tab / settings-knowledge-tab
 *
 * - settings-usage-tab: Usage タブ（ストーリーの API スタブのダミー記録）で Month を選んだ状態
 * - settings-knowledge-tab: Knowledge タブ。カードが全部入るよう、撮る間だけモーダルの高さを広げる（1280x1230）。
 *   ジョブは実行しない（ストーリーのハンドラは何も呼ばない）
 *
 * 出力先: manual/public/screenshots/mobile-upload-settings.png / settings-about-updates.png / settings-usage-tab.png（1280x800 @2x の全体）/ settings-knowledge-tab.png
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 6006;
const verIdx = args.indexOf("--version");
const version =
  verIdx !== -1
    ? args[verIdx + 1]
    : JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")).version;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
const want = (n) => !only || only === n;
const URL = `http://localhost:${port}/iframe.html?id=organisms-settingsmodal--storage-desktop&viewMode=story`;

const browser = await chromium.launch({ headless: true });

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.route("**/settings/modal.stories.tsx*", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      'if (cmd === "get_graphium_root")',
      `if (cmd === "plugin:app|version") return ${JSON.stringify(version)}; if (cmd === "get_graphium_root")`,
    );
    await route.fulfill({ response: res, body });
  });
  await page.goto(URL);
  const portal = page.locator('[data-modal-portal="true"]').first();
  await portal.waitFor({ state: "visible" });
  await page.getByText("Where your notes are saved").waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  return { ctx, page, portal };
}

// 1) スマホから送る
if (want("mobile-upload-settings")) {
  const { ctx, page } = await open();
  await page.getByText("Share with other people").first().click();
  await page.waitForTimeout(500);
  await page.getByText("Send from your phone").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  const out = resolve(OUTPUT_DIR, "mobile-upload-settings.png");
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}

// 2) About
if (want("settings-about-updates")) {
  const { ctx, page, portal } = await open();
  await portal.getByRole("button", { name: "About" }).click();
  await page.getByText("Check for updates", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
  const out = resolve(OUTPUT_DIR, "settings-about-updates.png");
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}

// 3) Usage（Month を選んだ状態）
if (want("settings-usage-tab")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  // 月の棒グラフは「今日の日付から月数ぶん遡る」ので、月末だと 2 月などで月がずれてラベルが重複する。
  // 月の中ほどに時計を固定する。さらに月次サマリを直近 11 か月ぶんに伸ばして、空の月が並ばないようにする
  await page.clock.install({ time: new Date("2026-10-15T12:00:00Z") });
  await page.route("**/settings/modal.stories.tsx*", async (route) => {
    const res = await route.fetch();
    // 古い月は少しずつ増え、月ごとに揺らす（同じ高さの棒が並ばないように）。atomize にも費用を足して「—」を出さない
    const body = (await res.text())
      .replace("[4, 5, 6].map(monthsAgo => {", "[4, 5, 6, 7, 8, 9, 10, 11].map((monthsAgo) => { const k = (0.25 + (0.75 * (11 - monthsAgo)) / 7) * (1 + (((monthsAgo * 5) % 7) - 3) / 10);")
      .replace("callCount: 120", "callCount: Math.round(120 * k)")
      .replace("inputTokens: 9e5", "inputTokens: Math.round(9e5 * k)")
      .replace("outputTokens: 22e4", "outputTokens: Math.round(22e4 * k)")
      .replace("totalTokens: 112e4", "totalTokens: Math.round(112e4 * k)")
      .replace(/usd: 6\n/, "usd: 6 * k\n")
      .replace(/tokens: 26e3\n/, "tokens: 26e3, cost: 0.04\n");
    await route.fulfill({ response: res, body });
  });
  await page.goto(`http://localhost:${port}/iframe.html?id=organisms-settingsmodal--usage&viewMode=story`);
  const portal = page.locator('[data-modal-portal="true"]').first();
  await portal.getByText("Tokens over time").waitFor({ state: "visible", timeout: 30000 });
  await portal.getByRole("button", { name: "Month", exact: true }).click();
  await page.waitForTimeout(1500);
  const out = resolve(OUTPUT_DIR, "settings-usage-tab.png");
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}

// 4) Knowledge（英語・パン作りの Manual ストーリー。全カードが入る高さに広げる）
if (want("settings-knowledge-tab")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1230 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/iframe.html?id=organisms-settingsmodal--manual-english-knowledge&viewMode=story`);
  await page.getByText("Connection Status").waitFor({ state: "visible", timeout: 30000 });
  // モーダルは 48rem で頭打ちなので、撮る間だけ画面いっぱいまで広げる
  await page.addStyleTag({ content: "[data-modal-portal] .relative.rounded-xl{height:calc(100dvh - 2rem)!important;max-height:none!important}" });
  await page.waitForTimeout(1500);
  const out = resolve(OUTPUT_DIR, "settings-knowledge-tab.png");
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}
await browser.close();
