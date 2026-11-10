/**
 * マニュアル用スクリーンショット撮影（ステップ・工程まわりの図で、撮影手順が残っていなかったもの）
 *
 * 次の図を実アプリから撮る（全部パン作りの世界観・英語 UI）:
 *   step-block / step-history-names / step-history-picker / process-list /
 *   cross-note-output-picker / cross-note-input-row / add-to-knowledge-chip
 *
 * （plan-flow-planned_en / graph-arrange_en は Storybook・既存の工程グラフと見比べて現行 UI と同じだったので対象外）
 *
 * 隔離データ（shotenv.sh reset <slot> bread で作る見本データ）で起動した API + vite（または preview）に
 * 英語 UI で入る。この図だけに要るノートを `--data` の notes/ へ直接書き足す（AI は呼ばない）。
 * 書き足したノートが一覧・索引に載るまで少し待つ（API は notes/ を直接読む）。
 *
 * 使い方:
 *   node scripts/manual-screenshots-steps-extra.mjs --port <web> --api <api> --data <DATA_DIR> [--only <name>]
 *
 * オプション:
 *   --port <port>   web のポート（既定 5189）
 *   --api <port>    API のポート（既定 3001 は触らないので必須扱い。ノート索引の反映確認に使う）
 *   --data <dir>    API が使っている DATA_DIR（必須）
 *   --only <name>   1 枚だけ撮る（上の図名。複数はカンマ区切り）
 *   --out <dir>     出力先（既定 manual/public/screenshots）
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は waitFor してから閉じる
 * - Service Worker は block
 * - ノートは `#note/<id>` へ直接遷移して開く
 * - 撮影前にマウスを空きへ逃がす（hover 跡・ツールチップを写さない）。ピッカーは開いたまま撮る
 * - 保存は "Saved" を待つ（"Unsaved" を写さない）
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

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
mkdirSync(OUT, { recursive: true });
if (!dataDir) {
  console.error("--data <DATA_DIR> が要ります（API が使っている隔離データ）");
  process.exit(1);
}
const BASE = `http://127.0.0.1:${port}/Graphium/app/`;
const want = (n) => only.length === 0 || only.includes(n);

// ── 見本ノートの書き足し ──────────────────────────────────────────
const NOW = "2026-11-10T09:00:00.000Z";
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
  content: title ? [t(title)] : [],
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
// 書き込む対象を絞れる（process-list は完成した流れだけの一覧にしたいので、先に e1・e4 だけ置く）
let seedFilter = null;
const saveNote = (id, doc) => {
  if (seedFilter && !seedFilter.includes(id)) return;
  writeFileSync(join(dataDir, "notes", `${id}.json`), JSON.stringify(doc));
};

const ID = {
  starter: "e1000000-0000-4000-8000-000000000001", // Sourdough starter（Feed the starter → Levain）
  mixTrial: "e2000000-0000-4000-8000-000000000002", // 受け取る側の Mix
  blankStep: "e3000000-0000-4000-8000-000000000003", // 名前が空のステップ（過去の手順名ピッカー用）
  chain: "e4000000-0000-4000-8000-000000000004", // Mix → Ferment → Bake（step-block 用・ナレッジ未追加）
};

function seedNotes() {
  // 発酵種を養う手順。出力 Levain に Hydration を持たせる
  {
    const s = "e1000000-0000-4000-8000-0000000000a1";
    const tb = "e1000000-0000-4000-8000-0000000000a2";
    saveNote(
      ID.starter,
      mkDoc(
        "Sourdough starter",
        [
          step(s, "Feed the starter", [
            para("e1000000-0000-4000-8000-0000000000b1", t("Feed the starter with equal parts flour and water and keep it warm until doubled.")),
            table(tb, [["Name", "Hydration"], ["Levain", "100%"]]),
          ]),
        ],
        { [tb]: "output" },
      ),
    );
  }
  // 受け取る側: 先行ステップの無い Mix
  saveNote(
    ID.mixTrial,
    mkDoc("Bread dough trial #8", [
      para("e2000000-0000-4000-8000-0000000000b0", t("Trying the dough with the levain from the starter note.")),
      step("e2000000-0000-4000-8000-0000000000a1", "Mix", [
        para("e2000000-0000-4000-8000-0000000000b1", t("Combine the levain with bread flour 300 g and water 200 g.")),
      ]),
    ]),
  );
  // 名前が空のステップ
  saveNote(
    ID.blankStep,
    mkDoc("Bread dough trial #9", [
      para("e3000000-0000-4000-8000-0000000000b0", t("Next run, written from the steps I have used before.")),
      step("e3000000-0000-4000-8000-0000000000a1", "", [para("e3000000-0000-4000-8000-0000000000b1", t(""))]),
    ]),
  );
  // Mix → Ferment → Bake。ナレッジには追加していない（ヘッダーが "Add to Knowledge" になる）
  {
    const [mix, fer, bak] = [1, 2, 3].map((n) => `e4000000-0000-4000-8000-00000000000${n}`);
    const tOut = "e4000000-0000-4000-8000-0000000000a2";
    const tPar = "e4000000-0000-4000-8000-0000000000a3";
    saveNote(
      ID.chain,
      mkDoc(
        "Bread dough trial #10",
        [
          para("e4000000-0000-4000-8000-0000000000b0", t("A basic loaf, same flour and oven as before.")),
          step(mix, "Mix", [
            para("e4000000-0000-4000-8000-0000000000b1", t("Combine the flour and water in the stand mixer.")),
          ]),
          step(fer, "Ferment", [para("e4000000-0000-4000-8000-0000000000b2", t("Rest the dough 30 min at room temperature, covered."))]),
          step(bak, "Bake", [
            para("e4000000-0000-4000-8000-0000000000b3", t("Bake at 200 °C for 25 min.")),
            table(tPar, [["Temperature", "Time"], ["200 °C", "25 min"]]),
            table(tOut, [["Name"], ["baked loaf"]]),
          ]),
        ],
        { [tPar]: "attribute", [tOut]: "output" },
        [informedBy(fer, mix), informedBy(bak, fer)],
      ),
    );
  }
}

// ── ブラウザ共通 ──────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

async function newSession({ width = 1280, height = 800 } = {}) {
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

async function waitSaved(page) {
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
}

const park = (page) => page.mouse.move(100, 600);

/** locator の bounding box を余白つきで clip にして撮る */
async function shotBox(page, name, box, pad = 0) {
  await park(page);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
  });
  console.log("saved", name);
}

