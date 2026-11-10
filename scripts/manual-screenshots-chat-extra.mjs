/**
 * マニュアル用スクリーンショット撮影（チャット → 計画ノート／PDF の引用／AI の接続先／スマホのメモ／提案の採用）
 *
 * 撮影スクリプトが残っていなかった 7 枚を、ここ 1 本にまとめる。全部英語 UI・パン作りの世界観。
 *   chat-make-plan         チャットの回答の下のボタン列（Make an experiment plan / Keep as knowledge / 再生成 / 分岐）
 *   plan-note-from-chat    計画ノートの Items & Conditions の表（1 列目が行ごとの工程ノートへのリンク）
 *   pdf-peek-quote-in-note ノートの横のサイドピークで PDF の文を選ぶ → ピルの Quote in note / Save as memo
 *   pdf-quote-open-source  ノートの引用ブロックから Open source → 横に PDF が開き、引用した文に印が付く
 *   settings-ai-connect    「Where do you want to connect?」（Storybook の AiConnect Chooser）
 *   mobile-memo-input      スマホの Write（New Memo）
 *   note-proposals-adopt   右レールの Proposals タブで提案を 1 件開いた状態（Storybook の NoteProposalsPanel）
 *
 * 使い方（本物のアプリで撮る図は、API と vite（またはビルド済みの preview）を隔離データで起動しておく）:
 *   node scripts/manual-screenshots-chat-extra.mjs --port <web> --api <api> --data <DATA_DIR> [--sb <storybook>] [--only <name>]
 *
 * オプション:
 *   --port <port>   アプリ（Web）のポート（既定 5189）
 *   --api <port>    API のポート。起動していなければ失敗にする（既定 3001 は使わない）
 *   --data <dir>    API が使っている DATA_DIR（ノート・素材の書き足しに使う。本物のアプリの図で必須）
 *   --sb <port>     Storybook（静的ビルドでよい）のポート（既定 6006）
 *   --only <name>   1 枚だけ撮る（複数はカンマ区切り）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *   --tmp <dir>     PDF を作る場所（既定 os.tmpdir()）
 *
 * AI は呼ばない。チャットは見本データの「30% Wheat Hydration」の回答をそのまま使う。
 * データは `reset <slot> bread`（パン作りの見本）の直後を想定。PDF の図は素材（media/）を空にして作り直す。
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる
 * - 右下のズームの案内は localStorage `graphium-zoom-hint-dismissed` で消す
 * - 左ナビは「上段＝検索・＋ノート・ファイル取り込み／下段＝Notes・Knowledge・Materials・Chat のタブ」
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "fs";
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
const apiPort = opt("--api", "");
const sbPort = parseInt(opt("--sb", "6006"), 10);
const dataDir = opt("--data", "");
const only = opt("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
const TMP = resolve(opt("--tmp", tmpdir()));
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const SB = `http://127.0.0.1:${sbPort}/iframe.html`;
const want = (n) => only.length === 0 || only.includes(n);
const out = (n) => join(OUT, `${n}.png`);

// ── 見本ノートの書き足し ──────────────────────────────────────────
const NOW = "2026-11-10T09:00:00.000Z";
const P = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const t = (text, styles = {}) => ({ type: "text", text, styles });
const para = (id, ...c) => ({ id, type: "paragraph", props: P, content: c, children: [] });
const heading = (id, text, level = 2) => ({
  id,
  type: "heading",
  props: { ...P, level, isToggleable: false },
  content: [t(text)],
  children: [],
});
// 1 列目の "@名前" は青い文字（@メンションと同じ見た目）。ほかのセルは素のテキスト
const cell = (s) => ({ type: "tableCell", content: [s.startsWith("@") ? t(s, { textColor: "blue" }) : t(s)], props: { colspan: 1, rowspan: 1, ...P } });
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
const mkDoc = (title, blocks, extra = {}, page = {}) => ({
  version: 6,
  title,
  createdAt: NOW,
  modifiedAt: NOW,
  source: "human",
  ...extra,
  pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [], ...page }],
});
const saveNote = (id, doc) => writeFileSync(join(dataDir, "notes", `${id}.json`), JSON.stringify(doc));
const needData = () => {
  if (!dataDir) throw new Error("--data <DATA_DIR> が要ります（API が使っている隔離データ）");
};

// ── ブラウザ共通 ──────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

if (apiPort) {
  const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`).catch(() => null);
  if (!res) {
    console.error(`API ${apiPort} に繋がりません`);
    process.exit(1);
  }
}

async function newSession({ mobile = false, width = 1280, height = 800 } = {}) {
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

async function openApp(page, hash = "") {
  await page.goto(`${BASE}${hash}`, { waitUntil: "domcontentloaded" });
  await dismissWelcome(page);
  await page.waitForTimeout(1500);
}

async function openNote(page, id) {
  await openApp(page, `#note/${id}`);
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2500);
}

/** 要素の矩形（CSS px）。pad で四方に余白を足す */
async function rectOf(locator, pad = 0) {
  const b = await locator.boundingBox();
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

/** 素材（media/）と素材の索引を空に戻す。前の実行の PDF が重複して写らないように */
function resetMedia() {
  needData();
  const dir = join(dataDir, "media");
  if (existsSync(dir)) for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true, recursive: true });
  const idxPath = join(dataDir, "appdata", "media-index.json");
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    idx.media = [];
    writeFileSync(idxPath, JSON.stringify(idx));
  }
}

