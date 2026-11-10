/**
 * マニュアル用スクリーンショット撮影（データ・素材まわりの 6 枚）
 *
 *   calc-polyfit            計算ブロック（polyfit / polyval）        … アプリ
 *   data-import-insert-as   取り込み画面（Insert as: Data table）      … アプリ（CSV をエディタへドロップ）
 *   pdf-find                素材の PDF 内検索（サイドピーク）          … アプリ（PDF を素材へ入れて開く）
 *   chart-settings          チャート設定パネル（系列を元ごとに）       … Storybook
 *   chart-data-picker       チャート用データピッカー                  … Storybook
 *   office-preview          Excel 素材のサイドピーク                  … Storybook
 *
 * 使い方（アプリ側の図は、ビルド済みアプリ + API を隔離 DATA_DIR で起動しておく）:
 *   node scripts/manual-screenshots-data-extra.mjs --port 5973 --api 3973 --data <DATA_DIR> --sb 6041
 *   node scripts/manual-screenshots-data-extra.mjs --only pdf-find --port 5973 --data <DATA_DIR>
 *
 * オプション:
 *   --only <name>   1 枚だけ撮る
 *   --port <port>   アプリ（vite）のポート（既定 5189）
 *   --api <port>    API のポート（既定 --port と同じ。参考表示のみ）
 *   --data <dir>    API の DATA_DIR（pdf-find が素材の索引を空にするのに使う）
 *   --sb <port>     Storybook のポート（既定 6006。静的ビルドでも可）
 *   --tmp <dir>     投入用ファイルを作る場所（既定 os.tmpdir()）
 *
 * 出力先: manual/public/screenshots/（1280×800 @2x。英語 UI・パン作りの見本）
 *
 * 罠:
 * - ウェルカムモーダルを閉じるとエディタが作り直される。エディタ実体は閉じた後に掴む
 * - CSV は素材に入れず、エディタへ drop イベントを合成して取り込み画面を開く
 * - pdf-find は素材の索引を書き換える。DATA_DIR は必ず隔離する
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const only = arg("only", null);
const port = Number(arg("port", 5189));
const sbPort = Number(arg("sb", 6006));
const dataDir = arg("data", null);
const TMP = arg("tmp", tmpdir());
const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const SB = (id) => `http://127.0.0.1:${sbPort}/iframe.html?id=${id}&viewMode=story`;
const out = (name) => join(OUT_DIR, `${name}.png`);
const PAD = 16;

const browser = await chromium.launch({ headless: true });

/** ストーリーを開く。静的配信が時々ストーリーの chunk を返し損ねるので、失敗したら開き直す */
async function openStory(page, id) {
  for (let i = 0; i < 6; i++) {
    await page.goto(SB(id), { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const failed = await page.getByText("Failed to fetch dynamically imported module").count();
    if (!failed) return;
  }
  throw new Error(`ストーリーを開けない: ${id}`);
}

async function newApp() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US", serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) {
    await welcome.click();
    await page.waitForTimeout(1200);
  }
  return { ctx, page };
}

/** React fiber から BlockNote のエディタ実体を掴んで fn(editor, arg) を実行 */
async function withEditor(page, fn, a) {
  return page.evaluate(({ src, a }) => {
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
    return new Function("editor", "a", `return (${src})(editor, a)`)(editor, a);
  }, { src: fn.toString(), a });
}

