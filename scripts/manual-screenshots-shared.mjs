/**
 * マニュアル用スクリーンショット撮影（共有ライブラリ / 共有ノートの全画面）
 *
 * 共有ライブラリはデスクトップ（Tauri）専用のビューで、本物のアプリでは
 * 共有フォルダを用意しないと撮れない。そこで Storybook の英語・パン作り世界観の
 * ストーリー（Manual (English, bread world) …）を Playwright で開いて撮る。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-shared.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - iframe.html は autodocs の args table（.sb-argstableBlock）を同じ DOM に
 *   持つことがあるので、表の位置は #storybook-root の中から探す
 * - ストーリーは localStorage（「最後に見た」控え・投影キャッシュ）を書くので、
 *   1 枚ごとに新しいブラウザコンテキストを作って持ち越さない
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
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

const SB = `http://localhost:${port}/iframe.html`;

/**
 * clip の種類:
 *   "table" — パンくずの上端から表の下端 + 余白まで（既存の shared-library.png と同じ切り方）
 *   "view"  — ビュー全体（ビューポートそのまま）。全画面表示・ギャラリー系はこちら
 */
const SHOTS = [
  {
    id: "sharing-sharedlibraryview--manual-english-labels",
    name: "shared-library-labels",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-process",
    name: "shared-library-process",
    clip: "view",
    // 手順フローの自動レイアウト（ELK）は Storybook では初回の実測待ちを取りこぼして
    // ノードが (0,0) に重なったままになる。実アプリと同じ並びを撮るために整列を 1 回押す
    click: "Tidy up",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-templates",
    name: "shared-library-templates",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-update-marks",
    name: "shared-library-update-marks",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-detail-comments",
    name: "shared-library-detail-comments",
    clip: "view",
    // コメントはパネル下部に固定されるので、既定の高さだとプレビューが 1 行しか
    // 見えない。本文とコメントの両方が入る高さで撮る
    viewport: { width: 1280, height: 1160 },
  },
  {
    id: "sharing-sharednoteview--manual-english",
    name: "shared-note-full-view",
    clip: "view",
    // 本文もコメントのレールも短いので、既定の高さだと下半分が余白になる
    viewport: { width: 1280, height: 620 },
  },
];

const VIEWPORT = { width: 1280, height: 800 };
/** 表の下端に付ける余白（CSS px） */
const CLIP_PADDING = 16;

const browser = await chromium.launch({ headless: true });

/** 表の下端までの clip を測る。表が見つからなければ null（ビュー全体にフォールバック） */
async function measureTableClip(page) {
  return await page.evaluate((padding) => {
    const root = document.querySelector("#storybook-root") ?? document.body;
    const table = root.querySelector("table");
    if (!table) return null;
    const rect = table.getBoundingClientRect();
    const bottom = Math.min(
      Math.ceil(rect.bottom + padding),
      document.documentElement.clientHeight,
    );
    return {
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: Math.max(bottom, 1),
    };
  }, CLIP_PADDING);
}

const targets = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
if (targets.length === 0) {
  console.error(`--only ${only} に一致するスクショがありません`);
  process.exit(1);
}

console.log(`Storybook: ${SB}`);
for (const shot of targets) {
  // ストーリーが書く localStorage を次のストーリーへ持ち越さないよう、毎回作り直す
  const viewport = shot.viewport ?? VIEWPORT;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`${SB}?id=${shot.id}&viewMode=story`, {
    waitUntil: "load",
    timeout: 30000,
  });
  // ストーリーが描かれるまで待つ（loadEntries は Promise なので描画は 1 tick 遅れる）
  await page.waitForSelector("#storybook-root *", { timeout: 15000 });
  await page.waitForTimeout(2500);

  if (shot.click) {
    await page.getByRole("button", { name: shot.click }).first().click();
    await page.waitForTimeout(1500);
  }

  const clip = shot.clip === "table" ? await measureTableClip(page) : null;
  const path = `${OUTPUT_DIR}/${shot.name}.png`;
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  const size = clip ? `${clip.width}x${clip.height}` : `${viewport.width}x${viewport.height}`;
  console.log(`  OK ${shot.name}.png (${size} @2x)${clip ? "" : " — view"}`);

  await page.close();
  await ctx.close();
}

await browser.close();
console.log(`\nDone! ${targets.length} 枚を manual/public/screenshots/ に保存しました`);
