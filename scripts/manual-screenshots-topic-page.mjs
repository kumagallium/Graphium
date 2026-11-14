/**
 * マニュアル用スクリーンショット撮影（トピックのページ）
 *
 * 見本モード（?demo=bread-en / ?demo=curry-ja）を開き、ナレッジ → トピック の一覧から
 * 1 件を開いて撮る。見本は専用の置き場に入るので、API サーバーも AI も要らない。
 *
 * 使い方:
 *   node scripts/manual-screenshots-topic-page.mjs                 # 公開中のアプリで 2 枚とも撮る
 *   node scripts/manual-screenshots-topic-page.mjs --base http://127.0.0.1:5969/Graphium/app/
 *   node scripts/manual-screenshots-topic-page.mjs --only topic-page_ja --out <dir>
 *
 * オプション:
 *   --base <url>   アプリの URL（既定は公開中のアプリ）
 *   --only <name>  出力名（拡張子なし）を指定して 1 枚だけ撮る
 *   --out <dir>    出力先（既定は manual/public/screenshots/）
 *
 * 罠:
 * - Service Worker を block しないと PWA の自動リロードが click と競合する
 * - 右下の案内カードは本文にかぶるので、閉じてから撮る
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i !== -1 ? args[i + 1] : d;
};
const BASE_URL = opt("--base", "https://kumagallium.github.io/Graphium/app/");
const only = opt("--only", null);
const OUTPUT_DIR = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
mkdirSync(OUTPUT_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };

const SHOTS = [
  {
    name: "topic-page",
    demo: "bread-en",
    locale: "en",
    browserLocale: "en-US",
    knowledgeTab: "Knowledge",
    topics: /^Topics/,
    title: "Sourdough bread hydration",
    closeTour: "Close the walkthrough",
  },
  {
    name: "topic-page_ja",
    demo: "curry-ja",
    locale: "ja",
    browserLocale: "ja-JP",
    knowledgeTab: "ナレッジ",
    topics: /^トピック/,
    title: "差し水",
    closeTour: "案内を閉じる",
  },
];

const browser = await chromium.launch({ headless: true });

for (const shot of SHOTS) {
  if (only && only !== shot.name) continue;
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: shot.browserLocale,
    serviceWorkers: "block",
  });
  await ctx.addInitScript((locale) => {
    localStorage.setItem("graphium_locale", locale);
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
  }, shot.locale);
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}?demo=${shot.demo}`, { waitUntil: "networkidle" });

  // 右下の案内カードを先に閉じる（開いたページにかぶり、あとからは押せないため）
  const closeTour = page.getByRole("button", { name: shot.closeTour, exact: true });
  await closeTour.first().waitFor({ state: "visible" });
  await closeTour.first().click();

  // 左ナビの「ナレッジ」タブ → 「トピック」の行
  await page.getByRole("tab", { name: shot.knowledgeTab, exact: true }).first().click();
  await page.locator("button", { hasText: shot.topics }).first().click();

  // 一覧の行は先頭がアイコンなので、題の文字を押す
  await page.getByText(shot.title, { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.mouse.move(640, 790);
  await page.waitForTimeout(600);

  const file = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log("saved", file);
  await ctx.close();
}

await browser.close();
