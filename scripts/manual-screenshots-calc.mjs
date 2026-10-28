/**
 * マニュアル用スクリーンショット撮影（計算ブロック）
 *
 * 表と計算ブロックをエディタへ直接差し込み、英語 UI で局所クリップする。
 * スラッシュメニューからの挿入は合成キー入力では開かないので、React fiber から
 * BlockNote のエディタ実体を掴んで insertBlocks する。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> pnpm exec tsx --env-file .env src/server/index.ts   # 別ターミナル
 *   PORT=<api> pnpm exec vite --port 5189 --strictPort                                # 別ターミナル
 *   node scripts/manual-screenshots-calc.mjs --port 5189
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）を閉じるとエディタが作り直される。
 *   エディタ実体は閉じた後に掴む（前に掴むと、画面に出ていない古い実体へ書く）
 * - 計算ブロックの textarea は props を書き換えても追従しない（内部に値を持つ）。
 *   式を変えるときはブロックごと入れ直す
 * - ? をマウスで押すとブロックが選択状態（青枠）になる。DOM の click で開く
 * - ノートは開発サーバーの保存先に書かれる。DATA_DIR は必ず隔離する
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
/** 切り抜きの外側に残す余白（CSS px） */
const PAD = 16;

/** パン生地の配合表。1 列目が行の名前になる */
const DOUGH_TABLE = [
  ["Ingredient", "Weight"],
  ["Flour", "500 g"],
  ["Water", "340 g"],
  ["Salt", "10 g"],
  ["Yeast", "5 g"],
];

const SHOTS = [
  {
    name: "calc-cell",
    table: { caption: "Dough", rows: DOUGH_TABLE },
    source: [
      "# Hydration and salt, from the dough table",
      'water = cell("Dough", "Water", "Weight")',
      'flour = cell("Dough", "Flour", "Weight")',
      "water / flour * 100",
      'cell("Dough", "Salt", "Weight") / flour * 100',
    ].join("\n"),
  },
  {
    name: "calc-function-list",
    source: [
      "# Dough for two loaves",
      "flour = 500 g",
      "water = flour * 0.68",
      "salt = flour * 0.02",
      "hydration = round(water / flour * 100)",
    ].join("\n"),
    openHelp: true,
  },
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
await ctx.addInitScript(() => {
  localStorage.setItem("graphium_locale", "en");
  // 画面の大きさで出るズームの案内（右下）を写り込ませない
  localStorage.setItem("graphium-zoom-hint-dismissed", "1");
});

const page = await ctx.newPage();
console.log(`dev server: ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
if (await welcome.count()) {
  await welcome.click();
  await page.waitForTimeout(1200);
}
// 空の段落の案内（"Enter text or type '/'…"）は撮影の邪魔なので消す
await page.addStyleTag({ content: ".bn-block-content::after { content: none !important; }" });

/** 本文を差し替える。表があればキャプションも付ける（cell() は表を名前で読むため） */
async function fillNote(shot) {
  await page.evaluate(({ table, source }) => {
    const root = document.getElementById("root");
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    const stack = [root[key]];
    const seen = new Set();
    let editor = null;
    let tableStore = null;
    while (stack.length) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      const props = f.memoizedProps ?? {};
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (!editor && v?._tiptapEditor && v?.schema?.blockSchema) editor = v;
      }
      // tableMeta ストアの Provider（value に setCaption と setTableColumns を持つ）
      if (!tableStore && props.value?.setCaption && props.value?.setTableColumns) tableStore = props.value;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    if (!editor) throw new Error("editor not found");
    const cell = (t) => ({ type: "tableCell", content: t ? [{ type: "text", text: t, styles: {} }] : [], props: {} });
    const blocks = [];
    if (table) {
      blocks.push({
        type: "table",
        content: { type: "tableContent", rows: table.rows.map((r) => ({ cells: r.map(cell) })) },
      });
    }
    blocks.push({ type: "calc", props: { source, results: "" } });
    const old = editor.document;
    editor.insertBlocks(blocks, old[0], "before");
    // 前のショットの表・計算を消す（空の配列を渡すと BlockNote は throw する）
    const stale = old.filter((b) => b.type === "table" || b.type === "calc");
    if (stale.length > 0) editor.removeBlocks(stale);
    if (table && tableStore) {
      const t = editor.document.find((b) => b.type === "table");
      tableStore.setCaption(t.id, table.caption);
    }
    // 差し込んだ直後は計算ブロックが選択状態（外側の枠）になる。カーソルを末尾の段落へ逃がす
    editor.setTextCursorPosition(editor.document[editor.document.length - 1], "end");
  }, { table: shot.table ?? null, source: shot.source });
  // 評価（200ms の遅延 + mathjs の初回読み込み）と表の配布を待つ
  await page.waitForTimeout(2000);
}

/** いくつかの要素を囲む矩形（CSS px）に余白を付ける */
async function unionBox(selectors) {
  const boxes = [];
  for (const sel of selectors) {
    const box = await page.locator(sel).first().boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error(`要素が見つかりません: ${selectors.join(", ")}`);
  const x0 = Math.min(...boxes.map((b) => b.x)) - PAD;
  const y0 = Math.min(...boxes.map((b) => b.y)) - PAD;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
  return { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - Math.max(0, x0), height: y1 - Math.max(0, y0) };
}

for (const shot of targets) {
  await fillNote(shot);
  const parts = ['[data-content-type="calc"]'];
  if (shot.table) {
    // キャプション（表の名前）まで入れる。表ブロックの外側の要素に付いているので外側ごと取る
    parts.unshift('.bn-block-outer:has([data-content-type="table"])');
  }
  // カーソルが空の段落に残ると "Enter text or type '/'…" が写り込むので外す
  await page.evaluate(() => (document.activeElement)?.blur?.());
  if (shot.openHelp) {
    // マウスで押すとブロックが選択状態（青枠）になり、左にハンドルも出る。DOM の click で開く
    await page.evaluate(() => document.querySelector('[data-test="calc-help-btn"]').click());
    await page.waitForTimeout(600);
    parts.push('[data-test="calc-help"]');
  }
  // 計算の行が全部評価済みか（? が残っていたら式か表の受け渡しがおかしい）
  const results = await page.locator('[data-content-type="calc"]').innerText();
  if (/^\?$/m.test(results)) throw new Error(`${shot.name}: 評価できない行がある\n${results}`);
  const clip = await unionBox(parts);
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`  ✓ ${shot.name}.png`);
  if (shot.openHelp) {
    await page.evaluate(() => document.querySelector('[data-test="calc-help-btn"]').click());
    await page.waitForTimeout(300);
  }
}

await ctx.close();
await browser.close();
console.log(`出力先: ${OUTPUT_DIR}`);
