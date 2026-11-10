/**
 * マニュアル用スクリーンショット撮影（撮影手順が残っていなかったエディタまわり・左ナビ・見本の図）
 *
 * 対象（--only の名前）:
 *   collapsing-headings      見出しの折りたたみ（畳んだ見出しは矢印が出たまま）
 *   column-drop-guide        ブロックを別のブロックの右端へドラッグ中の「横に並べる」ガイド
 *   new-note-menu            + Note の ▾ メニュー（Blank note / Voice note / From a template…）
 *   template-edit            個人テンプレートの編集画面（Editing template の帯）
 *   template-list            テンプレート一覧（Storybook の TemplateListView）
 *   composer-open-alongside  ノートを編集中に開いた Composer（Enter で横に開く・右端のボタンで全画面）
 *   sample-walkthrough       見本モード（?demo=bread-en）の案内カードと記録された会話
 *   table-form-switch        データ表の ⠿ メニュー（本文の表に戻す項目）
 * （sidebar-tabs は Storybook の FileSidebar IA Proposal「タブごとの中身」から撮る。ここでは --only sidebar-tabs）
 *
 * 使い方:
 *   # パン作りの見本データ入りの隔離 DATA_DIR で API を起動し、ビルド済みアプリ（vite preview）を配信
 *   node scripts/manual-screenshots-editor-extra.mjs --port 5972 --api 3972 --data <DATA_DIR> --sb 6041
 *   node scripts/manual-screenshots-editor-extra.mjs --port 5972 --api 3972 --data <DATA_DIR> --only new-note-menu
 *
 * オプション:
 *   --port <port>   アプリ（Web）のポート（既定 5972）
 *   --api <port>    API のポート（既定 3972。ノートを PUT / DELETE する）
 *   --data <dir>    API の DATA_DIR（個人テンプレートを appdata に書く）
 *   --sb <port>     Storybook（静的ビルド可）のポート（既定 6041。template-list / sidebar-tabs だけが使う）
 *   --only <name>   1 枚だけ撮る（カンマ区切りで複数可）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *
 * 前提: パン作りの見本（public/demo/bread-en.json をシードした DATA_DIR）。AI は呼ばない。
 * 撮影用に作るノート・テンプレートは題名 "Shot:" ではなく図ごとの固定名で、撮影のたびに消して作り直す。
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる。閉じないとすべてのクリックを横取りする
 * - Service Worker を block しないと PWA の自動リロードが入力と競合する
 * - 保存は ⌘S のあと "Saved" を待つ。撮影前にマウスを空きへ逃がす（hover 跡・ツールチップ防止）
 * - HTML5 のドラッグは CDP の Input.setInterceptDrags + dispatchDragEvent で本物のドラッグにする
 *   （Playwright の dragTo は NodeSelection のドラッグで安定しない）。drop は送らず、ガイドが出た所で撮る
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const port = parseInt(opt("--port", "5972"), 10);
const apiPort = parseInt(opt("--api", "3972"), 10);
const sbPort = parseInt(opt("--sb", "6041"), 10);
const dataDir = opt("--data", "");
const only = opt("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
mkdirSync(OUT, { recursive: true });

const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const API = `http://127.0.0.1:${apiPort}/api/storage`;
const SB = `http://127.0.0.1:${sbPort}/iframe.html`;
const VIEWPORT = { width: 1280, height: 800 };
const shotPath = (name) => resolve(OUT, `${name}.png`);

const browser = await chromium.launch({ headless: true });

async function openApp(hash = "", { viewport = VIEWPORT, models = null, base = BASE, welcome = true } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "en-US", serviceWorkers: "block" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
    if (m) localStorage.setItem("graphium-llm-models", JSON.stringify(m));
  }, models);
  const page = await ctx.newPage();
  await page.goto(base + hash, { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Open Graphium", exact: true });
  await btn.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(1500);
  return { ctx, page };
}
async function settle(page, ms = 500, x = 1100, y = 700) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(ms);
}
async function shoot(page, name, clip) {
  await page.screenshot({ path: shotPath(name), ...(clip ? { clip } : {}) });
  console.log(`  ✓ ${shotPath(name)}`);
}

// --- ノートの書き込み（API）---
const NOW = "2026-11-08T09:00:00.000Z";
const P = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const t = (text, styles = {}) => ({ type: "text", text, styles });
const para = (id, text) => ({ id, type: "paragraph", props: P, content: [t(text)], children: [] });
const heading = (id, text, level = 2) => ({ id, type: "heading", props: { ...P, level, isToggleable: false }, content: [t(text)], children: [] });
const cell = (s) => ({ type: "tableCell", content: [t(s)], props: { colspan: 1, rowspan: 1, ...P } });
const table = (id, rows) => ({
  id,
  type: "table",
  props: { textColor: "default" },
  content: { type: "tableContent", columnWidths: rows[0].map(() => null), headerRows: 1, rows: rows.map((r) => ({ cells: r.map(cell) })) },
  children: [],
});
const mkDoc = (title, blocks) => ({
  version: 6,
  title,
  createdAt: NOW,
  modifiedAt: NOW,
  source: "human",
  pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
});
const uuid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function putNote(id, doc) {
  const r = await fetch(`${API}/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
  if (!r.ok) throw new Error(`PUT note ${id}: ${r.status}`);
}
async function deleteNote(id) {
  await fetch(`${API}/notes/${id}`, { method: "DELETE" });
}

const figures = {};

// ------------------------------------------------------------------ new-note-menu
figures["new-note-menu"] = async () => {
  const { ctx, page } = await openApp();
  // 「Voice note」は Tauri のときだけ出る項目（FileSidebar の isTauri 判定）。描画のたびに評価されるので、
  // 起動後に __TAURI__ を立てて ▾ を開く。偽装中にデスクトップ用の経路（sidecar 3001＝本番）へ出ていかないよう、
  // 3001 への通信はすべて止める
  await ctx.route(/:3001\//, (r) => r.abort());
  await page.evaluate(() => { window.__TAURI__ = {}; });
  // FileSidebar を描き直させる（タブを往復）。判定は FileSidebar の描画時に行われる
  await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Kind of new item" }).click();
  await page.getByRole("menuitem", { name: "Voice note" }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("menuitem", { name: /From a template/ }).waitFor({ state: "visible", timeout: 5000 });
  await settle(page, 300, 900, 600);
  // + Note のボタンと開いたメニューだけが収まる範囲（ボタン行とメニューの外接＋余白）
  // 撮影の演出: + Note の行とメニュー以外（背後のタブ列・Bring in files・一覧）は見えなくする（旧図と同じく背景色だけにする）。
  // 行の祖先をたどり、各階層で兄弟要素を visibility:hidden にする（メニューを含む要素は除く）。製品の表示崩れを隠す処理ではない
  await page.getByRole("button", { name: "Kind of new item" }).evaluate((el) => {
    const menu = document.querySelector('[role="menu"]');
    let cur = el.parentElement;
    while (cur && cur.parentElement && cur.parentElement !== document.body) {
      for (const sib of cur.parentElement.children) {
        if (sib === cur || (menu && sib.contains(menu))) continue;
        sib.style.visibility = "hidden";
      }
      cur = cur.parentElement;
    }
  });
  const nb = await page.getByRole("button", { name: "Kind of new item" }).evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
  const mb = await page.getByRole("menu").first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
  const nx = Math.min(nb.x, mb.x) - 4, ny = Math.min(nb.y, mb.y) - 2, nr = Math.max(nb.r, mb.r) + 4, nbm = Math.max(nb.b, mb.b) + 2;
  await shoot(page, "new-note-menu", { x: nx, y: ny, width: nr - nx, height: nbm - ny });
  await ctx.close();
};

// ------------------------------------------------------------------ composer-open-alongside
// ノートを編集中に ⌘K。ハイライトした行は Enter で横に開き、右端のボタン（Open full screen）で全画面に開く。
// 見本のノート「Oven temperature calibration」を開いて撮る（AI は未接続のまま。最近のノートの行だけを見せる）
figures["composer-open-alongside"] = async () => {
  const id = await findNoteId("Oven temperature calibration");
  const { ctx, page } = await openApp(`#note/${id}`, {});
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 15000 });
  await page.keyboard.press("Meta+k");
  const input = page.getByPlaceholder(/Find a note or ask AI/);
  await input.waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Recent notes", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1000);
  // ハイライトは行の上のマウスで付く。編集中のノートの次の行（右端に全画面ボタンがある行）に当てる
  // 一覧の下端で行が半分切れない viewport 高さを探す（スクロール領域の下端をまたぐ行が無い高さ）
  const straddles = () => page.evaluate(() => {
    const sc = [...document.querySelectorAll("*")].find((e) => {
      const r = e.getBoundingClientRect();
      return /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4 && r.width > 600 && /Recent notes/i.test(e.textContent);
    });
    if (!sc) return -1;
    const b = sc.getBoundingClientRect().bottom;
    return [...sc.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 30 && r.height < 90 && r.top < b - 2 && r.bottom > b + 2; }).length;
  });
  for (let h = 800; h <= 900; h += 4) {
    await page.setViewportSize({ width: 1280, height: h });
    await page.waitForTimeout(300);
    if ((await straddles()) === 0) break;
  }
  console.log("  composer viewport height", page.viewportSize().height);
  // 編集中のノートの次の行（最近のノートに Trial 3 は並ばない）
  await page.getByText("Trial 5 - overnight cold fermentation", { exact: true }).first().hover();
  await page.waitForTimeout(400);
  const box = await input.evaluate((el) => {
    let n = el;
    while (n.parentElement && (n.getBoundingClientRect().width < 600 || n.getBoundingClientRect().height < 300)) n = n.parentElement;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const pad = 16;
  await shoot(page, "composer-open-alongside", { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 });
  await ctx.close();
};

// ------------------------------------------------------------------ 個人テンプレートの書き込み（appdata）
const TEMPLATE_KEY = (id) => `user-template-${id}`;
async function putAppData(key, value) {
  const r = await fetch(`${API}/appdata/${encodeURIComponent(key)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`PUT appdata ${key}: ${r.status}`);
}
async function deleteAppData(key) {
  await fetch(`${API}/appdata/${encodeURIComponent(key)}`, { method: "DELETE" });
}
const COUNTRY_LOAF_ID = "e1000000-0000-4000-8000-0000000000c1";
async function seedCountryLoafTemplate() {
  const [h, a, b, c] = [1, 2, 3, 4].map((n) => uuid(900 + n));
  await putAppData(TEMPLATE_KEY(COUNTRY_LOAF_ID), {
    version: 1,
    id: COUNTRY_LOAF_ID,
    title: "Country loaf",
    description: "Mix, bulk ferment, shape and bake",
    createdAt: "2026-11-06T09:00:00.000Z",
    updatedAt: "2026-11-06T09:00:00.000Z",
    template: {
      name: "Country loaf",
      savedAt: "2026-11-06T09:00:00.000Z",
      pageTitle: "Country loaf",
      blocks: [
        heading(h, "Steps"),
        para(a, "Mix 500 g bread flour, 375 g water, 10 g salt and 5 g yeast"),
        para(b, "Bulk ferment 3 hours at 26 °C, folding every 30 minutes"),
        para(c, "Shape, proof 1 hour, bake 40 minutes at 240 °C"),
      ],
      labels: [[a, "step"], [b, "step"], [c, "step"]],
      attributes: [],
    },
  });
}

// ------------------------------------------------------------------ template-edit
// Templates の一覧 → 個人テンプレートの行の ⋯ → Edit contents。メインのエディタに「Editing template」の帯が出る
figures["template-edit"] = async () => {
  await seedCountryLoafTemplate();
  // 幅 1024: 左ナビが自動でたたまれ、帯の右端の Revert changes / Done まで 1 枚に入る
  const { ctx, page } = await openApp("", { viewport: { width: 1024, height: 800 } });
  await page.getByRole("button", { name: /^Templates/ }).first().click();
  await page.getByText("Country loaf", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: /Country loaf/ }).last().click();
  await page.getByText("Edit contents", { exact: true }).click();
  await page.getByText("Editing template", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  // 帯・題名・本文・Steps パネルを 1 枚に収める。保存は自動なので "Saved" を待つ
  if (await page.getByRole("button", { name: "Collapse sidebar" }).count()) await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000);
  await settle(page, 400, 600, 760);
  await shoot(page, "template-edit", { x: 0, y: 0, width: 1024, height: 410 });
  await ctx.close();
};

async function findNoteId(title) {
  const list = await (await fetch(`${API}/notes`)).json();
  for (const f of list) {
    const doc = await (await fetch(`${API}/notes/${f.id}`)).json();
    if (doc.title === title) return f.id;
  }
  throw new Error(`ノートが見つかりません: ${title}`);
}

// ------------------------------------------------------------------ template-list
// Storybook の TemplateListView（Default）。公式・自分・共有のテンプレートが 1 つの表に並ぶ。
// 共有フォルダ bakery-share の行は実アプリでは共有フォルダの設定が要るので、ストーリーで撮る
figures["template-list"] = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`${SB}?id=template-templatelistview--default&viewMode=story`);
  await page.getByText("Baguette scoring", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(800);
  await settle(page, 300, 640, 760);
  await shoot(page, "template-list");
  await ctx.close();
};

// ------------------------------------------------------------------ table-form-switch
// 240 行の本文の表を作り、⠿ メニューの「Turn into a data table」で本物のデータ表（CSV 素材）にしてから、
// もう一度 ⠿ を開いて「Turn into a note table」が並ぶメニューを撮る
const OVEN_NOTE_ID = uuid(7001);
const OVEN_NOTE_TITLE = "Oven warm-up log";
async function openHandleMenu(page, blockLocator) {
  const handle = page.locator(".bn-side-menu button").nth(1);
  for (let i = 0; i < 10; i++) {
    await blockLocator.hover();
    await page.waitForTimeout(400);
    if (await handle.isVisible().catch(() => false)) break;
  }
  await handle.click();
  await page.waitForTimeout(600);
}
figures["table-form-switch"] = async () => {
  await deleteNote(OVEN_NOTE_ID);
  const rows = [["minute", "temp_c", "humidity"]];
  for (let i = 0; i < 240; i++) {
    const temp = Math.min(180 + 0.8 * i, 235) + 2 * Math.sin(i / 3.3);
    rows.push([String(i), temp.toFixed(1), Math.max(35, 45 - i * 0.04).toFixed(1)]);
  }
  const tid = uuid(7002);
  const doc = mkDoc(OVEN_NOTE_TITLE, [para(uuid(7003), "Warm-up of the home oven, one reading per minute."), table(tid, rows)]);
  doc.pages[0].tableMeta = { [tid]: { caption: "Oven log" } };
  await putNote(OVEN_NOTE_ID, doc);
  const { ctx, page } = await openApp(`#note/${OVEN_NOTE_ID}`);
  await page.locator("table").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  await openHandleMenu(page, page.locator(".bn-block-content", { has: page.locator("table") }).first());
  await page.getByText("Turn into a data table", { exact: true }).first().click();
  await page.locator("[data-data-table-block]").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  await openHandleMenu(page, page.locator(".bn-block-outer:has([data-data-table-block])").first());
  await page.getByText("Turn into a note table", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotPath("table-form-switch"), clip: { x: 285, y: 206, width: 540, height: 350 } });
  console.log(`  ✓ ${shotPath("table-form-switch")}`);
  await ctx.close();
  await deleteNote(OVEN_NOTE_ID);
};

// ------------------------------------------------------------------ collapsing-headings
// 見出しの ▸ をクリックして「Bulk ferment」の下を畳む。畳んだ見出しは矢印が出たまま。
// ほかの見出しはマウスが外れていれば普通の見出しのまま
const SOURDOUGH_NOTE_ID = uuid(7101);
figures["collapsing-headings"] = async () => {
  await deleteNote(SOURDOUGH_NOTE_ID);
  await putNote(
    SOURDOUGH_NOTE_ID,
    mkDoc("Sourdough — second attempt", [
      heading(uuid(7111), "Starter"),
      para(uuid(7112), "Fed 1:2:2 at 9 a.m. Doubled in 5 h at 24 °C."),
      para(uuid(7113), "Smelled sharper than last week — more acetic than lactic."),
      heading(uuid(7114), "Bulk ferment"),
      para(uuid(7115), "Dough doubled in 4 h at 26 °C. The surface stayed smooth and slightly domed."),
      para(uuid(7116), "Poke test: the dent springs back slowly, so the gluten still has tension left."),
      heading(uuid(7117), "Bake"),
      para(uuid(7118), "250 °C covered for 20 min, 230 °C open for 25 min."),
    ]),
  );
  const { ctx, page } = await openApp(`#note/${SOURDOUGH_NOTE_ID}`);
  const bulk = page.locator(".bn-block-content[data-content-type=heading]", { hasText: "Bulk ferment" }).first();
  await bulk.waitFor({ state: "visible", timeout: 20000 });
  await bulk.hover();
  await page.waitForTimeout(300);
  await bulk.locator(".gph-heading-toggle").click();
  await page.waitForTimeout(500);
  await page.getByText("Dough doubled in 4 h").first().waitFor({ state: "hidden", timeout: 5000 });
  // マウスは空きへ逃がす。畳んだ見出しだけ矢印が出たままで、展開中の見出しは普通の見出しに見える
  await settle(page, 500, 1100, 700);
  await page.screenshot({ path: shotPath("collapsing-headings"), clip: { x: 280, y: 60, width: 880, height: 430 } });
  console.log(`  ✓ ${shotPath("collapsing-headings")}`);
  await ctx.close();
  await deleteNote(SOURDOUGH_NOTE_ID);
};

// ------------------------------------------------------------------ column-drop-guide
// 「Poke test」の行の ⠿ を、上の段落の右端へドラッグ中。落とせる場所が「Place side by side」の帯と縦の線で出る。
// CDP の本物のドラッグ（Input.setInterceptDrags）で dragenter / dragover まで送り、drop は送らずに撮る
const COLUMN_NOTE_ID = uuid(7201);
figures["column-drop-guide"] = async () => {
  await deleteNote(COLUMN_NOTE_ID);
  await putNote(
    COLUMN_NOTE_ID,
    mkDoc("Bulk ferment log", [
      heading(uuid(7211), "Bulk ferment"),
      para(uuid(7212), "Dough doubled in 4 h at 26 °C. The surface stayed smooth and slightly domed."),
      para(uuid(7213), "Poke test: the dent springs back slowly, so the gluten still has tension left."),
      para(uuid(7214), "Shaped at 15:40 and moved to the banneton."),
    ]),
  );
  const { ctx, page } = await openApp(`#note/${COLUMN_NOTE_ID}`);
  const first = page.locator(".bn-block-content", { hasText: "Dough doubled in 4 h" }).first();
  const poke = page.locator(".bn-block-content", { hasText: "Poke test" }).first();
  await poke.waitFor({ state: "visible", timeout: 20000 });
  const handle = page.locator(".bn-side-menu button").nth(1);
  for (let i = 0; i < 10; i++) {
    await poke.hover();
    await page.waitForTimeout(400);
    if (await handle.isVisible().catch(() => false)) break;
  }
  const hb = await handle.boundingBox();
  const fb = await first.boundingBox();
  const sx = hb.x + hb.width / 2;
  const sy = hb.y + hb.height / 2;
  const tx = fb.x + fb.width - 24; // 右の 3 分の 1（カラム化ゾーン）の中
  const ty = fb.y + fb.height / 2;
  // ⠿ に dragstart、ドロップ先に dragenter / dragover を DOM イベントで送る（drop は送らない）。
  // 実マウスや CDP で掴むと、掴んだ時点でハンドルのメニューまで開いてしまい、画面を覆うため
  await page.evaluate(
    async ({ sx, sy, tx, ty }) => {
      const handleEl = document.querySelector(".bn-side-menu button[draggable=true]");
      const dt = new DataTransfer();
      const mk = (type, x, y) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y });
      handleEl.dispatchEvent(mk("dragstart", sx, sy));
      await new Promise((r) => setTimeout(r, 100));
      for (let i = 0; i < 6; i++) {
        const x = tx - i;
        const el = document.elementFromPoint(x, ty) ?? document.body;
        if (i === 0) el.dispatchEvent(mk("dragenter", x, ty));
        el.dispatchEvent(mk("dragover", x, ty));
        await new Promise((r) => setTimeout(r, 80));
      }
    },
    { sx, sy, tx, ty },
  );
  // 掴んでいる行（Poke test）の脇にハンドルが残って見えるよう、マウスを元の位置へ戻す
  await page.mouse.move(sx + 260, sy); // ⠿ の上に置くとツールチップが出るので、同じ行の文字の上へ
  await page.waitForTimeout(500);
  if (await page.getByText("Duplicate", { exact: true }).isVisible()) {
    await handle.evaluate((el) => el.click());
    await page.waitForTimeout(300);
  }
  await page.mouse.move(tx, ty, { steps: 14 });
  await page.mouse.move(tx - 2, ty, { steps: 3 });
  // 掴んでいる行（Poke test）の脇にハンドルが残って見えるよう、マウスを元の位置へ戻す
  await page.mouse.move(sx + 260, sy); // ⠿ の上に置くとツールチップが出るので、同じ行の文字の上へ
  await page.waitForTimeout(500);
  if (await page.getByText("Duplicate", { exact: true }).isVisible()) throw new Error("ハンドルのメニューが開いたまま");
  await page.getByText("Place side by side", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
  const hbox = await page.locator(".bn-block-content", { hasText: "Bulk ferment" }).first().boundingBox();
  await page.screenshot({ path: shotPath("column-drop-guide"), clip: { x: hb.x - 50, y: hbox.y - 4, width: 800, height: 170 } });
  console.log(`  ✓ ${shotPath("column-drop-guide")}`);
  await page.keyboard.press("Escape").catch(() => {});
  await ctx.close();
  await deleteNote(COLUMN_NOTE_ID);
};

// ------------------------------------------------------------------ sample-walkthrough
// 見本モード（?demo=bread-en）。案内カードを 3 つ目（A chat, recorded）まで進め、記録された会話を開いた状態を撮る。
// 見本は自分の保存先（隔離したメモリ上）で動き、API には書かない
figures["sample-walkthrough"] = async () => {
  const { ctx, page } = await openApp("?demo=bread-en");
  await page.getByText("Step 1 of 3", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < 6; i++) {
    if (await page.getByText("A chat, recorded", { exact: true }).isVisible()) break;
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForTimeout(1500);
  }
  await page.getByText("A chat, recorded", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("30% Wheat Hydration", { exact: false }).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000);
  await settle(page, 400, 600, 20);
  await shoot(page, "sample-walkthrough");
  await ctx.close();
};

// ------------------------------------------------------------------ sidebar-tabs
// Storybook「Components/FileSidebar IA Proposal」の「タブごとの中身」（TabsEachTab）。左ナビを 4 タブぶん並べる。
// ストーリーが各列の上に付けている日本語の見出し（ノート / ナレッジ …）は図には要らないので、撮る間だけ隠す
// （ストーリー側の見出しで、製品の表示ではない）
figures["sidebar-tabs"] = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`${SB}?id=components-filesidebar-ia-proposal--tabs-each-tab&viewMode=story`);
  await page.locator("[data-variant=chat]").waitFor({ state: "visible", timeout: 30000 });
  await page.getByText("Proofing temperature for brioche", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    for (const box of document.querySelectorAll("[data-variant]")) {
      const label = box.previousElementSibling;
      if (label) label.style.visibility = "hidden";
    }
  });
  await settle(page, 300, 1270, 890);
  const boxes = await page.locator("[data-variant]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const pad = 14;
  await shoot(page, "sidebar-tabs", { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 });
  await ctx.close();
};

// ------------------------------------------------------------------ 実行
const names = Object.keys(figures);
for (const n of names) {
  if (only.length && !only.includes(n)) continue;
  console.log(`# ${n}`);
  await figures[n]();
}
await browser.close();
