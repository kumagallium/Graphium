/**
 * マニュアル用スクリーンショット撮影（エディタ・メモ・一覧まわりの図をまとめて）
 *
 * 旧サイドバー（+ Memo ボタン等）の時代に撮った図を、現行 UI で撮り直す。
 * 対象: first-note / editor-plain / at-mention / find-in-note / history / math-editor /
 *       memo-picker / drag-handle-menu / template-picker / notes-list /
 *       folder-rename-inline / quick-memo / memo-gallery
 * 追加分: note-more-menu / note-a4-width / folder-picker / claims-picker /
 *         memo-gallery-selection / trash-archive / chat-answer
 *         （1 枚ずつ: --only note-a4-width。trash-archive は撮影用ノートを作ってゴミ箱へ送る。
 *          chat-answer は Trial 3 の chats を一時的に書き、撮影後に元の JSON へ戻す。AI は呼ばない）
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

async function openApp(hash = "", { viewport = VIEWPORT, models = null, settings = null } = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
    serviceWorkers: "block",
  });
  await ctx.addInitScript(([m, st]) => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
    if (m) localStorage.setItem("graphium-llm-models", JSON.stringify(m));
    if (st) localStorage.setItem("graphium-settings", JSON.stringify(st));
  }, [models, settings]);
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

// ------------------------------------------------------------------ 追加分の共通
// AI モデルの seed（Title with AI など AI 接続が要る項目を出すだけ。呼びはしない）
const SAMPLE_MODELS = [
  { id: "m1", name: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet", apiKey: "dummy", apiBase: null },
];
const TRIAL3 = "Trial 3 - 75% hydration, bread flour";
// BlockNote の ⠿ ハンドルなど撮影の邪魔を隠す
async function hideHandles(page) {
  await page.addStyleTag({ content: ".bn-side-menu{visibility:hidden!important}" });
}
async function hideUnsaved(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("span, div")) {
      if (el.children.length === 0 && el.textContent.trim() === "Unsaved") el.style.visibility = "hidden";
    }
  });
}
// 要素の外接矩形に余白を足したクリップ
async function clipOf(page, loc, pad = 12) {
  const b = await loc.boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
}
// 浮いたパネル（メニュー・ダイアログ）だけを残し、背景（暗幕・裏のサイドバー等）を隠す。
// 角丸の外に背景の切れ端が写り込むのを防ぐ。撮影後に context ごと閉じるので元へは戻さない
async function isolate(page, loc) {
  await loc.evaluate((el) => el.setAttribute("data-iso", "1"));
  await page.addStyleTag({ content: "body *{visibility:hidden!important}[data-iso],[data-iso] *{visibility:visible!important}" });
}
async function putNote(id, mutate) {
  const doc = await (await fetch(`${API}/notes/${id}`)).json();
  mutate(doc);
  await fetch(`${API}/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
}

// ------------------------------------------------------------------ note-more-menu
// 保存済みノートの右上 ⋯ メニュー（Full width / A4・保存・書き出し・複製など）
figures["note-more-menu"] = async () => {
  const id = await findNoteId(TRIAL3);
  const { ctx, page } = await openApp(`#note/${id}`, { viewport: { width: 1280, height: 1100 }, models: SAMPLE_MODELS });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Menu", exact: true }).first().click();
  await page.waitForTimeout(600);
  const panel = page.locator("div.fixed.w-60.overflow-y-auto").first();
  await panel.waitFor({ state: "visible", timeout: 8000 });
  await page.mouse.move(100, 1000);
  await page.waitForTimeout(500);
  await isolate(page, panel);
  await page.waitForTimeout(300);
  await shoot(page, "note-more-menu", await clipOf(page, panel, 14));
  await ctx.close();
};

// ブロックのヘルパー（隔離データへ直接書くノート用。型は GraphiumDocument version 6）
const bp = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const blk = (type, text, props = {}) => ({
  id: crypto.randomUUID(),
  type,
  props: { ...bp, ...props },
  content: [{ type: "text", text, styles: {} }],
  children: [],
});
// 新しいノートを API へ直接書く。同じ題のものは先に消す
async function createNoteDoc(title, blocks, extra = {}) {
  await deleteNotesByTitle([title]);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc = {
    version: 6,
    title,
    pages: [{ id: "main", title, blocks }],
    source: "human",
    createdAt: now,
    modifiedAt: now,
    ...extra,
  };
  await fetch(`${API}/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
  return id;
}
CREATED.push("Sourdough hydration report");

// ------------------------------------------------------------------ note-a4-width
// A4 幅のノート（机・紙・影・点線と "Page 2"）。1440×900、右パネルは閉じる
figures["note-a4-width"] = async () => {
  const T = "Sourdough hydration report";
  const sections = [
    ["Method", [
      "Sourdough sandwich loaves were baked at four hydration levels while every other condition was held constant. Each loaf used the same starter, the same flour lot and the same oven profile.",
      "Flour and water were mixed and rested for 40 minutes before the starter and salt went in. Mixing was done by hand so that dough temperature stayed close to 24 degrees across the series.",
      "Loaves were shaped on a lightly floured bench, placed in lined baskets and proofed at room temperature until a gentle poke sprang back slowly.",
    ]],
    ["Results", [
      "The baseline loaf at 65% hydration gave a fine, tight crumb with small even holes. Raising hydration to 70% opened the crumb and lightened the loaf, but the dough became harder to shape.",
      "At 75% hydration the crumb was the most open of the series. Shaping needed wet hands and a bench scraper, and the loaf spread slightly during the final proof.",
      "At 80% the dough could not hold a shape without a tin. The crumb was glossy and uneven, with a few very large tunnels near the crust.",
    ]],
    ["Discussion", [
      "Oven temperature was checked with a separate probe before each bake. The oven ran about 8 degrees cool at the 200 degree setting, so all bakes were compensated at the loaf level.",
      "Open crumb appears to depend on both hydration and handling. The wetter doughs were folded in the bowl rather than kneaded, which may account for part of the difference.",
      "Crust color tracked hydration closely: the wetter loaves browned faster and developed a thinner, crisper shell.",
    ]],
    ["Next steps", [
      "Fermentation time was fixed at 45 minutes for the bulk stage and 60 minutes for the final proof. Longer ferments will be tested in the next series.",
      "A second flour lot with a higher protein content will be compared at 70% and 75% to see whether the open crumb survives a stronger gluten network.",
      "Finally, each loaf will be sliced and photographed on the same board so crumb structure can be compared side by side.",
    ]],
  ];
  const blocks = [blk("heading", "Hydration and crumb structure", { level: 1 })];
  for (const [h, ps] of sections) {
    blocks.push(blk("heading", h, { level: 2 }));
    for (const t of ps) blocks.push(blk("paragraph", t));
  }
  const id = await createNoteDoc(T, blocks, { paperSize: "a4" });
  const { ctx, page } = await openApp(`#note/${id}`, { viewport: { width: 1440, height: 1400 } });
  await page.waitForTimeout(2500);
  await hideHandles(page);
  // 紙の上端が見える先頭のまま（縦に長いウィンドウで 1 ページ目の下端の点線と "Page 2" まで収める）
  await page.getByText("Page 2", { exact: true }).first().waitFor({ state: "attached", timeout: 10000 });
  await page.waitForTimeout(600);
  await hideUnsaved(page);
  await settle(page, 600, 1420, 1380);
  // 左サイドバーを除き、机・紙・点線・Page 2 が主役になる範囲で切り抜く
  await shoot(page, "note-a4-width", { x: 256, y: 0, width: 1184, height: 1400 });
  await ctx.close();
};

// ------------------------------------------------------------------ folder-picker
// 題の下の Folder ボタンから開いた候補（検索欄 + 既存フォルダ。現行 UI に No folder 行は無い）
figures["folder-picker"] = async () => {
  const id = await findNoteId("Oven temperature calibration");
  const { ctx, page } = await openApp(`#note/${id}`);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Folder/ }).first().click();
  await page.waitForTimeout(700);
  const search = page.getByPlaceholder(/Search folders/).first();
  await search.waitFor({ state: "visible", timeout: 8000 });
  const pop = search.locator("xpath=ancestor::div[contains(@class,'shadow')][1]");
  await page.mouse.move(1100, 700);
  await page.waitForTimeout(500);
  const btn = page.getByRole("button", { name: /Folder/ }).first();
  // プレースホルダー全体（…まで）が収まるよう候補の幅を少し広げる
  await pop.evaluate((el) => { el.style.width = el.getBoundingClientRect().width + 56 + "px"; });
  await page.waitForTimeout(300);
  const pb = await pop.boundingBox();
  const bb = await btn.boundingBox();
  await page.addStyleTag({ content: ".bn-editor,textarea[placeholder='Note title']{visibility:hidden!important}" });
  const x = Math.min(pb.x, bb.x) - 12, y = Math.max(0, bb.y - 16);
  await shoot(page, "folder-picker", { x, y, width: Math.max(pb.x + pb.width, bb.x + bb.width) + 12 - x, height: pb.y + pb.height + 12 - y });
  await ctx.close();
};

// ------------------------------------------------------------------ claims-picker
// スラッシュメニューの Claims から開く引用ピッカー（2〜3 件チェック・N selected・Insert）
CREATED.push("Hydration summary draft");
figures["claims-picker"] = async () => {
  const id = await createNoteDoc("Hydration summary draft", [
    blk("paragraph", "What we know so far about hydration and crumb structure in the sourdough trials."),
  ]);
  const { ctx, page } = await openApp(`#note/${id}`);
  await page.waitForTimeout(1500);
  await page.locator(".bn-block-content", { hasText: "What we know so far" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/claims");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  const search = page.getByPlaceholder("Search by title…");
  await search.waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(800);
  for (const t of [
    "Set dial 15",
    "Oven dial reads about",
    "Opening the oven door drops",
  ]) {
    await page.getByText(t).first().click();
    await page.waitForTimeout(200);
  }
  await page.getByText("3 selected", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  const dlg = page.getByText("Cite claims", { exact: true }).locator("xpath=ancestor::div[contains(@class,'shadow')][1]");
  await hideUnsaved(page);
  await page.mouse.move(40, 760);
  await page.waitForTimeout(500);
  await isolate(page, dlg);
  await page.waitForTimeout(300);
  await shoot(page, "claims-picker", await clipOf(page, dlg, 14));
  await ctx.close();
};

// ------------------------------------------------------------------ memo-gallery-selection
// Memos ギャラリーでメモ 3 件を選んだ状態（1 件はフォルダ付き）。Turn into Knowledge は押さない
figures["memo-gallery-selection"] = async () => {
  await seedMemos();
  // 先頭のメモを Bread フォルダに入れる（captures の noteContexts を直接書く）
  const cap = await (await fetch(`${API}/appdata/captures`)).json();
  cap.captures[0].noteContexts = ["Bread"];
  await fetch(`${API}/appdata/captures`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cap) });
  const id = await findNoteId("Trial plan and log");
  const { ctx, page } = await openApp(`#note/${id}`);
  await page.waitForTimeout(1500);
  await page.getByText("Memos", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("checkbox", { name: "Select all" }).first().click({ force: true }).catch(async () => {
    await page.getByLabel("Select all").first().click({ force: true });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(1400, 900);
  await settle(page, 2500, 1400, 900);
  // 本文側だけを切り抜く（カードのチェックは #1424 から本文の 1 行目を避けるので、CSS の差し込みは要らない）
  await shoot(page, "memo-gallery-selection", { x: 256, y: 0, width: 1024, height: 320 });
  await ctx.close();
};

// ------------------------------------------------------------------ trash-archive
// Trash & Archive の Trash タブ。撮影用に足した 3 本を ⋯ → Move to trash で用意し、1 件チェックする
const TRASH_TITLES = ["Bagel dough trial", "Proofing box scratch notes", "Starter feeding draft"];
CREATED.push(...TRASH_TITLES);
figures["trash-archive"] = async () => {
  const lines = {
    "Bagel dough trial": "First try at bagels: 60% hydration, boiled 30 seconds per side.",
    "Proofing box scratch notes": "Proofing box held 27 C for 90 minutes; dough doubled slightly early.",
    "Starter feeding draft": "Feeding ratio 1:5:5 every 12 hours; rises to double in 6 hours.",
  };
  for (const t of TRASH_TITLES) {
    const id = await createNoteDoc(t, [blk("paragraph", lines[t])]);
    // 新しい文脈で開く（ハッシュ遷移だと索引に無い id を新規ノート扱いにする）
    const { ctx, page } = await openApp(`#note/${id}`);
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Menu", exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Move to trash" }).first().click();
    await page.waitForTimeout(800);
    // 確認ダイアログが出れば進める
    const ok = page.getByRole("button", { name: "Move to trash", exact: true });
    if (await ok.count()) await ok.last().click().catch(() => {});
    await page.waitForTimeout(1500);
    await ctx.close();
    console.log("  trashed:", t);
  }
  const { ctx, page } = await openApp();
  await page.getByText("Trash & Archive", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  // 1 件チェックして Restore / Delete permanently を有効にする
  await page.getByRole("checkbox").nth(2).check({ force: true });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(page, 1200, 1400, 900);
  await shoot(page, "trash-archive", { x: 256, y: 0, width: 1024, height: 310 });
  await ctx.close();
};

// ------------------------------------------------------------------ chat-answer
// ノートの右パネル Chat に質問 1 件と回答 1 件（回答の下の操作ボタン・出典）。
// 会話は note JSON の chats へ直接書く（AI は呼ばない）。撮ったら元の JSON に戻す
figures["chat-answer"] = async () => {
  const id = await findNoteId(TRIAL3);
  const orig = await (await fetch(`${API}/notes/${id}`)).text();
  const now = Date.now();
  const iso = (ms) => new Date(now - ms).toISOString();
  // 出典は Knowledge（wiki）ページの題に完全一致させる（チャットの [Source: "…"] は wiki の題で解決される）
  const answer = [
    "Going from 70% to 75% hydration opened the crumb further: your notes record larger holes and a lighter loaf at 70%, and the most open crumb of the series at 75%. The wetter dough was almost liquid at first, so stretch-and-fold in the bowl made it workable.",
    "",
    "---",
    "**📓 From your notes**",
    '  - [Source: "Higher hydration creates larger holes and a lighter loaf"]',
    '  - [Source: "75\u202f% hydration yields the most open crumb"]',
    '  - [Source: "Stretch‑and‑fold makes 75% hydration dough workable"]',
  ].join("\n");
  const doc = JSON.parse(orig);
  doc.chats = [
    {
      id: crypto.randomUUID(),
      scopeBlockId: "",
      scopeType: "page",
      messages: [
        { role: "user", content: "How did the crumb change between 70% and 75% hydration?", timestamp: iso(120000) },
        { role: "assistant", content: answer, timestamp: iso(100000) },
      ],
      createdAt: iso(120000),
      modifiedAt: iso(100000),
    },
  ];
  await fetch(`${API}/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
  try {
    const { ctx, page } = await openApp(`#note/${id}`, { models: SAMPLE_MODELS, settings: { features: { claims: true, insights: true } } });
    await page.waitForTimeout(2500);
    await page.mouse.click(1970 * 0.64, 108 * 0.64); // 右レールの先頭（Chat）
    await page.waitForTimeout(1500);
    await page.getByText("How did the crumb change", { exact: false }).first().click();
    await page.waitForTimeout(1500);
    await hideHandles(page);
    await page.mouse.move(700, 790);
    await page.waitForTimeout(800);
    // 左サイドバー下端でスクロール領域に断ち切られた文字が写らないよう、サイドバーを除いて切り抜く
    const vp = page.viewportSize();
    await shoot(page, "chat-answer", { x: 256, y: 0, width: vp.width - 256, height: vp.height });
    await ctx.close();
  } finally {
    await fetch(`${API}/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: orig });
  }
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
