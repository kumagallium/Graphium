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
 * 出力先: manual/public/screenshots/mobile-upload-settings.png / settings-about-updates.png（1280x800 @2x の全体）
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
{
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
{
  const { ctx, page, portal } = await open();
  await portal.getByRole("button", { name: "About" }).click();
  await page.getByText("Check for updates", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
  const out = resolve(OUTPUT_DIR, "settings-about-updates.png");
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  await ctx.close();
}
await browser.close();
