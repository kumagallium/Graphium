/**
 * マニュアル用スクリーンショット撮影（来歴・素材・スマホの図まとめ）
 *
 * 次の図を実アプリから撮る（全部パン作りの世界観・英語 UI）:
 *   editor-with-graph_en / network-graph / label-dropdown / label-shortcut-keycaps /
 *   step-stages / image-ocr / composer-image-search / pdf-reader-quote / mobile-capture /
 *   material-full-view（PDF 素材の全画面 + Asset graph。pdf-reader-quote で PDF を入れた後）/
 *   media-picker（/Image のピッカー。画像が素材にある状態で）
 *
 * 隔離データで起動した API + vite に英語 UI で入る。見本データ（パン作りのノート）の上に、
 * この図だけに要るノートを `--data` の notes/ に直接書き足し、画像・PDF は Playwright で
 * HTML を描いて作り、UI の hidden `input[type=file]` へ投入する。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port <port> --strictPort --host 127.0.0.1             # 別ターミナル
 *   node scripts/manual-screenshots-provenance.mjs --port <port> --data <DATA_DIR> [--only <name>]
 *
 * オプション:
 *   --port <port>   vite のポート（既定 5189）
 *   --data <dir>    API が使っている DATA_DIR（ノートの書き足しに使う。必須）
 *   --only <name>   1 枚だけ撮る（上の図名。複数はカンマ区切り）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *   --tmp <dir>     投入用の画像・PDF を作る場所（既定 os.tmpdir()）
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる。閉じないとクリックを横取りされる
 * - Service Worker は block（PWA の自動リロードが入力と競合する）
 * - localStorage の `graphium:graphSelectionLearned=1` を入れる。入れないと工程グラフの下に
 *   「Shift-drag to select several」が出て、「Drag the dot under a node…」と重なって読めない
 * - 工程ノードを選ぶと下に表パネルが開いてグラフ領域が縮むが、ノードの位置は据え置きで下端に
 *   寄る。キャンバスの空き地を上へドラッグして、ヒント文から離す
 * - ノートは `#note/<id>` へ直接遷移して開く（一覧クリックはサイドピークになる）
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const port = parseInt(opt("--port", "5189"), 10);
const dataDir = opt("--data", "");
const only = opt("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
const TMP = resolve(opt("--tmp", tmpdir()));
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
if (!dataDir) {
  console.error("--data <DATA_DIR> が要ります（API が使っている隔離データ）");
  process.exit(1);
}
const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const want = (n) => only.length === 0 || only.includes(n);

// ── 見本ノートの書き足し ──────────────────────────────────────────
const NOW = "2026-10-29T09:00:00.000Z";
const P = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const t = (text, styles = {}) => ({ type: "text", text, styles });
const para = (id, ...c) => ({ id, type: "paragraph", props: P, content: c, children: [] });
const cell = (s) => ({ type: "tableCell", content: [t(s)], props: { colspan: 1, rowspan: 1, ...P } });
const table = (id, rows) => ({
  id,
  type: "table",
  props: { textColor: "default" },
  content: {
    type: "tableContent",
    columnWidths: rows[0].map(() => null),
    headerRows: 1,
    rows: rows.map((r) => ({ cells: r.map(cell) })),
  },
  children: [],
});
const step = (id, title, children) => ({
  id,
  type: "step",
  props: { textAlignment: "left", variant: "step" },
  content: [t(title)],
  children,
});
const mkDoc = (title, blocks, labels = {}, provLinks = []) => ({
  version: 6,
  title,
  createdAt: NOW,
  modifiedAt: NOW,
  source: "human",
  pages: [{ id: "main", title, blocks, labels, provLinks, knowledgeLinks: [] }],
});
const informedBy = (src, tgt) => ({
  id: `lnk_${src.slice(0, 8)}`,
  sourceBlockId: src,
  targetBlockId: tgt,
  type: "informed_by",
  layer: "prov",
  createdBy: "human",
});
const saveNote = (id, doc) => writeFileSync(join(dataDir, "notes", `${id}.json`), JSON.stringify(doc));

const ID = {
  trial: "a1000000-0000-4000-8000-000000000001",
  stages: "a2000000-0000-4000-8000-000000000002",
  scratch: "a3000000-0000-4000-8000-000000000003",
  ocrNote: "a4000000-0000-4000-8000-000000000004",
};

// 素材の全画面用: 既存の PDF 素材を、2 本のノートが引用している状態にする
// （usedIn は保存時に同期される値なので、ノート本文のリンク + media-index の usedIn を両方書く）
const MAT_NOTES = [
  { id: "a5000000-0000-4000-8000-000000000005", title: "Dough hydration reading list" },
  { id: "a6000000-0000-4000-8000-000000000006", title: "Proofing schedule draft" },
];
function seedMaterialUse() {
  const idxPath = join(dataDir, "appdata", "media-index.json");
  const idx = JSON.parse(readFileSync(idxPath, "utf8"));
  const pdf = idx.media.find((m) => m.name === "bread-science.pdf");
  if (!pdf) throw new Error("bread-science.pdf が素材にありません（pdf-reader-quote を先に撮る）");
  const used = [];
  MAT_NOTES.forEach((n, i) => {
    const bid = `m500000${i}-0000-4000-8000-0000000000b1`;
    saveNote(
      n.id,
      mkDoc(n.title, [
        para(bid, t("Background on gluten and oven spring: "), {
          type: "link",
          href: pdf.url,
          content: [t("bread-science.pdf")],
        }),
      ]),
    );
    used.push({ noteId: n.id, noteTitle: n.title, blockId: bid });
  });
  pdf.usedIn = used;
  writeFileSync(idxPath, JSON.stringify(idx));
}

function seedNotes() {
  // Mix → Ferment → Bake（表のラベルつき）
  {
    const [mix, fer, bak] = [1, 2, 3].map((n) => `m1000000-0000-4000-8000-00000000000${n}`);
    const [tIn, tTool, tOven, tOut] = [1, 2, 3, 4].map((n) => `m1000000-0000-4000-8000-0000000000a${n}`);
    saveNote(
      ID.trial,
      mkDoc(
        "Bread dough trial #3",
        [
          para("m1000000-0000-4000-8000-0000000000b0", t("Trying a slightly wetter dough than trial #2. Same flour, same oven.")),
          step(mix, "Mix", [
            para("m1000000-0000-4000-8000-0000000000b1", t("Combine the dry ingredients with the water in the stand mixer.")),
            table(tIn, [["Name", "Amount"], ["bread flour", "300 g"], ["water", "200 g"], ["dry yeast", "3 g"], ["salt", "5 g"]]),
            table(tTool, [["Name"], ["stand mixer"]]),
          ]),
          step(fer, "Ferment", [para("m1000000-0000-4000-8000-0000000000b2", t("Rest the dough 30 min at room temperature, covered."))]),
          step(bak, "Bake", [
            para("m1000000-0000-4000-8000-0000000000b3", t("Bake at 200 °C for 25 min.")),
            table(tOven, [["Name"], ["oven"]]),
            table(tOut, [["Name"], ["baked loaf"]]),
          ]),
        ],
        { [tIn]: "material", [tTool]: "tool", [tOven]: "tool", [tOut]: "output" },
        [informedBy(fer, mix), informedBy(bak, fer)],
      ),
    );
  }
  // 段階が 3 つある Bake（パラメータ表）
  {
    const bak = "m2000000-0000-4000-8000-000000000001";
    const tp = "m2000000-0000-4000-8000-0000000000a1";
    saveNote(
      ID.stages,
      mkDoc(
        "Oven spring experiment",
        [
          para("m2000000-0000-4000-8000-0000000000b0", t("Starting hot, then stepping the oven down.")),
          step(bak, "Bake", [table(tp, [["Temperature", "Time"], ["250 °C", "20 min"], ["230 °C", "15 min"], ["200 °C", "10 min"]])]),
        ],
        { [tp]: "attribute" },
      ),
    );
  }
  // ハンドルメニュー用（工程の中の無印の表）
  {
    const s = "m3000000-0000-4000-8000-000000000001";
    const tb = "m3000000-0000-4000-8000-0000000000a1";
    saveNote(
      ID.scratch,
      mkDoc("Proofing run (scratch)", [
        step(s, "Proof", [
          para("m3000000-0000-4000-8000-0000000000b1", t("Shape the dough and set it in the proofing box.")),
          table(tb, [["Name", "Amount"], ["dough ball", "450 g"]]),
        ]),
      ]),
    );
  }
  // OCR 用（画像は UI から入れる）
  saveNote(
    ID.ocrNote,
    mkDoc("Trial #2 retrospective", [
      para("m4000000-0000-4000-8000-0000000000b0", t("Crumb too dense. Suspect under-proofing rather than hydration.")),
    ]),
  );
}

// ── ブラウザ共通 ──────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

async function newSession({ mobile = false, height = 800, width = 1280 } = {}) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "en-US", serviceWorkers: "block" }
      : { viewport: { width, height }, deviceScaleFactor: 2, locale: "en-US", serviceWorkers: "block" },
  );
  await ctx.addInitScript(() => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
    localStorage.setItem("graphium:graphSelectionLearned", "1");
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function dismissWelcome(page) {
  const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) {
    await welcome.click();
    await page.waitForTimeout(1200);
  }
}

async function openNote(page, id) {
  await page.goto(`${BASE}#note/${id}`, { waitUntil: "domcontentloaded" });
  await dismissWelcome(page);
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(3000);
}

async function selectStepNode(page, name) {
  const node = page.locator(".react-flow__node").filter({ hasText: name }).first();
  const opened = page.getByText("Same content as the table in the note");
  for (let i = 0; i < 4 && !(await opened.isVisible().catch(() => false)); i++) {
    await node.click();
    await page.waitForTimeout(1500);
  }
}

/** 工程グラフの空き地を上へドラッグして、ノードをヒント文から離す */
async function panGraphUp(page, dy) {
  const box = await page.locator(".react-flow__pane").first().boundingBox();
  const x = box.x + box.width * 0.15;
  const y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** 素材（media/）と素材の索引を空に戻す。前の実行の画像が重複して写らないように */
function resetMedia() {
  const dir = join(dataDir, "media");
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true, recursive: true });
  const idxPath = join(dataDir, "appdata", "media-index.json");
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    idx.media = [];
    writeFileSync(idxPath, JSON.stringify(idx));
  }
}