const stepCard = (page, title) =>
  page.locator('[data-content-type="step"]').filter({ hasText: title }).first();

// ── 1. step-block ────────────────────────────────────────────────
async function shootStepBlock() {
  const { ctx, page } = await newSession();
  await openNote(page, ID.chain);
  await waitSaved(page);
  // Mix と Ferment（ノート内で 1・2 番目のステップ）。Mix の下端から Ferment のヘッダーまでを切る
  const cards = page.locator('[data-content-type="step"]');
  await cards.nth(0).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const a = await cards.nth(0).boundingBox();
  const b = await cards.nth(1).boundingBox();
  await shotBox(page, "step-block", { x: a.x - 16, y: a.y - 8, width: a.width + 28, height: b.y + 52 - a.y + 8 });
  await ctx.close();
}

// ── 2/3. 過去の手順名ピッカー（1 段目・2 段目）────────────────────
async function shootStepHistory() {
  const { ctx, page } = await newSession();
  // 過去の手順の索引（process index）は「プロセス一覧を開いたとき」に作られるので、先に一覧を開く
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await dismissWelcome(page);
  await page.waitForTimeout(2000);
  await page.getByText("Processes", { exact: true }).first().click();
  await page.waitForTimeout(3000);
  await openNote(page, ID.blankStep);
  await waitSaved(page);
  const card = page.locator('[data-content-type="step"]').first();
  await card.scrollIntoViewIfNeeded();
  await card.locator('[data-test="step-history-icon"]').click();
  await page.waitForTimeout(800);
  const popup = page.getByText("Pick from past steps", { exact: true }).first();
  await popup.waitFor({ state: "visible", timeout: 10000 });
  const c = await card.boundingBox();
  // ポップアップの下端（ヒント文の下）まで切る
  const bottomOf = async (txt) => {
    const hb = await page.getByText(txt).first().boundingBox();
    return hb.y + hb.height + 16 - c.y;
  };
  await shotBox(page, "step-history-names", { x: c.x - 4, y: c.y - 4, width: 340, height: await bottomOf("Picking one fills in") });
  // 2 段目: パラメータと素材・出力の両方を持つ手順（Bake。chain ノートに仕込んである）を選ぶ
  await page.getByText("Bake", { exact: true }).first().click();
  await page.waitForTimeout(800);
  await shotBox(page, "step-history-picker", { x: c.x - 4, y: c.y - 4, width: 340, height: await bottomOf("Add empty fields") + 14 });
  await ctx.close();
}

