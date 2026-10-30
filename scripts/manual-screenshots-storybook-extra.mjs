/**
 * マニュアル用スクリーンショット撮影（Storybook の小さな部品 4 枚）
 *
 * 実アプリでは撮りにくい（デスクトップ専用・AI や外部アプリの状態が要る）部品を、
 * Storybook の英語・パン作り世界観のストーリーから局所クリップで撮る。AI は呼ばない。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-storybook-extra.mjs --port 6013            # 全部
 *   node scripts/manual-screenshots-storybook-extra.mjs --port 6013 --only update-banner   # 1 枚だけ
 *
 * 出力先: manual/public/screenshots/
 *   material-source-info.png       素材の Source ブロック（AssetBrowser/MaterialMetadataSection）
 *   material-opened-copy-notice.png  外のアプリで編集された素材の知らせ（AssetBrowser/OpenedCopyNotice）
 *   update-banner.png              更新バナー（Components/UpdateBanner）
 *   mobile-inbox.png               デスクトップの受信画面（Mobile Capture / InboxView）
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) !== -1 ? args[args.indexOf(k) + 1] : d);
const port = parseInt(val("--port", "6006"), 10);
const only = val("--only", null);
const want = (n) => !only || only === n;
const SB = `http://localhost:${port}/iframe.html`;
const PAD = 16;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();

async function open(id) {
  await page.goto(`${SB}?id=${id}&viewMode=story`);
  await page.waitForTimeout(1500);
}
const pad = (b, p = PAD) => ({ x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: b.width + p * 2, height: b.height + p * 2 });
const out = (n) => resolve(OUTPUT_DIR, n);

if (want("material-source-info")) {
  await open("assetbrowser-materialmetadatasection--manual-english");
  const card = page.locator("#storybook-root > div").first();
  await card.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await card.screenshot({ path: out("material-source-info.png") });
  console.log("saved material-source-info.png");
}

if (want("material-opened-copy-notice")) {
  await open("assetbrowser-openedcopynotice--default");
  const notice = page.locator("div.fixed.bottom-4.right-4").first();
  await notice.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out("material-opened-copy-notice.png"), clip: pad(await notice.boundingBox(), 24) });
  console.log("saved material-opened-copy-notice.png");
}

if (want("update-banner")) {
  await open("components-updatebanner--manual-english");
  const banner = page.getByText("Restart to update").first();
  await banner.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  // 帯の最上位の要素（全幅）を探す
  const box = await banner.evaluate((el) => {
    let n = el;
    while (n.parentElement && n.parentElement.id !== "storybook-root" && n.parentElement.tagName !== "BODY") n = n.parentElement;
    const r = n.getBoundingClientRect();
    // 全幅だと文言とボタンが中央の一部にしかなく、本文幅に縮めると読めない。
    // 帯の高さはそのまま、文言から最後のボタンまでの左右だけを切る
    let left = Infinity, right = -Infinity;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (!t.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(t);
      const b = rg.getBoundingClientRect();
      left = Math.min(left, b.left); right = Math.max(right, b.right);
    }
    n.querySelectorAll("button").forEach((bt) => { const b = bt.getBoundingClientRect(); left = Math.min(left, b.left); right = Math.max(right, b.right); });
    return { y: r.y, height: r.height, left, right };
  });
  const BP = 24;
  await page.screenshot({ path: out("update-banner.png"), clip: { x: Math.max(0, box.left - BP), y: box.y, width: box.right - box.left + BP * 2, height: box.height } });
  console.log("saved update-banner.png");
}

if (want("mobile-inbox")) {
  await open("mobile-capture-inboxview--manual-english");
  const root = page.locator("#storybook-root > div").first();
  await root.waitFor({ state: "visible" });
  await page.getByText("Import all").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  // 行の下の空白は切る（ヘッダー + 4 行ぶん）
  const rb = await root.boundingBox();
  await page.screenshot({ path: out("mobile-inbox.png"), clip: { x: rb.x, y: rb.y, width: rb.width, height: 340 } });
  console.log("saved mobile-inbox.png");
}

await browser.close();
