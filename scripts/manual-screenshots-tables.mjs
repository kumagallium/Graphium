/**
 * マニュアル用スクリーンショット撮影（表の列の属性・保護）
 *
 * 表と計算ブロックをエディタへ直接差し込み、列の属性は tableMeta ストアで付ける。
 * 英語 UI・1280x800・deviceScaleFactor 2 で局所クリップする。
 *
 * 使い方:
 *   （隔離した DATA_DIR の API と vite を別に起動しておく）
 *   node scripts/manual-screenshots-tables.mjs --port 5194
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - ウェルカムモーダルは出るのを待ってから閉じ、閉じた後にエディタ実体を掴む
 * - 列ハンドル（.bn-table-handle）は td の上で実ポインタを hover すると出る
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
const PAD = 16;

const SHOTS = [
  {
    name: "table-column-attributes",
    caption: "Bake log",
    rows: [
      ["Batch", "Baked on", "Loaf weight"],
      ["Country loaf", "2026-10-26 07:40", "812 g"],
      ["Rye boule", "2026-10-27 08:05", "690 g"],
      ["Seeded batard", "2026-10-28 07:55", "745 g"],
    ],
    attrs: [["Batch", "note-link"], ["Baked on", "datetime-auto"]],
    menuColumn: "Batch",
  },
  {
    name: "index-table",
    caption: "Bake log",
    rows: [
      ["Batch", "Condition"],
      ["Country loaf", "75% hydration, 18 h cold proof"],
      ["Rye boule", "80% hydration, 12 h cold proof"],
      ["Seeded batard", "72% hydration, room-temperature proof"],
    ],
    attrs: [["Batch", "note-link"]],
    linkRows: true,
  },
  {
    name: "time-series-table",
    caption: "Starter feeding log",
    rows: [
      ["Date/Time", "Temperature", "Note"],
      ["2026-10-27 08:10", "24 °C", "Doubled in 5 hours"],
      ["2026-10-28 08:05", "23 °C", "Slightly sour smell"],
      ["2026-10-29 08:20", "25 °C", "Domed top, very bubbly"],
    ],
    attrs: [["Date/Time", "datetime-auto"]],
  },
  {
    name: "table-protected-columns",
    caption: "Dough",
    rows: [
      ["Ingredient", "Ratio", "Weight"],
      ["Bread flour", "100", "500"],
      ["Water", "68", ""],
      ["Salt", "2", ""],
      ["Yeast", "1", ""],
    ],
    attrs: [["Ratio", "protected"]],
    calc: 'w = cell("Dough", "Bread flour", "Weight") * col("Dough", "Ratio") / 100',
    calcTarget: { column: "Weight" },
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
await page.addStyleTag({ content: ".bn-block-content::after { content: none !important; }" });

/** 本文を差し替えて表（と計算）を作り、列の属性を付ける */
async function fillNote(shot) {
  await page.evaluate(({ shot }) => {
    const root = document.getElementById("root");
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    const stack = [root[key]];
    const seen = new Set();
    let editor = null;
    let store = null;
    while (stack.length) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      const props = f.memoizedProps ?? {};
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (!editor && v?._tiptapEditor && v?.schema?.blockSchema) editor = v;
      }
      if (!store && props.value?.addColumnType && props.value?.getSnapshot) store = props.value;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    if (!editor) throw new Error("editor not found");
    if (!store) throw new Error("tableMeta store not found");
    const cell = (t) => ({ type: "tableCell", content: t ? [{ type: "text", text: t, styles: {} }] : [], props: {} });
    const old = editor.document;
    editor.insertBlocks(
      [{ type: "table", content: { type: "tableContent", rows: shot.rows.map((r) => ({ cells: r.map(cell) })) } }],
      old[0],
      "before",
    );
    const stale = old.filter((b) => b.type === "table" || b.type === "calc");
    if (stale.length > 0) editor.removeBlocks(stale);
    const t = editor.document.find((b) => b.type === "table");
    store.setCaption(t.id, shot.caption);
    for (const [col, type] of shot.attrs) store.addColumnType(t.id, col, type);
    if (shot.calc) {
      editor.insertBlocks(
        [{
          type: "calc",
          props: {
            name: "Weights",
            source: shot.calc,
            results: "",
            targets: JSON.stringify({ w: { tableBlockId: t.id, column: shot.calcTarget.column } }),
          },
        }],
        t,
        "after",
      );
    }
    editor.setTextCursorPosition(editor.document[editor.document.length - 1], "end");
  }, { shot });
  await page.waitForTimeout(2500);
}

async function unionBox(selectors) {
  const boxes = [];
  for (const sel of selectors) {
    const box = await page.locator(sel).first().boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error(`要素が見つかりません: ${selectors.join(", ")}`);
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - PAD);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - PAD);
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

for (const shot of targets) {
  await fillNote(shot);
  const parts = ['.bn-block-outer:has([data-content-type="table"])'];
  if (shot.calc) parts.push('[data-content-type="calc"]');
  await page.evaluate(() => document.activeElement?.blur?.());
  if (shot.menuColumn) {
    // エディタにフォーカスが無いと、ホバーした瞬間に「+ Folder」の行が消えて表が上へずれる。
    // 先に最終行のセルへカーソルを置いてレイアウトを安定させる
    const rows = page.locator('[data-content-type="table"] tr');
    await rows.last().locator("td, th").last().click();
    await page.waitForTimeout(500);
    const idx = shot.rows[0].indexOf(shot.menuColumn);
    const td = rows.first().locator("td, th").nth(idx);
    const box = await td.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.waitForTimeout(500);
    // 行ハンドル（左）と列ハンドル（上）が同じクラスで出る。列ハンドルは 2 番目
    await page.locator(".bn-table-handle").nth(1).click();
    await page.getByText("Column attributes", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    // メニューは専用クラスを持たないので、「列の属性」見出しの祖先でメニュー全体を持つ要素に印を付ける
    await page.getByText("Column attributes", { exact: true }).evaluate((h) => {
      let n = h;
      while (n.parentElement && !(n.textContent.includes("Delete column") && n.textContent.includes("Protect"))) n = n.parentElement;
      n.setAttribute("data-shot-menu", "1");
    });
    parts.push("[data-shot-menu]");
  }
  if (!shot.menuColumn) {
    await page.mouse.move(1100, 700);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    // 行・列ハンドルの名残を消す（メニューの撮影では本物のハンドルを見せる）
    await page.addStyleTag({ content: ".bn-table-handle{display:none !important}" });
  }
  const clip = await unionBox(parts);
  // ノートへのリンクの列は、行の左に「ノートを作る」アイコンが出る。その分だけ左を広げる
  if (shot.attrs.some(([, t]) => t === "note-link")) {
    const ext = Math.min(clip.x, 110);
    clip.x -= ext;
    clip.width += ext;
  }
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`  ✓ ${shot.name}.png`);
  if (shot.menuColumn) await page.keyboard.press("Escape");
}

await ctx.close();
await browser.close();
console.log(`出力先: ${OUTPUT_DIR}`);