// ── 4. process-list ─────────────────────────────────────────────
async function shootProcessList() {
  const { ctx, page } = await newSession({ height: 640 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await dismissWelcome(page);
  await page.waitForTimeout(2500);
  await page.getByText("Processes", { exact: true }).first().click();
  await page.waitForTimeout(2500);
  // 1 件目を選んで右にフローを出す
  // 5 工程ある Trial 3 を選んで、右にフローを出す
  await page.getByText("Trial 3 - 75% hydration, bread flour", { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await shotBox(page, "process-list", { x: 256, y: 0, width: 1024, height: 640 });
  await ctx.close();
}

// ── 5/6. 別ノートのアウトプットを選ぶ → 受け取った行 ─────────────
async function shootCrossNote() {
  const { ctx, page } = await newSession({ width: 1280, height: 800 });
  await openNote(page, ID.mixTrial);
  await waitSaved(page);
  const mix = stepCard(page, "Mix");
  await mix.getByText("Prev step", { exact: true }).click();
  await page.getByText("Choose from another note", { exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByText("Sourdough starter", { exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByText("Feed the starter", { exact: true }).last().click();
  await page.waitForTimeout(600);
  await page.getByText("Levain", { exact: true }).last().waitFor({ state: "visible", timeout: 8000 });
  // ピッカーの列が全部写る範囲（ステップヘッダーから右のカラム群まで）
  const m = await mix.boundingBox();
  await shotBox(page, "cross-note-output-picker", { x: 255, y: m.y - 10, width: 1280 - 255 - 4, height: 200 });
  // 出力を選ぶ
  await page.getByText("Levain", { exact: true }).last().click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(3500);
  await waitSaved(page);
  const m2 = await stepCard(page, "Mix").boundingBox();
  await shotBox(page, "cross-note-input-row", { x: m2.x - 10, y: m2.y - 10, width: m2.width + 20, height: 320 });
  await ctx.close();
}

// ── 7. add-to-knowledge-chip ────────────────────────────────────
async function shootChip() {
  const { ctx, page } = await newSession();
  await openNote(page, ID.chain);
  await waitSaved(page);
  await shotBox(page, "add-to-knowledge-chip", { x: 634, y: 0, width: 646, height: 72 });
  await ctx.close();
}

try {
  // process-list は未完成の見本ノート（空名の trial #9・Mix だけの trial #8）を一覧に出さないよう、最初に撮る
  if (want("process-list")) {
    seedFilter = [ID.starter, ID.chain];
    seedNotes();
    await shootProcessList();
  }
  seedFilter = null;
  seedNotes();
  if (want("step-block")) await shootStepBlock();
  if (want("step-history-names") || want("step-history-picker")) await shootStepHistory();
  if (want("cross-note-output-picker") || want("cross-note-input-row")) await shootCrossNote();
  if (want("add-to-knowledge-chip")) await shootChip();
} finally {
  await browser.close();
}
