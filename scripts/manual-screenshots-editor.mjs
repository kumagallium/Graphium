/**
 * マニュアル用スクリーンショット撮影（エディタ・メモ・一覧まわりの図をまとめて）
 *
 * 旧サイドバー（+ Memo ボタン等）の時代に撮った図を、現行 UI で撮り直す。
 * 対象: first-note / editor-plain / at-mention / find-in-note / history / math-editor /
 *       memo-picker / drag-handle-menu / template-picker / notes-list /
 *       folder-rename-inline / quick-memo / memo-gallery
 * （slash-menu は manual-screenshots-slash-menu.mjs を使う）
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port 5967 --strictPort --host 127.0.0.1               # 別ターミナル
 *   node scripts/manual-screenshots-editor.mjs --port 5967 --api 3967
 *   node scripts/manual-screenshots-editor.mjs --port 5967 --api 3967 --only history
 *
 * オプション:
 *   --port <port>   vite のポート（既定 5967）
 *   --api <port>    API のポート（既定 3967。作った資料の後片付けに使う）
 *   --only <name>   1 枚だけ撮る（カンマ区切りで複数可）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *
 * 前提: パン作りの見本データ（Trial 1〜7・Reading notes 等）が入った隔離データ。
 * 各図は自分が作る資料（題名が "Shot:" で始まらないもの）を撮影前に API で消してから
 * 作り直すので、何度流しても重複しない。
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる。閉じないとオーバーレイが
 *   すべてのクリックを横取りする
 * - Service Worker を block しないと PWA の自動リロードが入力と競合する
 * - 保存は ⌘S のあと "Saved" を待つ（"Unsaved" を写さない）
 * - 撮影前にマウスを何もない所へ逃がす（hover 跡・ツールチップ防止）
 * - ノート一覧からのクリックはサイドピークで開く。メインで撮るなら #note/<id> へ直接遷移
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const port = parseInt(opt("--port", "5967"), 10);
const apiPort = parseInt(opt("--api", "3967"), 10);
const only = opt("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = resolve(opt("--out", resolve(__dirname, "../manual/public/screenshots")));
mkdirSync(OUT, { recursive: true });

const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const API = `http://127.0.0.1:${apiPort}/api/storage`;
const VIEWPORT = { width: 1280, height: 800 };
const shotPath = (name) => resolve(OUT, `${name}.png`);

// --- 後片付け: 撮影用に作った資料を題名で消す ---
async function deleteNotesByTitle(titles) {
  const list = await (await fetch(`${API}/notes`)).json();
  for (const f of list) {
    const doc = await (await fetch(`${API}/notes/${f.id}`)).json();
    if (titles.includes(doc.title)) {
      await fetch(`${API}/notes/${f.id}`, { method: "DELETE" });
      console.log(`  (cleanup) deleted note: ${doc.title}`);
    }
  }
}
// このスクリプトが作る資料の題名（撮影のたびに消す）
const CREATED = [
  "Bread dough trial #3",
  "Editor tour",
  "Sourdough starter log",
  "Reading: gluten development",
];
async function findNoteId(title) {
  const list = await (await fetch(`${API}/notes`)).json();
  for (const f of list) {
    const doc = await (await fetch(`${API}/notes/${f.id}`)).json();
    if (doc.title === title) return f.id;
  }
  return null;
}

const browser = await chromium.launch({ headless: true });

async function openApp(hash = "") {
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
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) {
    await welcome.click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const titleBox = (page) => page.locator('textarea[placeholder="Note title"]').first();
const editorOf = (page) => page.locator(".bn-editor").first();

// 新規ノートを作って題名を入れる（+ Note 直後はフォーカスがボタンに残る）
async function newNote(page, title) {
  await page.getByRole("button", { name: "+ Note", exact: true }).click();
  await page.waitForTimeout(800);
  await titleBox(page).fill(title);
  await page.waitForTimeout(200);
}
// 本文を打つ。段落ごとに Enter
async function typeLines(page, lines) {
  await editorOf(page).click();
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
}
async function save(page) {
  await page.keyboard.press("Meta+s");
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
}
// 撮影直前: マウスを逃がし、ツールチップ・トーストが無いことを確かめる
async function settle(page, ms = 400, x = 1000, y = 760) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(ms);
}
async function shoot(page, name, clip) {
  await page.screenshot({ path: shotPath(name), ...(clip ? { clip } : {}) });
  console.log(`  ✓ ${shotPath(name)}`);
}

const figures = {};

// ------------------------------------------------------------------ first-note
figures["first-note"] = async () => {
  await deleteNotesByTitle(["Bread dough trial #3"]);
  const { ctx, page } = await openApp();
  await newNote(page, "Bread dough trial #3");
  await typeLines(page, [
    "Trying a longer ferment than trial #2.",
    "Bread flour 300 g / water 200 g / dry yeast 3 g / salt 5 g",
    "Hunch: the crumb was dense last time because the proof was too short.",
  ]);
  await save(page);
  await settle(page);
  await shoot(page, "first-note");
  await ctx.close();
};

// ------------------------------------------------------------------ 共通の素材
// 「Editor tour」: 段落 1 つ + Formula ブロック（H = W/F）。math-editor / find-in-note /
// drag-handle-menu / memo-picker / template-picker が共有する
async function makeEditorTour(page) {
  await newNote(page, "Editor tour");
  await editorOf(page).click();
  await page.keyboard.type("Hydration is the ratio of water to flour by weight.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/formula");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  // 視覚モード（Write with symbols）で H=W/F。`/` で分数になる
  await page.keyboard.type("H=W/F");
  await page.waitForTimeout(500);
}
async function seedMemos() {
  await fetch(`${API}/appdata/captures`, { method: "DELETE" });
  const { ctx, page } = await openApp();
  // 新しい順に並ぶので、Oven が先頭に来るよう逆順で作る
  for (const t of [
    "Crumb looks better when the ferment runs 45 min.",
    "Ask the bakery why they cold-proof overnight.",
    "Oven runs ~8 °C cool at the 200 °C setting.",
  ]) {
    await page.keyboard.press("Meta+Shift+m");
    await page.waitForTimeout(700);
    await page.keyboard.type(t);
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(1200);
  }
  await ctx.close();
}

// ------------------------------------------------------------------ math-editor
figures["math-editor"] = async () => {
  await deleteNotesByTitle(["Editor tour"]);
  const { ctx, page } = await openApp();
  await makeEditorTour(page);
  await save(page);
  // 描画済みの数式をクリックして編集モードに入る（内容は変えないので Saved のまま）
  await page.locator(".katex").first().click();
  await page.waitForTimeout(700);
  await settle(page);
  await shoot(page, "math-editor");
  await ctx.close();
};

// ------------------------------------------------------------------ find-in-note
figures["find-in-note"] = async () => {
  await deleteNotesByTitle(["Editor tour"]);
  const { ctx, page } = await openApp();
  await makeEditorTour(page);
  await save(page);
  await page.locator(".bn-editor p, .bn-editor [data-content-type='paragraph']").first().click();
  await page.keyboard.press("Meta+f");
  await page.waitForTimeout(400);
  await page.keyboard.type("hydration");
  await page.waitForTimeout(600);
  await settle(page);
  await shoot(page, "find-in-note");
  await ctx.close();
};

// ------------------------------------------------------------------ drag-handle-menu
figures["drag-handle-menu"] = async () => {
  await deleteNotesByTitle(["Editor tour"]);
  const { ctx, page } = await openApp();
  await makeEditorTour(page);
  await save(page);
  const para = page.locator(".bn-block-content", { hasText: "Hydration is the ratio" }).first();
  // ハンドルは hover 後に出る。出るまで繰り返す
  const handle = page.locator(".bn-side-menu button").nth(1);
  for (let i = 0; i < 8; i++) {
    await para.hover();
    await page.waitForTimeout(400);
    if (await handle.isVisible().catch(() => false)) break;
  }
  await handle.click();
  await page.waitForTimeout(600);
  // 見出し上のメニューを撮るのでマウスは動かさない（メニューが閉じる）。ツールチップだけ避ける
  await page.mouse.move(1000, 600);
  await page.waitForTimeout(300);
  await shoot(page, "drag-handle-menu");
  await ctx.close();
};

// 「Editor tour」の 1 段落目の直後に空の段落を足して、そこで / を打つ（モーダル系の図用）
async function slashInTour(page, query) {
  await page.locator(".bn-block-content", { hasText: "Hydration is the ratio" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/" + query);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
}
// モーダルを開いたまま自動保存（3 秒）を待ち、ヘッダーを "Saved" にしてから撮る
async function waitSavedWithModal(page) {
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 12000 });
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------------ memo-picker
figures["memo-picker"] = async () => {
  await seedMemos();
  await deleteNotesByTitle(["Editor tour"]);
  const { ctx, page } = await openApp();
  await makeEditorTour(page);
  await save(page);
  await slashInTour(page, "memo");
  await page.getByText("Select memo", { exact: true }).waitFor({ state: "visible", timeout: 8000 });
  await waitSavedWithModal(page);
  await settle(page);
  await shoot(page, "memo-picker");
  await ctx.close();
};

// ------------------------------------------------------------------ template-picker
figures["template-picker"] = async () => {
  await deleteNotesByTitle(["Editor tour"]);
  const { ctx, page } = await openApp();
  await makeEditorTour(page);
  await save(page);
  await slashInTour(page, "template");
  await page.getByText("Insert Template", { exact: true }).waitFor({ state: "visible", timeout: 8000 });
  await waitSavedWithModal(page);
  await settle(page);
  await shoot(page, "template-picker");
  await ctx.close();
};

// ------------------------------------------------------------------ at-mention
figures["at-mention"] = async () => {
  await deleteNotesByTitle(["Sourdough starter log"]);
  const { ctx, page } = await openApp();
  await newNote(page, "Sourdough starter log");
  await typeLines(page, ["Day 5: doubled in 6 hours after feeding. Smells mildly sour."]);
  await save(page);
  // ⌘S のあとはフォーカスが外れるので、段落の末尾に戻る
  await page.locator(".bn-block-content", { hasText: "Day 5" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Compare with @calibration");
  await page.locator(".bn-suggestion-menu").first().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(500);
  // @ メニューは自動保存（3 秒後）で閉じてしまう。開いている間は "Unsaved" が出るので、
  // ヘッダーの保存状態の文字だけ隠して撮る（内容は何も偽らない）
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("span, div")) {
      if (el.children.length === 0 && el.textContent.trim() === "Unsaved") el.style.visibility = "hidden";
    }
  });
  await settle(page, 600, 900, 22);
  await shoot(page, "at-mention");
  await ctx.close();
};

// ------------------------------------------------------------------ history
// バージョンはブラウザ側（IndexedDB）に持つので、新しい文脈で撮れば毎回 v1 から始まる
figures["history"] = async () => {
  // 保存したバージョンはサーバーの appdata（snapshot-index:<noteId> と snapshot:<id>）に残るので、
  // 撮る前に消して v1 から作り直す（残っていると名前入力欄に前回の名前が入って二重になる）
  const noteId = await findNoteId("Trial 3 - 75% hydration, bread flour");
  const idxKey = encodeURIComponent(`snapshot-index:${noteId}`);
  const idxRes = await fetch(`${API}/appdata/${idxKey}`);
  if (idxRes.ok) {
    // `:` 入りのキーは DELETE API の対象外（キー規則）。索引を空配列で上書きして
    // 一覧から外す（中身の snapshot:<id> は孤児として残るが、見えない）
    await fetch(`${API}/appdata/${idxKey}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "[]",
    });
  }
  const { ctx, page } = await openApp(`#note/${noteId}`);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await page.waitForTimeout(1000);
  // 名前を付ける（鉛筆）
  await page.getByRole("button", { name: "Rename", exact: true }).first().click();
  await page.keyboard.type("First 75% attempt");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  // トーストが消えるのを待つ
  await page.waitForTimeout(5000);
  await settle(page, 400, 1090, 500);
  await shoot(page, "history");
  await ctx.close();
};

// ------------------------------------------------------------------ editor-plain
figures["editor-plain"] = async () => {
  await deleteNotesByTitle(["Reading: gluten development"]);
  const { ctx, page } = await openApp();
  await newNote(page, "Reading: gluten development");
  await editorOf(page).click();
  const type = (t) => page.keyboard.type(t);
  const key = (k) => page.keyboard.press(k);
  await type("## What the handbook says");
  await key("Enter");
  await type("Gluten forms when glutenin and gliadin hydrate and get worked mechanically.");
  await key("Enter");
  await type("- Higher hydration speeds gluten development");
  await key("Enter");
  await type("but makes the dough harder to shape");
  await key("Enter");
  await type("An autolyse rest lets the flour hydrate before kneading");
  await key("Enter");
  await key("Enter"); // 箇条書きを抜ける
  await type("/quote");
  await page.waitForTimeout(400);
  await key("Enter");
  await type("Rule of thumb: shape wet doughs with wet hands, not more flour.");
  await key("Enter");
  await key("Enter"); // 引用を抜ける
  await type("/table");
  await page.waitForTimeout(400);
  await key("Enter");
  await page.waitForTimeout(600);
  // 表: 1 行目が見出し行。Tab でセルを送って埋める
  const cells = ["Hydration", "Crumb", "Shaping", "65%", "tight", "easy"];
  for (let i = 0; i < cells.length; i++) {
    await type(cells[i]);
    if (i < cells.length - 1) await key("Tab");
  }
  await save(page);
  await settle(page, 400, 1090, 700);
  await shoot(page, "editor-plain");
  await ctx.close();
};

// ------------------------------------------------------------------ フォルダの下ごしらえ
// 見本ノートをフォルダに入れる（Bread: Trial 1〜3 / Reading: 読書メモ 2 本）。
// すでに入っていれば何もしない。データに残る（隔離データなので問題ない）
const FOLDER_PLAN = {
  Bread: [
    "Trial 1 - basic loaf at 65% hydration",
    "Trial 2 - 70% hydration",
    "Trial 3 - 75% hydration, bread flour",
  ],
  Reading: [
    "Reading notes - hydration and crumb structure",
    "Reading notes - fermentation temperature and time",
  ],
};
async function ensureFolders() {
  const { ctx, page } = await openApp();
  for (const [folder, titles] of Object.entries(FOLDER_PLAN)) {
    for (const title of titles) {
      const id = await findNoteId(title);
      if (!id) throw new Error(`note not found: ${title}`);
      await page.goto(`${BASE}#note/${id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      if (await page.getByRole("button", { name: folder, exact: true }).first().isVisible().catch(() => false)) {
        const has = await page.locator("button", { hasText: new RegExp(`^${folder}$`) }).count();
        if (has) continue;
      }
      await page.getByRole("button", { name: /Folder/ }).first().click();
      await page.waitForTimeout(500);
      await page.keyboard.type(folder);
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(800);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(3800); // 自動保存
      console.log(`  (folder) ${title} -> ${folder}`);
    }
  }
  await ctx.close();
}

// ------------------------------------------------------------------ notes-list
figures["notes-list"] = async () => {
  await ensureFolders();
  const { ctx, page } = await openApp();
  await page.getByText("All Notes", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  // 1280px 幅ではサイドバーを開いたままだと Folder / Created 列が省かれる（狭い幅の仕様）。
  // フォルダの色チップを見せるためサイドバーをたたんで撮る
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.waitForTimeout(800);
  await settle(page, 400, 640, 790);
  await shoot(page, "notes-list");
  await ctx.close();
};

// ------------------------------------------------------------------ folder-rename-inline
figures["folder-rename-inline"] = async () => {
  await ensureFolders();
  const { ctx, page } = await openApp();
  await page.getByText("All Notes", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  // サイドバーの All Notes を開いてフォルダを出す（左端の ›）
  await page.mouse.click(19, 193);
  await page.waitForTimeout(800);
  // 名前の文字の上に乗せると名前のツールチップが出るので、行の右寄り（件数の左）に置く
  const box = await page.getByText("Bread", { exact: true }).first().boundingBox();
  await page.mouse.move(150, box.y + box.height / 2);
  await page.waitForTimeout(250);
  await shoot(page, "folder-rename-inline", { x: 0, y: 0, width: 256, height: 254 });
  await ctx.close();
};

// ------------------------------------------------------------------ quick-memo
figures["quick-memo"] = async () => {
  const { ctx, page } = await openApp();
  await page.keyboard.press("Meta+Shift+m");
  await page.waitForTimeout(800);
  await page.keyboard.type("Crumb looks better when the ferment runs 45 min.");
  await page.waitForTimeout(400);
  await settle(page, 300, 1100, 650);
  // ダイアログ（約 575×250）に 40px ほどの余白を付けて切り抜く
  await shoot(page, "quick-memo", { x: 312, y: 100, width: 656, height: 290 });
  await ctx.close();
};

// ------------------------------------------------------------------ memo-gallery
figures["memo-gallery"] = async () => {
  await seedMemos();
  // ノートを開いた状態でギャラリーに入る（開いていないと「Open a note first」の案内が出る）
  const id = await findNoteId("Trial plan and log");
  const { ctx, page } = await openApp(`#note/${id}`);
  await page.waitForTimeout(1500);
  await page.getByText("Memos", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  // + ボタンと件数の切り替わり（フェード）が終わるまで待つ
  // Memos 行をクリックしたマウス・フォーカスが行に残ると、行の「+」が件数「3」に重なる。
  // マウスを本文側の空きへ逃がし、フォーカスも外して hover/focus の表示が消えるのを待つ
  await page.mouse.move(1400, 900);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(page, 1500, 1400, 900);
  await shoot(page, "memo-gallery");
  await ctx.close();
};

// ------------------------------------------------------------------ 実行
const names = only.length ? only : Object.keys(figures);
for (const n of names) {
  if (!figures[n]) {
    console.log(`unknown figure: ${n}`);
    continue;
  }
  console.log(`== ${n}`);
  await figures[n]();
  // 撮影用に作った資料は撮ったら消す（見本データの件数・候補メニューを汚さない）
  await deleteNotesByTitle(CREATED);
}
await browser.close();
