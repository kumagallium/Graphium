/**
 * マニュアル用スクリーンショット撮影（メモの付け先と現れる場所: v0.109.0）
 *
 * 次の図を実アプリから撮る（パン作りの世界観・英語 UI）:
 *   memo-marker-popover  ノートの画像の右上の印と、開いた小窓（メモ 2 件・書く欄）
 *   quick-memo-target    ⌘⇧M のダイアログ。付け先チップ（ブロック）が出ているところ
 *   memo-linked-quote    紐づいた引用ブロック（黄土の縦線）と、印から開いた小窓
 *   connection-memo      右パネル Steps のグラフで、つながりを押して開いたメモの小窓
 *   neighborhood-memos   右パネル Graph → Neighbors に、メモ（付箋）と画像のノードが出ている
 *   network-graph        既存の図（Neighbors サブタブ）の撮り直し。メモ入りのこのノートで撮る
 *
 * 1 本の流れ（画像を貼る → 素材にメモ 2 件 → ブロックのメモ → /memo で引用 → 元のメモを直す →
 * つながりにメモ → 近傍グラフ）で状態を積み上げるので、--only は「どの図を保存するか」の絞り込み
 * （流れは毎回最後まで走る）。
 *
 * 隔離データで起動した API + vite に英語 UI で入る。画像は canvas で描いた PNG を、UI の
 * hidden `input[type=file]` へ投入して素材にする。メモは全部 UI から書く。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port <port> --strictPort --host 127.0.0.1             # 別ターミナル
 *   node scripts/manual-screenshots-memos.mjs --port <port> --data <DATA_DIR> [--only <name>]
 *
 * オプション:
 *   --port <port>   vite のポート（既定 5189）
 *   --data <dir>    API が使っている DATA_DIR（ノートの書き足しに使う。必須。空のデータで走らせる）
 *   --only <name>   保存する図を絞る（複数はカンマ区切り）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *   --tmp <dir>     投入用の画像を作る場所（既定 os.tmpdir()）
 *   --nb <0-3>      近傍グラフは配置が毎回変わるので 4 枚撮り、そのうち出力に使う番号（既定 1。--tmp に neighbors-N.png が残る）
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる。閉じないとクリックを横取りされる
 * - Service Worker は block（PWA の自動リロードが入力と競合する）
 * - ノートは `#note/<id>` へ直接遷移して開く（一覧クリックはサイドピークになる）
 * - ⠿ ハンドルはマウスを外しても残ることがあるので、撮る間だけ `.bn-side-menu` を隠す
 * - "Unsaved" 表示は撮る前に保存して消す
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "fs";
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
const out = (n) => join(OUT, `${n}.png`);
const done = (n) => console.log(`  ✓ ${out(n)}`);
const MOD = process.platform === "darwin" ? "Meta" : "Control";

// ── 見本ノート（手順 2 つ。前の手順でつなぐ） ─────────────────────────
const NOW = "2026-10-29T09:00:00.000Z";
const P = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const t = (text, styles = {}) => ({ type: "text", text, styles });
const para = (id, ...c) => ({ id, type: "paragraph", props: P, content: c, children: [] });
const step = (id, title, children) => ({
  id,
  type: "step",
  props: { textAlignment: "left", variant: "step" },
  content: [t(title)],
  children,
});
const NOTE_ID = "e1000000-0000-4000-8000-000000000001";
const MIX = "e1000000-0000-4000-8000-0000000000a1";
const RISE = "e1000000-0000-4000-8000-0000000000a2";
function seedNote() {
  const doc = {
    version: 6,
    title: "Sourdough bake #3",
    createdAt: NOW,
    modifiedAt: NOW,
    source: "human",
    pages: [
      {
        id: "main",
        title: "Sourdough bake #3",
        blocks: [
          para("e1000000-0000-4000-8000-0000000000b0", t("Third loaf with the new starter. Wetter dough than last time, same oven.")),
          step(MIX, "Mix dough", [para("e1000000-0000-4000-8000-0000000000b1", t("Combine flour, water and starter, then fold until smooth."))]),
          step(RISE, "First rise", [para("e1000000-0000-4000-8000-0000000000b2", t("Cover and rest at room temperature until doubled."))]),
        ],
        labels: {},
        provLinks: [
          {
            id: "lnk_e1000000",
            sourceBlockId: RISE,
            targetBlockId: MIX,
            type: "informed_by",
            layer: "prov",
            createdBy: "human",
          },
        ],
        knowledgeLinks: [],
      },
    ],
  };
  mkdirSync(join(dataDir, "notes"), { recursive: true });
  writeFileSync(join(dataDir, "notes", `${NOTE_ID}.json`), JSON.stringify(doc));
}

// ── ブラウザ共通 ──────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

async function newSession({ height = 800, width = 1280 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: "en-US",
    serviceWorkers: "block",
  });
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

async function saveNote(page) {
  await page.keyboard.press(`${MOD}+s`);
  await page.getByText("Saved", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
}

/** パンの断面風の PNG を canvas で描く */
async function makeBreadImage() {
  const file = join(TMP, "crumb-shot.png");
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0"><canvas id="c" width="640" height="360"></canvas></body>`);
  await page.evaluate(() => {
    const c = document.getElementById("c");
    const g = c.getContext("2d");
    g.fillStyle = "#cdb89a";
    g.fillRect(0, 0, 640, 360);
    // 板の木目
    for (let y = 0; y < 360; y += 24) {
      g.fillStyle = y % 48 === 0 ? "#c4ad8c" : "#d3c0a3";
      g.fillRect(0, y, 640, 12);
    }
    // 皮
    g.fillStyle = "#8a5326";
    g.beginPath();
    g.ellipse(320, 190, 250, 140, 0, 0, Math.PI * 2);
    g.fill();
    // 中身
    g.fillStyle = "#f1dfb6";
    g.beginPath();
    g.ellipse(320, 190, 232, 124, 0, 0, Math.PI * 2);
    g.fill();
    // 気泡（決まった乱数）
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      const x = 320 + Math.cos(a) * 210 * r;
      const y = 190 + Math.sin(a) * 104 * r;
      const rad = 4 + rnd() * 14;
      g.fillStyle = "rgba(196,160,108,0.55)";
      g.beginPath();
      g.ellipse(x, y, rad, rad * 0.8, rnd(), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,247,226,0.8)";
      g.beginPath();
      g.ellipse(x - 1, y - 1, rad * 0.55, rad * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  await page.locator("#c").screenshot({ path: file });
  await page.close();
  return file;
}

/** 本文の末尾に画像ブロックを足す（/image → hidden input へ投入） */
async function addImage(page, file) {
  await page.locator(".bn-editor [data-content-type='paragraph']").first().click();
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
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await saveNote(page);
}

const figures = {};
export {};

/** 要素の外接矩形を結合して、余白つきの clip にする */
async function clipOf(page, locators, pad = 16) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const l of locators) {
    const b = await l.boundingBox();
    if (!b) throw new Error("clip 対象が見つかりません");
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad);
  return { x: x1, y: y1, width: x2 + pad - x1, height: y2 + pad - y1 };
}

/** 保存して、ハンドルと Unsaved を隠して撮る */
async function shoot(page, name, locators, pad = 16) {
  await page.mouse.move(700, 5);
  await page.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });
  await page.waitForTimeout(300);
  const clip = await clipOf(page, locators, pad);
  if (want(name)) {
    await page.screenshot({ path: out(name), clip });
    done(name);
  }
}

