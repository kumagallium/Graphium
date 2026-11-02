/**
 * マニュアル用スクリーンショット撮影（データ表ブロック + 計算列）
 *
 * 「⤓」（計算列ごと素材に書き出す）は本物のアプリのエディタが書き出しの受け口を登録して
 * 初めて出るので、Storybook では撮れない。開発サーバーのアプリにデータ表と計算ブロックを
 * 差し込み、計算の結果を ⇥ でデータ表に送って（temp_f 列）から、キャプション行〜計算ブロックを切り抜く。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> pnpm exec tsx --env-file .env src/server/index.ts   # 別ターミナル
 *   PORT=<api> pnpm exec vite --port 5189 --strictPort                                # 別ターミナル
 *   node scripts/manual-screenshots-data-table.mjs --port 5189
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *
 * 出力先: manual/public/screenshots/data-table.png
 *
 * 罠: CSV の素材は本物の保存先に作らず、ページ内で asset-text のキャッシュに先出し
 * （primeAssetText）して読ませる。ノートは開発サーバーの保存先に書かれるので DATA_DIR は隔離する
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
const BASE_URL = `http://localhost:${port}/Graphium/app/`;
const PAD = 16;

/** オーブン温度ログ（パン作り）。1 分刻みで温度が上がっていく */
function ovenLogCsv(n) {
  const lines = ["time,temp_c,humidity"];
  for (let i = 0; i < n; i++) {
    const hh = String(Math.floor(i / 60)).padStart(2, "0");
    const mm = String(i % 60).padStart(2, "0");
    const temp = Math.min(180 + 0.8 * i, 235) + 2 * Math.sin(i / 3.3);
    const humidity = Math.max(35, 55 - i * 0.05);
    lines.push(`${hh}:${mm},${temp.toFixed(1)},${humidity.toFixed(1)}`);
  }
  return lines.join("\n");
}
const ROWS = 2000;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await ctx.addInitScript(() => {
  localStorage.setItem("graphium_locale", "en");
  localStorage.setItem("graphium-zoom-hint-dismissed", "1");
});
const page = await ctx.newPage();
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
if (await welcome.count()) {
  await welcome.click();
  await page.waitForTimeout(1200);
}
// 通常の本文幅だと計算ブロックの式欄が `... * 9 / 5` で切れて、本文の `+ 32` が見えない。
// ⋯ メニューの「Full width」で本文幅を解除して、式が全部入るようにする
await page.locator("button:has(svg.lucide-ellipsis), button:has(svg.lucide-more-horizontal)").last().click();
await page.getByRole("button", { name: "Full width" }).click();
await page.waitForTimeout(600);
await page.addStyleTag({ content: ".bn-block-content::after { content: none !important; }" });

// CSV を asset-text のキャッシュに先出ししてから、データ表と計算ブロックを差し込む
await page.evaluate(async ({ csv, rows }) => {
  const mod = await import("/Graphium/src/features/data-import/asset-text.ts");
  mod.primeAssetText("manual-oven-log", csv);
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const stack = [root[key]];
  const seen = new Set();
  let editor = null;
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const props = f.memoizedProps ?? {};
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (!editor && v?._tiptapEditor && v?.schema?.blockSchema) editor = v;
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  if (!editor) throw new Error("editor not found");
  const source = JSON.stringify({
    kind: "delimited-file",
    fileName: "oven-log.csv",
    fileId: "manual-oven-log",
    importedAt: "2026-10-20T00:00:00.000Z",
    options: { headerRow: 1, delimiter: "comma", collapseConsecutive: false, endRow: rows + 1 },
  });
  const old = editor.document;
  editor.insertBlocks(
    [
      { type: "dataTable", props: { source, caption: "Oven log" } },
      { type: "calc", props: { source: 'temp_f = table["Oven log"]["temp_c"] * 9 / 5 + 32', results: "" } },
    ],
    old[0],
    "before",
  );
  const stale = old.filter((b) => b.type === "table" || b.type === "calc" || b.type === "dataTable");
  if (stale.length > 0) editor.removeBlocks(stale); // 空の配列を渡すと BlockNote は throw する
  editor.setTextCursorPosition(editor.document[editor.document.length - 1], "end");
}, { csv: ovenLogCsv(ROWS), rows: ROWS });
await page.waitForTimeout(2500);

// ⇥ → データ表を選ぶ → 列名（既定は変数名 temp_f）→ Add column
await page.evaluate(() => document.querySelector('[data-test="calc-writeback-btn"]').click());
await page.waitForTimeout(600);
const picker = page.locator('[data-test="calc-writeback-picker"]');
await picker.getByText("Oven log").first().click();
await page.waitForTimeout(600);
await picker.getByRole("button", { name: "Add column" }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => document.activeElement?.blur?.());
await page.mouse.move(5, 5);
await page.waitForTimeout(500);

const boxes = [];
for (const sel of ['.bn-block-outer:has([data-data-table-block])', '[data-content-type="calc"]']) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`見つかりません: ${sel}`);
  boxes.push(b);
}
const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - PAD);
const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - PAD);
const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
const out = resolve(OUTPUT_DIR, "data-table.png");
await page.screenshot({ path: out, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
console.log(`saved ${out}`);
await ctx.close();
await browser.close();