/** オーブンの操作パネル風の画像を HTML から描く（パン作り・英字のテキスト入り） */
async function makeOvenPanelImage() {
  const file = join(TMP, "oven-panel.png");
  const page = await browser.newPage({ viewport: { width: 560, height: 340 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#222a26"><div style="margin:24px;padding:22px 30px;background:#16201b;border:6px solid #3d4a43;border-radius:14px;height:228px;font:700 27px 'Courier New',monospace;color:#e8f1e6;line-height:1.55;letter-spacing:1px">OVEN PANEL 1<br>SETPOINT 230 C<br>HOLD 35 min<br>STEAM ON<br>RACK middle</div></body>`);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

/** パン作りの読み物 PDF を HTML から 2 本作る */
async function makePdfs() {
  const page = await browser.newPage();
  const doc = (h, secs) =>
    `<body style="font-family:Georgia,serif;margin:0;padding:48px 56px;color:#222"><h1 style="font-size:30px;border-bottom:3px solid #222;padding-bottom:10px;margin:0 0 22px">${h}</h1>${secs
      .map(([x, y]) => `<h2 style="font-size:20px;margin:26px 0 6px">${x}</h2><p style="font-size:14px;line-height:1.55;margin:0">${y}</p>`)
      .join("")}</body>`;
  await page.setContent(
    doc("Bread Science Basics", [
      ["Gluten development", "Gluten forms when glutenin and gliadin hydrate and are worked mechanically. Higher hydration speeds development but makes dough harder to shape. Autolyse rest periods let flour absorb water before kneading."],
      ["Fermentation", "Yeast converts sugars to carbon dioxide and ethanol. Proof time depends on temperature and starter vigor. Under-proofed dough produces a dense crumb; over-proofed dough collapses in the oven."],
      ["Oven spring", "Rapid expansion during the first minutes of baking. A hot baking stone and steam improve oven spring and crust color."],
    ]),
  );
  await page.pdf({ path: join(TMP, "bread-science.pdf"), format: "A4" });
  await page.setContent(
    doc("Proofing Guide", [
      ["Time and temperature", "At 26 C most doughs double in about four hours. Colder rooms need longer; warmer rooms need less."],
      ["The poke test", "Press a floured finger into the dough. If the dent springs back slowly, the dough is ready to bake."],
    ]),
  );
  await page.pdf({ path: join(TMP, "proofing-guide.pdf"), format: "A4" });
  await page.close();
  return [join(TMP, "proofing-guide.pdf"), join(TMP, "bread-science.pdf")];
}

/** ノート末尾に画像ブロックを足して、OCR（端末内）が済むまで待つ */
async function addOvenImage(page, fileArg) {
  const file = fileArg || (await makeOvenPanelImage());
  await page.locator(".bn-editor p, .bn-editor [data-content-type='paragraph']").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const input = page.locator("input[type=file]");
  if (!(await input.count())) {
    await page.getByText(/Add image|Upload/i).first().click();
    await page.waitForTimeout(500);
  }
  await page.locator("input[type=file]").last().setInputFiles(file);
  await page.locator(".bn-editor img").first().waitFor({ state: "visible", timeout: 20000 });
  // OCR 完了のトーストが出て消え、保存済みになるまで待つ
  // （同じ画像を読み済みのときはトーストが出ないので、出なくても進む）
  await page.getByText("Text extracted").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
  await page.getByText("Text extracted").first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.getByText("Saved", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
}

/** 画像ブロックの ⠿ ハンドルメニューを開く */
async function openImageHandleMenu(page) {
  const img = page.locator(".bn-editor img").first();
  for (let i = 0; i < 6; i++) {
    await img.hover();
    await page.waitForTimeout(500);
    await page.locator(".bn-side-menu button").last().click().catch(() => {});
    await page.waitForTimeout(400);
    if (await page.getByText(/^Text extracted/).first().isVisible().catch(() => false)) return;
  }
  throw new Error("handle menu did not open");
}

const out = (n) => join(OUT, `${n}.png`);
const done = (n) => console.log(`  ✓ ${out(n)}`);

const figures = {
  // 全画面: Mix を選んで、右に Steps パネル（グラフ + Mix の表）
  async "editor-with-graph_en"() {
    const { ctx, page } = await newSession();
    await openNote(page, ID.trial);
    await selectStepNode(page, "Mix");
    await panGraphUp(page, 90); // 全ノードが表パネルに隠れないよう上へ寄せる
    await page.mouse.move(700, 10); // 本文のハンドルが出ないよう、ヘッダーの空きへ
    // マウスを外しても直前に出たハンドル（⠿ と +）が残ることがあるので、撮る間だけ隠す
    await page.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });
    await page.waitForTimeout(200);
    await page.screenshot({ path: out("editor-with-graph_en") });
    await ctx.close();
  },

  // 右レールの Graph タブ → Neighbors
  async "network-graph"() {
    const { ctx, page } = await newSession();
    await openNote(page, GRAPH_NOTE_ID);
    await page.getByRole("button", { name: "Graph", exact: true }).first().click();
    await page.getByRole("button", { name: "Neighbors", exact: true }).click();
    await page.waitForTimeout(3500);
    // 原因: cytoscape の fcose は randomize で毎回違う形になり、fit は「幅」か「高さ」の
    // 窮屈な方に合わせる。右パネルは縦長（約 600 × 950 px）なので、横に長い形になると
    // 幅で縮み、パネルの下半分が空いたまま文字が読めない大きさになる。
    // 縦にも広がった形（描画の外接矩形がパネルの高さの 6 割以上）になるまで、
    // タブを切り替えて並べ直す
    const extent = () =>
      page.evaluate(() => {
        let best = 0;
        for (const c of document.querySelectorAll("canvas")) {
          const r = c.getBoundingClientRect();
          if (r.left < window.innerWidth * 0.6 || r.height < 200) continue;
          const ctx2 = c.getContext("2d");
          if (!ctx2) continue;
          const { width: w, height: h } = c;
          const data = ctx2.getImageData(0, 0, w, h).data;
          let minY = h, maxY = -1;
          for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x += 2) {
              if (data[(y * w + x) * 4 + 3] > 20) { if (y < minY) minY = y; if (y > maxY) maxY = y; break; }
            }
          }
          if (maxY >= 0) best = Math.max(best, (maxY - minY) / h);
        }
        return best;
      });
    for (let i = 0; i < 12; i++) {
      const ratio = await extent();
      console.log(`  network-graph extent try ${i}: ${ratio.toFixed(2)}`);
      if (ratio >= 0.6) break;
      await page.getByRole("button", { name: "Lineage", exact: true }).first().click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Neighbors", exact: true }).click();
      await page.waitForTimeout(3500);
    }
    await page.mouse.move(700, 10); // 本文側の空きへ（hover 跡防止）
    await page.screenshot({ path: out("network-graph") });
    await ctx.close();
  },

  // 表の ⠿ → Label サブメニュー
  async "label-dropdown"() {
    const { ctx, page } = await newSession();
    await openNote(page, ID.scratch);
    const tbl = page.locator("table").first();
    const labelItem = page.getByText("Label", { exact: true }).first();
    for (let i = 0; i < 6; i++) {
      await tbl.hover();
      await page.waitForTimeout(500);
      await page.locator(".bn-side-menu button").last().click().catch(() => {});
      await page.waitForTimeout(400);
      if (await labelItem.isVisible().catch(() => false)) break;
    }
    await labelItem.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: out("label-dropdown") });
    await ctx.close();
  },

  // 本文を選択 → 選択ツールバー（ラベル行のキーキャップ）を局所で
  async "label-shortcut-keycaps"() {
    const { ctx, page } = await newSession();
    await openNote(page, ID.scratch);
    const word = await page.evaluate(() => {
      const w = document.createTreeWalker(document.querySelector(".bn-editor"), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.textContent.indexOf("Shape");
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 5);
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y + b.height / 2, w: b.width };
        }
      }
      return null;
    });
    await page.mouse.dblclick(word.x + word.w / 2, word.y);
    const tb = page.locator(".bn-formatting-toolbar").first();
    await tb.waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(600);
    const b = await tb.boundingBox();
    await page.screenshot({
      path: out("label-shortcut-keycaps"),
      clip: { x: Math.max(0, b.x - 20), y: Math.max(0, b.y - 20), width: b.width + 40, height: b.height + 20 + 30 },
    });
    await ctx.close();
  },

  async "image-ocr"() {
    resetMedia();
    seedNotes(); // 前の図で足した画像ブロックを消して、ノートを元に戻す
    const { ctx, page } = await newSession();
    await openNote(page, ID.ocrNote);
    await addOvenImage(page);
    await openImageHandleMenu(page);
    await page.screenshot({ path: out("image-ocr") });
    await ctx.close();
  },

  // ⌘K で画像の中の語（OCR で読んだ文字）を検索 → Assets の下に出る
  async "composer-image-search"() {
    resetMedia();
    seedNotes(); // 前の図で足した画像ブロックを消して、ノートを元に戻す
    const { ctx, page } = await newSession({ height: 860 });
    await openNote(page, ID.ocrNote);
    await addOvenImage(page);
    await page.mouse.click(1100, 780);
    await page.keyboard.press("Meta+k");
    const box = page.locator("input, textarea, [contenteditable=true]").filter({ visible: true }).last();
    await page.waitForTimeout(800);
    await page.keyboard.type("setpoint");
    await page.getByRole("button", { name: /This note/ }).click();
    await page.getByText("Assets", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: out("composer-image-search") });
    await ctx.close();
  },

  // 素材の Documents に PDF を 2 本入れ、読み物 PDF の本文を選んで「Save as memo」
  async "pdf-reader-quote"() {
    resetMedia();
    const files = await makePdfs();
    const { ctx, page } = await newSession();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissWelcome(page);
    await page.waitForTimeout(2000);
    await page.getByText("Documents", { exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(files);
    await page.getByText("bread-science.pdf").first().waitFor({ state: "visible", timeout: 30000 });
    // 取り込み結果のダイアログ（Brought in）を閉じる
    await page.getByText("Brought in", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByText("Brought in", { exact: true }).waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /gallery/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.mouse.click(397, 205); // カードのサムネイル（本文のチェックや削除の外）
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(TMP, "pdf-debug.png") });
    const layer = page.locator("[data-page-number] span").first();
    await layer.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1500);
    const a = await page.locator("[data-page-number] span").filter({ hasText: "Bread Science Basics" }).first().boundingBox();
    const b = await page.locator("[data-page-number] span").filter({ hasText: "Gluten development" }).first().boundingBox();
    await page.mouse.move(a.x + 1, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.getByText("Save as memo").first().waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: out("pdf-reader-quote") });
    await ctx.close();
  },

  // スマホの記録画面。Send into の行は「送り先が設定済み」のときだけ出る（push.configured）。
  // 実際の Google 接続は要らないので、見本のクライアント ID を localStorage に入れて
  // 「設定済み・未接続」にする。画像は Library の file input から入れてキューに載せる
  async "mobile-capture"() {
    const file = await makeOvenPanelImage();
    const { ctx, page } = await newSession({ mobile: true });
    await ctx.addInitScript(() => {
      localStorage.setItem("graphium-push-google-client-id", "demo-bread-lab.apps.googleusercontent.com");
      localStorage.setItem("graphium-mobile-inbox-folder-history", JSON.stringify(["Bread trials", "Sourdough"]));
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissWelcome(page);
    await page.waitForTimeout(2500);
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: out("mobile-capture") });
    await ctx.close();
  },

  // 素材を全画面で開き、右レールの Asset graph（素材ノード + 使っているノート 2 本）
  async "material-full-view"() {
    seedMaterialUse();
    const { ctx, page } = await newSession({ width: 1760, height: 1000 }); // PDF の右が切れない幅・サイドバー下端が切れない高さ
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissWelcome(page);
    await page.waitForTimeout(2000);
    await page.getByText("Documents", { exact: true }).first().click();
    await page.waitForTimeout(1500);
    await page.getByText("bread-science.pdf").first().click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Open in full view" }).first().click();
    await page.waitForTimeout(2500);
    // 右パネルは既定で Asset graph が開いている（アイコンを押すと閉じてしまう）
    await page.getByText("Click node to open note").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(3000);
    await page.mouse.move(640, 5);
    await page.screenshot({ path: out("material-full-view") });
    await ctx.close();
  },

  // /Image で開くメディアピッカー（Upload from file / 既存の画像 / Insert as）
  async "media-picker"() {
    // 素材に画像を 2 枚入れておく（別ノートに置いて OCR まで待つ）。ピッカーの一覧に並ぶ
    resetMedia();
    seedNotes();
    {
      const s = await newSession();
      await openNote(s.page, ID.ocrNote);
      await addOvenImage(s.page);
      await s.ctx.close();
      const s2 = await newSession();
      await openNote(s2.page, ID.ocrNote);
      const dough = join(TMP, "proofed-dough.png");
      const dp = await browser.newPage({ viewport: { width: 560, height: 340 }, deviceScaleFactor: 1 });
      await dp.setContent(`<body style="margin:0;background:#c98f4a"><div style="margin:24px;height:292px;border-radius:14px;background:radial-gradient(circle at 50% 60%,#f3dcae,#d9a35a);font:700 27px Georgia,serif;color:#5a3412;display:flex;align-items:center;justify-content:center">PROOFED DOUGH - 2 h</div></body>`);
      await dp.screenshot({ path: dough });
      await dp.close();
      await addOvenImage(s2.page, dough);
      await s2.ctx.close();
      seedNotes(); // 画像ブロックを消してノートを元に戻す（素材には残る）
    }
    const { ctx, page } = await newSession({ height: 1000 }); // サイドバー下端の Labels が切れない高さ
    await openNote(page, ID.ocrNote);
    await page.locator(".bn-editor p, .bn-editor [data-content-type='paragraph']").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/image");
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    await page.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });
    await page.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) if (n.textContent.trim() === "Unsaved") n.parentElement.style.visibility = "hidden";
    });
    await page.mouse.move(640, 5);
    await page.screenshot({ path: out("media-picker") });
    await ctx.close();
  },

  // Bake の「3 stages」カードと、下のパラメータ表
  async "step-stages"() {
    const { ctx, page } = await newSession();
    await openNote(page, ID.stages);
    await selectStepNode(page, "Bake");
    // グラフと表パネルの仕切りを上へ引いて、表の全段と Add stage を見せる
    const hb = await page.getByText("Same content as the table in the note").boundingBox();
    await page.mouse.move(hb.x + 40, hb.y - 6);
    await page.mouse.down();
    await page.mouse.move(hb.x + 40, hb.y - 6 - 130, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await panGraphUp(page, 230);
    await page.mouse.move(10, 400); // ホバーのツールチップを出さない
    const panel = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll("*")).find((e) => e.children.length === 0 && e.textContent.trim() === "Steps");
      let el = h;
      while (el && el.getBoundingClientRect().height < 600) el = el.parentElement;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    await page.screenshot({ path: out("step-stages"), clip: { x: panel.x, y: 44, width: panel.w, height: 572 } });
    await ctx.close();
  },
};

const GRAPH_NOTE_ID = readdirSync(join(dataDir, "notes"))
  .map((f) => f.replace(/\.json$/, ""))
  .find((id) => {
    try {
      return JSON.parse(readFileSync(join(dataDir, "notes", `${id}.json`), "utf8")).title === "Oven temperature calibration";
    } catch {
      return false;
    }
  });

seedNotes();
for (const [name, fn] of Object.entries(figures)) {
  if (!want(name)) continue;
  console.log(`▶ ${name}`);
  try {
    await fn();
    done(name);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message.split("\n").slice(0, 14).join(" / ")} @ ${(e.stack || "").split("\n").find((l) => l.includes("provenance.mjs")) || ""}`);
  }
}
await browser.close();