/** 要素から上へたどって、最初の absolute / fixed 配置の祖先（ポップオーバーの外枠）を返す */
function floatingAncestor(el) {
  let n = el.parentElement;
  while (n && !["absolute", "fixed"].includes(getComputedStyle(n).position)) n = n.parentElement;
  return n;
}

/** 素材の小窓 / つながりの小窓に書く */
async function writeInPopover(page, text) {
  const box = page.getByPlaceholder("Write a memo… ⏎ to save, Shift+⏎ for newline");
  await box.fill(text);
  await box.press("Enter");
  await page.waitForTimeout(900);
}

// 前の実行の状態（ノート・素材・メモ）を消してから始める。API は起動中でもファイルを読み直す
for (const d of ["notes", "media"]) rmSync(join(dataDir, d), { recursive: true, force: true });
for (const f of ["captures.json", "media-index.json", "note-index.json"]) rmSync(join(dataDir, "appdata", f), { force: true });
mkdirSync(join(dataDir, "media"), { recursive: true });

const { ctx, page } = await newSession();
try {
  seedNote();
  await openNote(page, NOTE_ID);
  const file = await makeBreadImage();
  await addImage(page, file);
  await page.getByText("Text extracted").first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});

  // ── a. 素材のメモの印と小窓 ──
  const img = page.locator(".bn-editor img").first();
  await img.hover();
  await page.locator("[data-memo-chip]").first().click();
  await writeInPopover(page, "Crumb is open and glossy. Hydration 78% worked.");
  await writeInPopover(page, "Compare with bake #2: tighter crumb near the crust.");
  // 小窓の外枠: textarea から上へたどって、最初の absolute / fixed 配置の祖先
  const popHandle = await page.getByPlaceholder("Write a memo… ⏎ to save, Shift+⏎ for newline").evaluateHandle(floatingAncestor);
  const pop = popHandle.asElement(); // ElementHandle も boundingBox() を持つので clipOf にそのまま渡せる
  await shoot(page, "memo-marker-popover", [page.locator(".bn-editor [data-content-type='image']").first(), pop], 12);
  await page.screenshot({ path: join(TMP, "probe-a.png") });
  await page.keyboard.press("Escape");
  await page.mouse.click(1100, 700);

  // ── b. ⌘⇧M: 付け先チップ（ブロック） ──
  await page.locator(".bn-editor").getByText("Combine flour, water and starter").click();
  await page.keyboard.press("End");
  await page.keyboard.press(`${MOD}+Shift+m`);
  const memoBox = page.getByPlaceholder("Write your memo here...");
  await memoBox.waitFor({ state: "visible", timeout: 10000 });
  await memoBox.fill("Fold every 30 minutes for the first two hours, wet hands.");
  await page.waitForTimeout(500);
  const dlg = memoBox.locator("xpath=ancestor::div[contains(@class,'max-w-xl')][1]");
  await page.screenshot({ path: join(TMP, "probe-b.png") });
  await shoot(page, "quick-memo-target", [dlg], 12);
  await memoBox.press(`${MOD}+Enter`);
  await page.waitForTimeout(1500);

  // ── c. /memo で引用 ──
  await page.locator(".bn-editor").getByText("Cover and rest at room temperature").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/memo");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  await page.getByText("Fold every 30 minutes").first().click();
  await page.waitForTimeout(600);
  await page.waitForTimeout(1500);
  await saveNote(page);
  // 元のメモを書き直す（サイドバー Memos → 詳細）
  await page.getByRole("button", { name: /^Memos/ }).first().click();
  await page.waitForTimeout(1500);
  await page.getByText("Fold every 30 minutes").first().click();
  await page.waitForTimeout(1200);
  await page.getByText("Fold every 30 minutes for the first two hours, wet hands.").last().click(); // 本文 → 編集
  const editBox = page.locator("textarea").last();
  await editBox.fill("Fold every 30 minutes for the first two hours, wet hands. Then leave it alone.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByText("✕", { exact: true }).first().click();
  await page.waitForTimeout(500);

  // ── c. 紐づいた引用ブロックと小窓（元のメモが直された状態） ──
  await page.evaluate((id) => { location.hash = `#note/${id}`; }, NOTE_ID);
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2500);
  const quote = page.locator(".bn-editor [data-content-type='quote']").first();
  await quote.hover();
  await page.waitForTimeout(500);
  await page.locator("[data-memo-chip][aria-label^='Memo']").first().click();
  await page.waitForTimeout(800);
  const qPop = (await page.getByText("Quoted memo", { exact: true }).first().evaluateHandle(floatingAncestor)).asElement();
  await page.mouse.move(700, 5);
  await shoot(page, "memo-linked-quote", [qPop, quote.locator("xpath=ancestor::*[@data-node-type='blockOuter'][2]")], 14);
  await page.keyboard.press("Escape");
  await page.mouse.click(1100, 250);
  await page.waitForTimeout(400);

  // ── d. つながりのメモ（Steps のグラフ） ──
  await page.locator(".react-flow__edge-textwrapper, .react-flow__edgelabel-renderer").first().waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  // グラフを上へ寄せる（小窓が下に開くので、ノードが上の方にあるほうが図が小さく済む）
  const paneBox = await page.locator(".react-flow__pane").first().boundingBox();
  await page.mouse.move(paneBox.x + paneBox.width * 0.12, paneBox.y + paneBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width * 0.12, paneBox.y + paneBox.height * 0.7 - 190, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  // 文字ではなく、その下の背景の矩形が当たる
  await page.locator(".react-flow__edge-textbg").first().click({ timeout: 8000 });
  await page.waitForTimeout(600);
  await writeInPopover(page, "Let the dough rest 10 minutes before the first rise.");
  const ePop = (await page.getByText("Mix dough → First rise", { exact: true }).first().evaluateHandle(floatingAncestor)).asElement();
  const nodes = page.locator(".react-flow__node");
  await shoot(page, "connection-memo", [ePop, nodes.first(), nodes.last()], 8);
  await page.keyboard.press("Escape");
  await page.mouse.click(paneBox.x + paneBox.width * 0.1, paneBox.y + paneBox.height * 0.9);
  await page.waitForTimeout(400);

  // ── e. 近傍グラフ（Graph → Neighbors）: メモと画像のノード ──
  await page.getByRole("button", { name: "Graph", exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Neighbors", exact: true }).click().catch(() => {});
  await page.waitForTimeout(4000);
  await page.mouse.move(700, 5);
  // 右パネル（Graph タブ）だけを切り出す。配置は毎回変わる（cytoscape の fcose）ので、
  // Lineage ↔ Neighbors で並べ直しながら数枚撮り、--nb <番号> で選んだ 1 枚を出力に使う
  const panelClip = async () =>
    page.getByRole("button", { name: "Neighbors", exact: true }).evaluate((el) => {
      let n = el;
      while (n && n.getBoundingClientRect().height < window.innerHeight * 0.8) n = n.parentElement;
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 800 - r.y) };
    });
  const nbPick = parseInt(opt("--nb", "1"), 10);
  for (let i = 0; i < 4; i++) {
    const clip = await panelClip();
    await page.screenshot({ path: join(TMP, `neighbors-${i}.png`), clip });
    if (i === nbPick && want("neighborhood-memos")) {
      await page.screenshot({ path: out("neighborhood-memos"), clip });
      done("neighborhood-memos");
    }
    await page.getByRole("button", { name: "Lineage", exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Neighbors", exact: true }).click();
    await page.waitForTimeout(3500);
  }
} finally {
  await ctx.close();
  await browser.close();
}