/** パン作りの PDF を HTML から作る。pages は [[見出し, 本文の行...], ...]（1 要素 = 1 ページ） */
async function makePdf(file, pages) {
  const page = await browser.newPage();
  const body = pages
    .map(
      ([h, ...lines], i) =>
        `<section style="${i ? "page-break-before:always;" : ""}padding:28px 56px;font-family:Helvetica,Arial,sans-serif;color:#111"><h1 style="font-size:22px;margin:0 0 14px">${h}</h1>${lines
          .map((l) => `<p style="font-size:15px;line-height:1.7;margin:0">${l}</p>`)
          .join("")}</section>`,
    )
    .join("");
  await page.setContent(`<body style="margin:0">${body}</body>`);
  const path = join(TMP, file);
  await page.pdf({ path, format: "A4" });
  await page.close();
  return path;
}

/** 素材の Documents へ PDF を入れる（取り込み結果のダイアログは閉じる） */
async function uploadPdf(page, path, name) {
  await page.getByRole("tab", { name: "Materials", exact: true }).click();
  await page.getByText("Documents", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(path);
  await page.getByText("Brought in", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByText("Brought in", { exact: true }).waitFor({ state: "hidden", timeout: 5000 });
  await page.getByText(name).first().waitFor({ state: "visible", timeout: 30000 });
}

/** ノート本文（1 行目に PDF の @メンション、Quotes: の見出し、空の行）を書いて開く */
function seedQuoteNote(id, title, intro, pdfName) {
  saveNote(
    id,
    mkDoc(title, [
      para(`${id.slice(0, 8)}-0000-4000-8000-0000000000b1`, t(intro), t(`@${pdfName}`, { textColor: "blue" })),
      para(`${id.slice(0, 8)}-0000-4000-8000-0000000000b2`, t("Quotes:")),
      para(`${id.slice(0, 8)}-0000-4000-8000-0000000000b3`),
    ]),
  );
}

/**
 * PDF のテキスト層の span の中の文字列 text だけを選ぶ（部分一致）。ドラッグは右の余白に落ちると行の外まで
 * 選んでしまうので、Selection で範囲を作り、離したときの mouseup を投げてピルを出す
 */
async function selectPdfText(page, text) {
  const span = page.locator("[data-page-number] span").filter({ hasText: text }).first();
  await span.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
  const h = await span.elementHandle();
  await page.evaluate(
    ([el, needle]) => {
      const node = el.firstChild;
      const i = node.textContent.indexOf(needle);
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + needle.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.right - 1, clientY: b.top + b.height / 2 }));
    },
    [h, text],
  );
}

/** ノートの最後の空の行をクリックして、カーソルをそこに置く（Quote in note はカーソルの位置に入る） */
async function putCursorOnLastLine(page) {
  const last = page.locator(".bn-editor [data-content-type='paragraph']").last();
  await last.click();
  await page.waitForTimeout(400);
}