const SHOTS = {
  async "calc-polyfit"() {
    const { ctx, page } = await newApp();
    await withEditor(page, (editor, source) => {
      const old = editor.document;
      editor.insertBlocks([{ type: "calc", props: { source, results: "" } }], old[0], "before");
      const stale = old.filter((b) => b.type === "calc");
      if (stale.length > 0) editor.removeBlocks(stale);
      editor.setTextCursorPosition(editor.document[editor.document.length - 1], "end");
    }, [
      "# Two rigs, two sets of temperatures",
      "T_k = [300, 400, 500, 600, 650, 700, 800]",
      "kap = [3.9, 3.0, 2.5, 2.2, 2.1, 2.2, 2.6]",
      "c  = polyfit(T_k, kap, 4)",
      "T_e = [323, 423, 523]",
      "kappa_e = polyval(c, T_e)",
      "too_far = polyval(c, 900)",
    ].join("\n"));
    await page.waitForTimeout(2500); // 評価の遅延 + mathjs の初回読み込み
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.mouse.move(5, 790);
    await page.waitForTimeout(400);
    const text = await page.locator('[data-content-type="calc"]').innerText();
    if (/^\?$/m.test(text)) throw new Error(`評価できない行がある\n${text}`);
    if (!text.includes("R²=")) throw new Error(`フィットの行が出ていない\n${text}`);
    const b = await page.locator('[data-content-type="calc"]').first().boundingBox();
    await page.screenshot({ path: out("calc-polyfit"), clip: { x: Math.max(0, b.x - PAD), y: Math.max(0, b.y - PAD), width: b.width + PAD * 2, height: b.height + PAD + 6 } }); // 下は次の段落の案内文が入らない余白
    await ctx.close();
  },

  async "data-import-insert-as"() {
    const lines = ["time,temp_c,humidity"];
    for (let i = 0; i < 2000; i++) {
      const hh = String(Math.floor(i / 60)).padStart(2, "0");
      const mm = String(i % 60).padStart(2, "0");
      lines.push(`${hh}:${mm},${(Math.min(180 + 0.8 * i, 235) + 2 * Math.sin(i / 3.3)).toFixed(1)},${Math.max(35, 55 - i * 0.05).toFixed(1)}`);
    }
    const { ctx, page } = await newApp();
    // エディタへ CSV の drop を合成する（ドロップは取り込み画面に回る）
    await page.evaluate((csv) => {
      const dt = new DataTransfer();
      dt.items.add(new File([csv], "oven-log.csv", { type: "text/csv" }));
      const el = document.querySelector(".bn-editor");
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, lines.join("\n"));
    const dlg = page.getByText("Import data", { exact: true }).first();
    await dlg.waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("Insert as", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Data table", exact: true }).click();
    await page.getByText("Shows the asset's data as it is").waitFor();
    await page.mouse.move(5, 790);
    await page.waitForTimeout(600);
    const box = await page.getByRole("button", { name: "Import", exact: true }).last().evaluate((el) => {
      let n = el;
      while (n && !(n.className?.toString().includes("rounded") && n.getBoundingClientRect().width > 500)) n = n.parentElement;
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot({ path: out("data-import-insert-as"), clip: box });
    await ctx.close();
  },

  async "pdf-find"() {
    // 「starter」が 17 回出る 1 ページの PDF（表つき）
    const pg = await browser.newPage();
    await pg.setContent(
      `<body style="font-family:Helvetica,Arial,sans-serif;margin:0;padding:48px 56px;color:#222">
<h1 style="font-size:30px;margin:0 0 6px">Sourdough Starter Handbook</h1>
<p style="font-style:italic;color:#555;margin:0 0 22px">Notes from the bakery bench — maintaining a rye starter through the seasons</p>
<h2 style="font-size:20px;border-bottom:1px solid #ccc;padding-bottom:4px">1. What the starter is</h2>
<p style="font-size:14px;line-height:1.55">A sourdough starter is a stable culture of wild yeast and lactic bacteria in a flour and water paste. A mature starter doubles in volume within four to six hours and carries the aroma of yogurt rather than acetone. The starter used here was raised on stoneground rye and has been kept at 100 % hydration.</p>
<h2 style="font-size:20px;border-bottom:1px solid #ccc;padding-bottom:4px">2. Feeding schedule</h2>
<p style="font-size:14px;line-height:1.55">Feed the starter on a fixed rhythm. A starter kept on the counter wants feeding every twelve hours; a starter kept in the refrigerator can wait a week between feeds, but needs two or three warm feeds before it can raise a loaf.</p>
<table style="border-collapse:collapse;font-size:14px;width:100%"><tr><th style="border:1px solid #aaa;padding:4px 8px;background:#f1f1f1;text-align:left">Storage</th><th style="border:1px solid #aaa;padding:4px 8px;background:#f1f1f1;text-align:left">Temperature</th><th style="border:1px solid #aaa;padding:4px 8px;background:#f1f1f1;text-align:left">Feed ratio</th></tr>
<tr><td style="border:1px solid #aaa;padding:4px 8px">Counter</td><td style="border:1px solid #aaa;padding:4px 8px">22–25 °C</td><td style="border:1px solid #aaa;padding:4px 8px">1 : 5 : 5</td></tr>
<tr><td style="border:1px solid #aaa;padding:4px 8px">Refrigerator</td><td style="border:1px solid #aaa;padding:4px 8px">4–6 °C</td><td style="border:1px solid #aaa;padding:4px 8px">1 : 3 : 3</td></tr>
<tr><td style="border:1px solid #aaa;padding:4px 8px">Travel jar</td><td style="border:1px solid #aaa;padding:4px 8px">18–20 °C</td><td style="border:1px solid #aaa;padding:4px 8px">1 : 8 : 8</td></tr></table>
<h2 style="font-size:20px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:26px">3. Hydration</h2>
<p style="font-size:14px;line-height:1.55">A stiff starter at 60 % hydration ferments slowly and tastes mild; a liquid starter at 120 % ferments fast and turns sour. Keep notes on every starter you keep.</p></body>`,
    );
    const pdf = join(TMP, "sourdough-starter-handbook.pdf");
    await pg.pdf({ path: pdf, format: "A4" });
    await pg.close();
    // 素材の索引を空にして、この PDF だけを入れる（DATA_DIR は隔離しておくこと）
    if (dataDir) {
      const idx = join(dataDir, "appdata", "media-index.json");
      if (existsSync(idx)) {
        const j = JSON.parse((await import("fs")).readFileSync(idx, "utf8"));
        j.media = j.media.filter((m) => m.type !== "document");
        writeFileSync(idx, JSON.stringify(j));
      }
    }
    const { ctx, page } = await newApp();
    await page.getByRole("tab", { name: "Materials", exact: true }).click();
    await page.getByText("Documents", { exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(pdf);
    await page.getByText("Brought in", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByText("Brought in", { exact: true }).waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(800);
    await page.getByText("sourdough-starter-handbook.pdf").first().click();
    await page.locator("[data-page-number] span").first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Find in PDF" }).first().click();
    await page.keyboard.type("starter");
    await page.waitForTimeout(1200);
    await page.mouse.move(5, 790);
    await page.waitForTimeout(400);
    // ピークのツールバー（Page 1 / 1 の行）から下を 447×640 で切り抜く
    const pg1 = await page.getByText("Page 1 / 1", { exact: true }).first().boundingBox();
    await page.screenshot({ path: out("pdf-find"), clip: { x: pg1.x - 12, y: pg1.y + pg1.height / 2 - 18, width: 447, height: 640 } });
    await ctx.close();
  },

  // ── Storybook（コンポーネント単位の図） ──
  async "chart-settings"() {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
    await openStory(page, "blocks-chartblock--settings-grouped-by-source-manual");
    await page.getByText("Chart settings", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByText("Asset: bakery-room.csv").waitFor();
    await page.waitForTimeout(500);
    // パネル（幅約 300）の周りに 16px の余白を付けて、左上から 332×619 を切り抜く
    await page.screenshot({ path: out("chart-settings"), clip: { x: 0, y: 0, width: 332, height: 619 } });
    await page.close();
  },

  async "chart-data-picker"() {
    const page = await browser.newPage({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 2, locale: "en-US" });
    await openStory(page, "blocks-chartblock-datapicker--manual");
    await page.getByText("Choose data to chart").waitFor({ state: "visible", timeout: 30000 });
    await page.getByText("Files without numeric columns: 1").waitFor();
    await page.waitForTimeout(800);
    const box = await page.locator("h2", { hasText: "Choose data to chart" }).evaluate((el) => {
      let n = el;
      while (n && !(n.className?.toString().includes("w-[600px]"))) n = n.parentElement;
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    // 背景（暗幕）を少し含めて、元の図と同じ見え方にする
    await page.screenshot({ path: out("chart-data-picker"), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
    await page.close();
  },

  async "office-preview"() {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
    await openStory(page, "assetbrowser-officepreview--workbook");
    await page.getByText("25 rows × 4 columns").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(500);
    const root = await page.locator("#storybook-root > div").first().boundingBox();
    await page.screenshot({ path: out("office-preview"), clip: { x: root.x, y: root.y, width: root.width, height: 420 } });
    await page.close();
  },
};

const names = only ? [only] : Object.keys(SHOTS);
for (const n of names) {
  if (!SHOTS[n]) { console.error(`--only ${n} は未定義`); process.exit(1); }
  await SHOTS[n]();
  console.log(`  ✓ ${n}`);
}
await browser.close();