const SHOTS = {
  // 見本のチャット「30% Wheat Hydration」を開き、最後の回答の下のボタン列だけを切る
  async "chat-make-plan"() {
    const { ctx, page } = await newSession();
    await openApp(page);
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page.getByText("30% Wheat Hydration", { exact: true }).first().click();
    const keep = page.getByRole("button", { name: /Keep as knowledge/ }).first();
    await keep.waitFor({ state: "visible", timeout: 15000 });
    await keep.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /Make an experiment plan/ }).first().waitFor({ state: "visible" });
    await page.mouse.move(640, 5);
    await page.waitForTimeout(800);
    const row = keep.locator("xpath=..");
    const r = await rectOf(row);
    const clip = { x: r.x - 12, y: r.y - 4, width: 600, height: r.height + 8 }; // 右の全体グラフとの境の線が入らない幅
    await page.screenshot({ path: out("chat-make-plan"), clip });
    await ctx.close();
  },

  // 計画ノート（Items & Conditions の表。1 列目は行ごとの工程ノートへの note-link）を書き足して開く
  async "plan-note-from-chat"() {
    needData();
    const rows = [
      [800, 4], [850, 4], [900, 4], [950, 4], [1000, 4], [1100, 4], [950, 1], [950, 2], [950, 8],
    ];
    const noteLinks = {};
    const tableRows = [["Item", "Calcination temperature (°C)", "Hold time (h)"]];
    rows.forEach(([c, h], i) => {
      const name = `BaFe12O19 ${c} °C / ${h} h`;
      const id = `c7000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
      noteLinks[name] = id;
      tableRows.push([`@${name}`, `${c} °C`, `${h} h`]);
      saveNote(
        id,
        mkDoc(name, [para(`c70000${i}-0000-4000-8000-0000000000b0`, t(`Calcine at ${c} °C and hold for ${h} h.`))], {}, {}),
      );
    });
    const planId = "c7000000-0000-4000-8000-000000000001";
    const tid = "c7000000-0000-4000-8000-0000000000a1";
    saveNote(
      planId,
      mkDoc(
        "Plan: calcination of BaFe12O19",
        [
          heading("c7000000-0000-4000-8000-0000000000h1", "Background"),
          para("c7000000-0000-4000-8000-0000000000b1", t("Vary the calcination temperature and the hold time, one at a time.")),
          heading("c7000000-0000-4000-8000-0000000000h2", "Items & Conditions"),
          table(tid, tableRows),
        ],
        { noteContexts: ["plan"] },
        { tableMeta: { [tid]: { columns: { Item: ["note-link"] }, noteLinks } } },
      ),
    );
    const { ctx, page } = await newSession({ height: 1000 });
    await openNote(page, planId);
    const h = page.locator(".bn-editor [data-content-type='heading']").filter({ hasText: "Items & Conditions" }).first();
    await h.scrollIntoViewIfNeeded();
    await page.mouse.move(640, 5);
    await page.waitForTimeout(1000);
    const hr = await rectOf(h);
    const tr = await rectOf(page.locator(".bn-editor table").first());
    const clip = { x: hr.x - 40, y: hr.y - 8, width: 693, height: tr.y + tr.height + 24 - (hr.y - 8) };
    await page.screenshot({ path: out("plan-note-from-chat"), clip });
    await ctx.close();
  },

  // proofing-notes.pdf を素材に入れ、ノートの横のピークで 1 文を選ぶ → ピルに Quote in note / Save as memo。
  // 画面は 1440 幅（ピークは 480 固定幅で、ノート側が広い）。ノートの本文〜ピークのピルの帯を切る
  async "pdf-peek-quote-in-note"() {
    resetMedia();
    const pdf = await makePdf("proofing-notes.pdf", [
      ["Proofing", "Let the dough rest for an hour at room temperature.", "Shape the loaf gently and keep the seam on the bottom.", "Bake at 220 C for 30 minutes."],
    ]);
    const s0 = await newSession({ width: 1440 });
    await openApp(s0.page);
    await uploadPdf(s0.page, pdf, "proofing-notes.pdf");
    await s0.ctx.close();
    const id = "c8000000-0000-4000-8000-000000000001";
    seedQuoteNote(id, "Proofing notes", "Notes on proofing. See ", "proofing-notes.pdf");
    const { ctx, page } = await newSession({ width: 1440 });
    await openNote(page, id);
    await page.locator(".bn-editor").getByText("@proofing-notes.pdf").first().click();
    await page.waitForTimeout(2500);
    await putCursorOnLastLine(page);
    await selectPdfText(page, "Let the dough rest for an hour at room temperature.");
    await page.getByText("Quote in note").first().waitFor({ state: "visible", timeout: 8000 });
    await page.mouse.move(420, 700);
    await page.waitForTimeout(600);
    const line = await rectOf(page.locator(".bn-editor [data-content-type='paragraph']").first());
    const clip = { x: 300, y: line.y - 20, width: 1120, height: 200 };
    await page.screenshot({ path: out("pdf-peek-quote-in-note"), clip });
    await ctx.close();
  },

  // bread-steps.pdf（2 ページ）の 2 ページ目の 1 文を Quote in note で引用し、
  // 引用ブロックの印から Open source → 横に PDF が開き、引用した文に印が付く
  async "pdf-quote-open-source"() {
    resetMedia();
    const pdf = await makePdf("bread-steps.pdf", [
      ["Mixing", "Mix the flour, water and starter until no dry flour is left.", "Let the dough rest for 30 minutes."],
      ["Shaping", "Shape the loaf. Rest 10 minutes. Bake at 220 C.", "Cool on a rack before slicing."],
    ]);
    const s0 = await newSession({ width: 1440 });
    await openApp(s0.page);
    await uploadPdf(s0.page, pdf, "bread-steps.pdf");
    await s0.ctx.close();
    const id = "c8000000-0000-4000-8000-000000000002";
    seedQuoteNote(id, "Bread steps", "Bread steps. See ", "bread-steps.pdf");
    const { ctx, page } = await newSession({ width: 1440 });
    await openNote(page, id);
    await page.locator(".bn-editor").getByText("@bread-steps.pdf").first().click();
    await page.waitForTimeout(2500);
    await putCursorOnLastLine(page);
    // 2 ページ目の文を選んで引用する
    await page.locator("[data-page-number='2']").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await selectPdfText(page, "Rest 10 minutes.");
    await page.getByText("Quote in note").first().click();
    await page.waitForTimeout(1500);
    // 保存して（⌘S → Saved）、ピークを閉じ、引用ブロックの印から Open source
    await page.keyboard.press("Meta+s");
    await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "Close", exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const quote = page.locator(".bn-editor [data-content-type='quote']").first();
    await quote.hover();
    await page.waitForTimeout(500);
    await page.locator("[data-memo-chip][aria-label^='Memo']").first().click();
    await page.getByRole("button", { name: "Open source", exact: true }).first().click();
    // ピークが PDF の 2 ページ目に開き、引用した文に印が付くまで待つ
    await page.locator("[data-page-number='2'] mark, [data-page-number='2'] [class*='highlight']").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.mouse.move(420, 700);
    const line = await rectOf(page.locator(".bn-editor [data-content-type='paragraph']").first());
    await page.screenshot({ path: out("pdf-quote-open-source"), clip: { x: 300, y: line.y - 20, width: 1100, height: 250 } });
    await ctx.close();
  },

  // 本物のアプリの設定には Copilot の行（デスクトップ専用）が出ないので、Storybook の Chooser で撮る
  async "settings-ai-connect"() {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2, locale: "en-US" });
    await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
    const page = await ctx.newPage();
    await page.goto(`${SB}?id=molecules-aiconnect--chooser&viewMode=story`);
    const frame = page.locator("#storybook-root > div").first();
    await frame.waitFor({ state: "visible" });
    await page.getByText("Where do you want to connect?").waitFor({ state: "visible" });
    await page.waitForTimeout(1500);
    await frame.screenshot({ path: out("settings-ai-connect") });
    await ctx.close();
  },

  // スマホ表示で Write を押し、メモを 1 行書く（送信はしない）
  async "mobile-memo-input"() {
    const { ctx, page } = await newSession({ mobile: true });
    await openApp(page);
    await page.getByRole("button", { name: /^Write$/ }).first().click();
    const box = page.locator("textarea").first();
    await box.waitFor({ state: "visible", timeout: 10000 });
    await box.fill("Crumb looks better when the ferment runs 45 min.");
    await page.waitForTimeout(800);
    await page.locator("textarea").first().blur();
    await page.screenshot({ path: out("mobile-memo-input") });
    await ctx.close();
  },

  async "note-proposals-adopt"() {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2, locale: "en-US" });
    await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
    const page = await ctx.newPage();
    await page.goto(`${SB}?id=sharing-noteproposalspanel--manual-english&viewMode=story`, { waitUntil: "load" });
    await page.getByText("Adopt selected changes").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out("note-proposals-adopt") });
    await ctx.close();
  },
};

for (const [name, fn] of Object.entries(SHOTS)) {
  if (!want(name)) continue;
  console.log(`== ${name}`);
  await fn();
}
await browser.close();
console.log(`出力先: ${OUT}`);
