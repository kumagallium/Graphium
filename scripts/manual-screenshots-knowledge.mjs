/**
 * マニュアル用スクリーンショット撮影（Knowledge・チャット・取り込み・チャート）
 *
 * 実アプリ（パン作りの見本データを入れた隔離 DATA_DIR）に英語 UI で入って撮る。
 * LLM は一切呼ばない。AI モデルは localStorage に表示専用で seed する。
 *
 * 使い方:
 *   DATA_DIR=<scratch> PORT=<api> node_modules/.bin/tsx --env-file .env src/server/index.ts  # 別ターミナル
 *   PORT=<api> node_modules/.bin/vite --port 5969 --strictPort --host 127.0.0.1               # 別ターミナル
 *   node scripts/manual-screenshots-knowledge.mjs --port 5969 --data <DATA_DIR>
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5969）
 *   --data <dir>    API が使っている DATA_DIR（世界照合の判定を JSON に書く図で使う）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮る
 *
 * 出力先: manual/public/screenshots/
 *
 * Upkeep・出典照合・来歴の図（--only で 1 枚ずつ。いずれも --data 必須。LLM は呼ばず JSON を直接書く）:
 *   upkeep-check（孤立・重複を足して Quick を実行。撮影後に足した分は消す）/ source-check-list /
 *   upkeep-source-check / upkeep-operations（maint-run-* を書く。撮影後に消す）/
 *   genealogy（計画ノート "Trial series plan" を書き足して Genealogy を撮る）
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）は出るのを waitFor してから閉じる
 * - Service Worker を block しないと PWA の自動リロードが click と競合する
 * - 設定ボタンは getByRole で掴めない。page.evaluate で textContent 一致の button を click
 * - 世界照合の判定（Checked · no KB match 等）は LLM を呼ばず、claim の JSON
 *   （wikiMeta.grounding）を直接書き換えて作る。書いた後にページを再読み込みする
 * - 取り込み図の .dat は scratch に生成して hidden input[type=file] へ setInputFiles
 */
import { chromium } from "playwright";
import { tmpdir } from "os";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i !== -1 ? args[i + 1] : d;
};
const port = parseInt(opt("--port", "5969"), 10);
const dataDir = opt("--data", null);
const only = opt("--only", null);

const BASE_URL = `http://127.0.0.1:${port}/Graphium/app/`;
const VIEWPORT = { width: 1280, height: 800 };

/** 表示専用モデル。API キーはダミー。推論は走らせない */
const SAMPLE_MODELS = [
  { id: "m1", name: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet", apiKey: "dummy", apiBase: null },
];

const NOTE_TITLE = "Trial 3 - 75% hydration, bread flour";
const CLAIM_TITLE = "Whole wheat substitution at 75% hydration makes dough stiff";

const browser = await chromium.launch({ headless: true });

async function newPage({ viewport = VIEWPORT, flags = null } = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ([models]) => {
      localStorage.setItem("graphium_locale", "en");
      localStorage.setItem("graphium-llm-models", JSON.stringify(models));
      localStorage.setItem("graphium-zoom-hint-dismissed", "1");
      // 世界照合・洞察を ON にした状態（Check world ボタンと World 列が出る）
      if (!localStorage.getItem("graphium-settings")) {
        localStorage.setItem(
          "graphium-settings",
          JSON.stringify({ features: { claims: true, insights: true, worldGrounding: true } }),
        );
      }
      Object.keys(localStorage)
        .filter((k) => k.startsWith("graphium-settings-group:"))
        .forEach((k) => localStorage.removeItem(k));
    },
    [SAMPLE_MODELS],
  );
  const page = await ctx.newPage();
  return { ctx, page };
}

async function open(page, hash = "") {
  await page.goto(BASE_URL + hash, { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) {
    await welcome.click();
    await page.waitForTimeout(1200);
  }
}

async function clickByText(page, text, scopeSelector = null) {
  const ok = await page.evaluate(
    ([t, s]) => {
      const root = s ? document.querySelector(s) : document;
      if (!root) return false;
      const btn = Array.from(root.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === t,
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    [text, scopeSelector],
  );
  if (!ok) throw new Error(`ボタンが見つかりません: ${text}`);
}

/** 隔離データからタイトル一致のファイルを探す */
function findJson(sub, title) {
  const d = join(dataDir, sub);
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(join(d, f), "utf8"));
    if (j.title === title) return { id: f.replace(/\.json$/, ""), path: join(d, f), json: j };
  }
  throw new Error(`${sub} に ${title} がありません`);
}

const shot = (page, name, opts = {}) =>
  page.screenshot({ path: resolve(OUTPUT_DIR, `${name}.png`), ...opts }).then(() => console.log(`  ✓ ${name}.png`));

const SHOTS = {};

/** 探索用: 画面を scratch に撮る（--only probe --out <path>） */
SHOTS.probe = async () => {
  const { ctx, page } = await newPage();
  await open(page, opt("--hash", ""));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: opt("--out", "/tmp/probe.png") });
  await ctx.close();
};

/** サイドバーの Knowledge を開いて Claims の一覧へ */
async function gotoClaims(page) {
  await page.getByRole("button", { name: /^Knowledge/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^Claims/ }).first().click();
  await page.waitForTimeout(1500);
}

SHOTS["knowledge-list"] = async () => {
  const { ctx, page } = await newPage();
  await open(page);
  await gotoClaims(page);
  await page.mouse.move(1000, 40);
  await shot(page, "knowledge-list");
  await ctx.close();
};

/** claim ページをメイン表示で開く（一覧からのクリックはサイドピークになるのでハッシュで） */
async function openClaim(page, title) {
  const { id } = findJson("wiki", title);
  await open(page, `#note/wiki:${id}`);
  await page.waitForTimeout(2000);
}

SHOTS["knowledge-page-banner"] = async () => {
  // 判定チップが残っていると別の図になるので、先に消す
  const f = findJson("wiki", CLAIM_TITLE);
  delete f.json.wikiMeta.grounding;
  writeFileSync(f.path, JSON.stringify(f.json));
  const { ctx, page } = await newPage();
  await openClaim(page, CLAIM_TITLE);
  await page.mouse.move(1200, 1000);
  await shot(page, "knowledge-page-banner");
  await ctx.close();
};

/** 世界照合の判定を JSON に直接書く（LLM を呼ばない）。KB に当たらなかった印だけを付ける */
function writeNoMatchVerdict(title) {
  const f = findJson("wiki", title);
  f.json.wikiMeta.grounding = {
    validity: { checkedBy: "distilled-kb@v1", checkedAt: new Date().toISOString() },
  };
  writeFileSync(f.path, JSON.stringify(f.json));
}

SHOTS["world-grounding-verdict"] = async () => {
  writeNoMatchVerdict(CLAIM_TITLE);
  const { ctx, page } = await newPage();
  await openClaim(page, CLAIM_TITLE);
  await page.mouse.move(1200, 1000);
  await shot(page, "world-grounding-verdict");
  await ctx.close();
};

async function openNote(page, title) {
  const { id } = findJson("notes", title);
  await open(page, `#note/${id}`);
  await page.waitForTimeout(2000);
}

SHOTS.chat = async () => {
  const { ctx, page } = await newPage();
  await openNote(page, NOTE_TITLE);
  // 右レールの AI チャット（ロボットのアイコン）。名前は title / aria-label のどちらか
  const btn = page.locator('button[title="AI Chat"], button[aria-label="AI Chat"], button[title="Chat"], button[aria-label="Chat"]').first();
  await btn.click();
  await page.waitForTimeout(1500);
  await page.mouse.move(1000, 1000);
  await shot(page, "chat");
  await ctx.close();
};

SHOTS["composer-verbs"] = async () => {
  const { ctx, page } = await newPage();
  await openNote(page, NOTE_TITLE);
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(1500);
  // 最近のノートと Recent Knowledge は別見出し。一覧は高さが限られスクロールするので、
  // Recent Knowledge の見出しが見える位置まで送る
  const sc = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("*")).find(
      (e) => e.children.length === 0 && /^recent knowledge$/i.test((e.textContent || "").trim()),
    );
    if (!h) return "no heading";
    h.scrollIntoView({ block: "start" });
    return "scrolled";
  });
  console.log(sc);
  await page.mouse.move(1900, 1100);
  await page.waitForTimeout(400);
  await shot(page, "composer-verbs");
  await ctx.close();
};

// ── 測定データの取り込み（.dat は前処理 6 行 + ヘッダー + 31 行） ──
const ENV_ROWS = [
  [35.2, 75], [36.5, 80], [34.8, 85], [33.2, 90], [37.1, 65], [36.0, 72], [35.4, 78], [34.1, 83],
  [33.7, 88], [32.9, 91], [34.6, 79], [35.9, 74], [36.8, 69], [37.4, 63], [36.2, 71], [35.0, 77],
  [34.3, 82], [33.5, 86], [32.8, 89], [33.9, 84], [35.6, 76], [36.4, 70], [37.0, 66], [35.8, 73],
  [34.7, 81], [33.8, 87], [34.9, 80], [36.1, 72], [35.3, 75], [36.6, 68], [35.1, 77],
];
function writeEnvDat() {
  const lines = [
    "# [INSTRUMENT SETTINGS & METADATA]",
    "# Device Model: ENV-MONITOR-X9",
    "# Location: Site B",
    "# Sampling Interval: 1 Day",
    "# ----------------------------------------",
    "# [DATA START]",
    "Date,Max temp (C),Humidity (%),Site",
    ...ENV_ROWS.map(([t, h], i) => `Aug ${i + 1},${t.toFixed(1)},${h},Site B`),
  ];
  const dir = join(opt("--tmp", tmpdir()), "graphium-shot-dat");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "env-monitor-x9.dat");
  writeFileSync(f, lines.join("\n") + "\n");
  return f;
}

const WIDE = { width: 1440, height: 900 };

/** 新しいノートに題名を付け、/Data から .dat を渡して取り込み画面まで進める */
async function openImportScreen(page) {
  await page.locator('textarea[placeholder="Note title"]').first().fill("Site B environment log");
  await page.locator(".bn-editor").first().click();
  await page.keyboard.type("/Data");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await page.locator('input[type="file"]').first().setInputFiles(writeEnvDat());
  await page.getByText("Import data", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  // 自動保存を待って、右上の "Unsaved" を "Saved" にしてから撮る
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
}

SHOTS["data-import"] = async () => {
  const { ctx, page } = await newPage({ viewport: WIDE });
  await open(page);
  await openImportScreen(page);
  await page.mouse.move(1400, 1000);
  await shot(page, "data-import");
  await ctx.close();
};

SHOTS["imported-table"] = async () => {
  const { ctx, page } = await newPage({ viewport: WIDE });
  await open(page);
  await openImportScreen(page);
  // 「Insert as」を「Table in the note」に（既定は data table）
  await page.getByRole("button", { name: "Table in the note" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText(/Show \d+ more rows/).first().waitFor({ state: "visible", timeout: 15000 });
  // 自動保存を待つ（"Unsaved" を写さない）。ホバーで出る展開ボタンも避けて、マウスは余白へ
  await page.getByText("Saved", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.mouse.move(1300, 800);
  await page.waitForTimeout(800);
  await shot(page, "imported-table");
  await ctx.close();
};

// ── 痛みと気圧の 2 軸チャート ──
const mkCell = (text) => ({
  type: "tableCell",
  content: text ? [{ type: "text", text, styles: {} }] : [],
  props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" },
});
const mkTable = (id, header, rows) => ({
  id,
  type: "table",
  props: { textColor: "default" },
  content: {
    type: "tableContent",
    columnWidths: header.map(() => null),
    headerRows: 1,
    rows: [header, ...rows].map((r) => ({ cells: r.map(mkCell) })),
  },
  children: [],
});

/** 隔離データにノートを 1 本書く（title が同じなら上書き）。戻り値は id */
function writeDualAxisNote() {
  const title = "Headache and weather diary";
  const dir = join(dataDir, "notes");
  let id = "5b1f0c7e-0d3a-4f6e-9c1a-3a7d2b8e4f10";
  const pain = [
    ["2026-10-09 07:30", "2"], ["2026-10-10 21:10", "6"], ["2026-10-11 08:00", "4"],
    ["2026-10-12 19:25", "7"], ["2026-10-13 09:05", "3"],
  ];
  const pressure = [
    ["2026-10-09 08:00", "1013"], ["2026-10-10 21:00", "1008"], ["2026-10-11 08:00", "1005"],
    ["2026-10-12 20:00", "998"], ["2026-10-13 09:00", "1004"],
  ];
  const para = (text) => ({
    id: "p-" + text.length,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  });
  const config = {
    chartType: "line",
    series: [
      { sourceBlockId: "pain-table", xColumn: "Date/Time", yColumn: "Pain (0–10)" },
      { sourceBlockId: "pressure-table", xColumn: "Date/Time", yColumn: "Pressure (hPa)", axis: "right" },
    ],
    caption: "Pain vs. atmospheric pressure",
  };
  const blocks = [
    para("Pain scores from my diary, and the barometric pressure on the same days."),
    mkTable("pain-table", ["Date/Time", "Pain (0–10)"], pain),
    mkTable("pressure-table", ["Date/Time", "Pressure (hPa)"], pressure),
    { id: "chart-1", type: "chart", props: { sourceBlockId: "", config: JSON.stringify(config) }, children: [] },
  ];
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      version: 5,
      title,
      pages: [{ id: "pg-" + id, title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
      createdAt: now,
      modifiedAt: now,
      source: "human",
    }),
  );
  return id;
}

SHOTS["chart-dual-axis"] = async () => {
  const id = writeDualAxisNote();
  // 旧図は 1280x574 の窓。キャプションまで入れるため 620 にした
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 620 } });
  await open(page, `#note/${id}`);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const c = document.querySelector('[data-content-type="chart"]');
    if (c) c.scrollIntoView({ block: "start" });
  });
  await page.mouse.move(1250, 560);
  await page.waitForTimeout(1500);
  await shot(page, "chart-dual-axis");
  await ctx.close();
};

// ── Upkeep（手入れ）画面の図 ──
/** サイドバーの Knowledge を開き、下の Upkeep ボタンで手入れ画面へ */
async function gotoUpkeep(page, tab = null) {
  await page.getByRole("button", { name: /^Knowledge/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^Upkeep/ }).first().click();
  await page.getByText("Knowledge upkeep", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(800);
  if (tab) {
    await page.getByRole("button", { name: tab, exact: true }).or(page.getByRole("tab", { name: tab, exact: true })).first().click();
    await page.waitForTimeout(1200);
  }
}

/** 写り込み防止: 保存状態の "Unsaved" と BlockNote の側面ハンドルを隠す */
async function hideNoise(page) {
  await page.addStyleTag({
    content: `.bn-side-menu, .bn-side-menu *, *:has(> .bn-side-menu){visibility:hidden!important}`,
  });
  await page.evaluate(() => {
    for (const e of document.querySelectorAll("*")) {
      if (e.children.length === 0 && (e.textContent || "").trim() === "Unsaved") e.style.visibility = "hidden";
    }
  });
}

/** 隔離データの wiki ドキュメントを一括で書き換える（title → 変更関数） */
function patchWiki(title, fn) {
  const f = findJson("wiki", title);
  fn(f.json);
  writeFileSync(f.path, JSON.stringify(f.json));
  return f.id;
}

/**
 * Quick の点検が拾う問題を、見本データに JSON で足す（LLM は呼ばない）。
 * 孤立した知見 1 件（出典も関連も無い）と、表記ゆれだけ違う重複トピック 1 件（片方の出典ノートは 1 つ消失）。
 * 固定 id なので何度実行しても同じ。撮り終えたら removeUpkeepSeeds() で片付ける
 */
const UPKEEP_SEED_IDS = {
  orphanClaim: "a1b2c3d4-0001-4000-8000-000000000001",
  dupTopic: "a1b2c3d4-0002-4000-8000-000000000002",
};
function seedUpkeepIssues() {
  const now = new Date().toISOString();
  const base = findJson("wiki", "Bread flour");
  // 重複トピック: 同じ題名（大文字小文字だけ違う）。出典の 1 つは存在しないノート
  const dup = JSON.parse(JSON.stringify(base.json));
  dup.title = "Bread Flour";
  dup.pages[0].title = "Bread Flour";
  dup.wikiMeta.derivedFromNotes = [dup.wikiMeta.derivedFromNotes[0], "9f0e1d2c-3b4a-4958-8776-655443322110"];
  dup.createdAt = dup.modifiedAt = now;
  delete dup.documentProvenance;
  writeFileSync(join(dataDir, "wiki", `${UPKEEP_SEED_IDS.dupTopic}.json`), JSON.stringify(dup));
  // 孤立した知見: 出典ノートも関連もリンクも持たない
  const orphan = JSON.parse(JSON.stringify(findJson("wiki", "Cold long fermentation improves flavor").json));
  orphan.title = "Baking steel preheat time was not recorded";
  orphan.pages[0].title = orphan.title;
  orphan.pages[0].blocks = [
    {
      id: "a1b2c3d4-0001-4000-8000-0000000000b1",
      type: "paragraph",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: "Preheat time for the baking steel was not written down in any trial.", styles: {} }],
      children: [],
    },
  ];
  orphan.pages[0].knowledgeLinks = [];
  orphan.wikiMeta.derivedFromNotes = [];
  orphan.createdAt = orphan.modifiedAt = now;
  delete orphan.documentProvenance;
  writeFileSync(join(dataDir, "wiki", `${UPKEEP_SEED_IDS.orphanClaim}.json`), JSON.stringify(orphan));
}
function removeUpkeepSeeds() {
  for (const id of Object.values(UPKEEP_SEED_IDS)) {
    try {
      unlinkSync(join(dataDir, "wiki", `${id}.json`));
    } catch {}
  }
}

SHOTS["upkeep-check"] = async () => {
  seedUpkeepIssues();
  const { ctx, page } = await newPage();
  try {
    await open(page);
    await gotoUpkeep(page);
    // 空の状態の Quick ボタン（右上の Run Check からも同じ選択肢が開く）
    await page.getByRole("button", { name: "Quick (local only)", exact: true }).first().click();
    await page.getByText(/\d+ issue\(s\) found/).first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(800);
    await page.mouse.move(1270, 790);
    await hideNoise(page);
    // 空白が出ないよう、メイン領域を最後の Issue 行の下端で切る
    const lb = await page.getByText("cites a source that is missing").first().boundingBox();
    await shot(page, "upkeep-check", { clip: { x: 256, y: 0, width: VIEWPORT.width - 256, height: Math.ceil(lb.y + lb.height + 28) } });
  } finally {
    await ctx.close();
    removeUpkeepSeeds();
  }
};

/**
 * 出典照合の判定を claim の JSON（wikiMeta.sourceCheck）に直接書く（LLM は呼ばない）。
 * 一覧の列と要確認リストは、読み込み時にここから作られる一覧向けミラーを見る
 */
const SOURCE_CHECK_SEEDS = [
  ["Whole wheat substitution at 75% hydration makes dough stiff", "contradicted", "The note says the dough was stiff at 75%, but the source describes it as slack and sticky."],
  ["Higher hydration creates larger holes and a lighter loaf", "contradicted", "The source reports a denser crumb at the highest hydration, not a lighter loaf."],
  ["Oven dial reads about 15 °C high across settings", "not-in-source", "The source gives one reading at 230 °C only; it does not say the offset holds across settings."],
  ["Cold dough is easier to handle and shape", "not-in-source", "Nothing in the cited note compares handling of cold and warm dough."],
  ["Starter turns sharply sour after peak collapse", "unclear", "The note mentions sourness but the timing relative to the peak is ambiguous."],
  ["Overnight cold fermentation fits a weekday schedule", "source-missing", "The cited note is in the Trash and could not be read."],
  ["75 % hydration yields the most open crumb", "supported", "The note states that the 75% loaf had the most open crumb."],
  ["Daily equal flour‑water feeding maintains starter growth", "supported", "The note describes feeding equal parts flour and water daily with steady growth."],
];
async function seedSourceChecks() {
  const { createHash } = await import("crypto");
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  for (const [i, [title, verdict, rationale]] of SOURCE_CHECK_SEEDS.entries()) {
    const f = findJson("wiki", title);
    // 先頭の判定ほど新しい作成日時にする（一覧の既定の並びで注意が要る順になる）
    const at = new Date(nowMs - i * 60_000);
    f.json.modifiedAt = at.toISOString();
    f.json.createdAt = at.toISOString();
    const doc = f.json;
    const entry = {
      sourceId: (doc.wikiMeta.derivedFromNotes || [])[0] || "",
      sourceKind: "note",
      verdict,
      rationale,
      ...(verdict === "source-missing" ? { missingReason: "deleted" } : {}),
    };
    doc.wikiMeta.sourceCheck = {
      verdict,
      entries: [entry],
      checkedAt: now,
      checkedBy: "claude-sonnet",
      claimHash: "sha256:" + createHash("sha256").update(title).digest("hex"),
    };
    writeFileSync(f.path, JSON.stringify(doc));
  }
}

SHOTS["source-check-list"] = async () => {
  await seedSourceChecks();
  const { ctx, page } = await newPage();
  await open(page);
  await gotoClaims(page);
  // Source check 列の見出しを 2 回押して「注意が要る順」にする（1 回目は降順＝判定なしが先頭、2 回目で昇順）。
  // 向きの切り替えは dev の StrictMode で打ち消されるので、この図は vite build + preview（本番ビルド）で撮る
  const th = page.locator("th", { hasText: "Source check" }).first();
  await th.click();
  await page.waitForTimeout(400);
  await th.click();
  await page.waitForTimeout(1000);
  await page.mouse.move(1270, 790);
  await hideNoise(page);
  // 最後の判定行（Found in source の 2 行目）の下端で切る（次の行が半端に切れないように）
  const last = page.locator("tr", { hasText: "Daily equal flour" }).first();
  const lb = await last.boundingBox();
  await shot(page, "source-check-list", { clip: { x: 256, y: 0, width: VIEWPORT.width - 256, height: Math.ceil(lb.y + lb.height + 6) } });
  await ctx.close();
};

SHOTS["upkeep-source-check"] = async () => {
  await seedSourceChecks();
  const { ctx, page } = await newPage();
  await open(page);
  await gotoUpkeep(page, "Source check");
  // 「Review plan」を押して計画（対象数・モデル呼び出し数・検査できない内訳）を出す。計画の数え上げはローカルで LLM を呼ばない。Run は押さない
  await page.getByRole("button", { name: "Review plan", exact: true }).click();
  await page.getByText(/target\(s\) · \d+ model call\(s\)/).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.mouse.move(1270, 790);
  await hideNoise(page);
  // 計画を出すと枠（h-48）に収まらず上端の飾りアイコンが切れるので、アイコンだけ隠して撮る
  await page.addStyleTag({ content: "svg.opacity-30{visibility:hidden!important}" });
  // Needs review の最後の行の下端までを、メイン領域だけ切る
  const rows = page.getByRole("button", { name: "Check again" });
  const lb = await rows.last().boundingBox();
  await shot(page, "upkeep-source-check", { clip: { x: 256, y: 0, width: VIEWPORT.width - 256, height: Math.ceil(lb.y + lb.height + 24) } });
  await ctx.close();
};

/**
 * 手入れの「操作の記録」（appdata の maint-run-*）を JSON で直接書く（LLM は呼ばない）。
 * 形は src/features/knowledge-maintenance/run-store.ts / types.ts。
 * アプリで行った操作 3 件（うち 1 件は取り消し済み）と、MCP（claude-desktop）経由の 2 件
 */
const OPS_RUN_KEYS = [];
function seedOperations() {
  const wid = (title) => findJson("wiki", title).id;
  const ref = (title) => ({ wikiId: wid(title), title });
  const mk = (iso, uuid, trigger, actor, ops) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    const id = `maint-run-${ts}-${uuid}`;
    const run = {
      formatVersion: 1,
      id,
      startedAt: iso,
      endedAt: new Date(d.getTime() + 20_000).toISOString(),
      trigger,
      actor,
      operations: ops.map((o, i) => ({
        id: `${uuid.slice(0, 8)}-op${i + 1}`,
        startedAt: iso,
        endedAt: new Date(d.getTime() + 20_000).toISOString(),
        related: [],
        pages: [],
        flags: [],
        status: "applied",
        ...o,
      })),
    };
    writeFileSync(join(dataDir, "appdata", `${id}.json`), JSON.stringify(run));
    OPS_RUN_KEYS.push(id);
    return { id, opId: run.operations[0].id };
  };
  const app = { via: "app" };
  const mcp = { via: "mcp", client: "claude-desktop" };
  // 1. アプリ: 話題の統合（新しい）
  mk("2026-10-30T04:15:00.000Z", "c1000000-0000-4000-8000-000000000001", "merge_topics", app, [
    {
      kind: "merge_topics",
      subject: ref("Bread flour"),
      related: [{ ...ref("All-purpose flour"), role: "absorbed" }],
    },
  ]);
  // 2. MCP: 話題の書き直し
  mk("2026-10-30T03:40:00.000Z", "c2000000-0000-4000-8000-000000000002", "regenerate", mcp, [
    { kind: "regenerate", subject: ref("Oven calibration") },
  ]);
  // 3. MCP: 知見の作成（3 件）
  mk("2026-10-29T08:05:00.000Z", "c3000000-0000-4000-8000-000000000003", "mcp_generate", mcp, [
    {
      kind: "mcp_generate",
      created: [
        ref("Oven dial reads about 15 °C high across settings"),
        ref("Cold dough is easier to handle and shape"),
        ref("Overnight cold fermentation fits a weekday schedule"),
      ],
    },
  ]);
  // 4. アプリ: アーカイブ（あとで取り消す）
  const arch = mk("2026-10-29T01:30:00.000Z", "c4000000-0000-4000-8000-000000000004", "bulk_archive", app, [
    {
      kind: "archive",
      related: [{ ...ref("Whole wheat flour"), role: "archived" }],
      flags: [{ wikiId: wid("Whole wheat flour"), flag: "archivedAt", before: null, after: "2026-10-29T01:30:10.000Z" }],
    },
  ]);
  // 5. アプリ: 4 の取り消し
  mk("2026-10-29T01:50:00.000Z", "c5000000-0000-4000-8000-000000000005", "undo", app, [
    {
      kind: "undo",
      subject: ref("Whole wheat flour"),
      undoOf: { runId: arch.id, operationId: arch.opId },
      flags: [{ wikiId: wid("Whole wheat flour"), flag: "archivedAt", before: "2026-10-29T01:30:10.000Z", after: null }],
      undoResult: { pages: [], flags: [{ wikiId: wid("Whole wheat flour"), flag: "archivedAt", ok: true }] },
    },
  ]);
}
function removeOperations() {
  for (const id of OPS_RUN_KEYS) {
    try {
      unlinkSync(join(dataDir, "appdata", `${id}.json`));
    } catch {}
  }
}

SHOTS["upkeep-operations"] = async () => {
  seedOperations();
  const { ctx, page } = await newPage();
  try {
    await open(page);
    await gotoUpkeep(page, "Operations");
    await page.getByText("Undone", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(800);
    await page.mouse.move(1270, 790);
    await hideNoise(page);
    await shot(page, "upkeep-operations");
  } finally {
    await ctx.close();
    removeOperations();
  }
};

/**
 * 計画ノート（noteContexts に "plan"・1 列目が note-link の表・入力元の列）を隔離データに 1 本書く。
 * 見本の "Trial plan and log" は計画の表を持たない索引ノートなので、Genealogy の
 * Show steps / Expand below が出る計画ノートはこちらで用意する。工程は既存の Trial ノートに結ぶ
 */
const PLAN_NOTE_ID = "b0a7c0de-0003-4000-8000-0000000000a1";
const PLAN_NOTE_TITLE = "Trial series plan";
function writePlanNote() {
  const link = (title) => findJson("notes", title).id;
  const ops = [
    ["Baseline loaf", "65% hydration, bread flour", "", "Trial 1 - basic loaf at 65% hydration"],
    ["Cold ferment", "Overnight in the fridge", "Baseline loaf", "Trial 5 - overnight cold fermentation"],
  ];
  const tableId = "plan-table-1";
  const header = ["Operation", "Condition", "Planned input"];
  const table = mkTable(tableId, header, ops.map(([n, c, f]) => [n, c, f]));
  const para = (id, text) => ({
    id,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  });
  const now = new Date().toISOString();
  const noteLinks = {};
  for (const [n, , , t] of ops) noteLinks[n] = link(t);
  const doc = {
    version: 5,
    title: PLAN_NOTE_TITLE,
    noteContexts: ["plan"],
    pages: [
      {
        id: "pg-plan",
        title: PLAN_NOTE_TITLE,
        blocks: [para("plan-p1", "Two loaves, one change: the same dough, fermented overnight in the fridge."), table],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        tableMeta: {
          [tableId]: {
            caption: "Operations",
            columns: { Operation: ["note-link"], "Planned input": ["planned-input"] },
            noteLinks,
          },
        },
      },
    ],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  };
  writeFileSync(join(dataDir, "notes", `${PLAN_NOTE_ID}.json`), JSON.stringify(doc));
}

/** 右パネルの Graph → Genealogy（既定のサブタブ）。計画ノートを開いて、手順の表示スイッチと下の階層への導線を写す */
SHOTS["genealogy"] = async () => {
  writePlanNote();
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 900 } });
  await open(page);
  await page.evaluate(() => localStorage.setItem("graphium:graphSelectionLearned", "1"));
  await open(page, `#note/${PLAN_NOTE_ID}`);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Graph", exact: true }).first().click();
  await page.getByRole("button", { name: "Genealogy", exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Show steps").first().waitFor({ state: "visible", timeout: 15000 });
  // グラフがパネルに収まる（fit）まで待つ
  // 手順を表示オンだと全工程の手順が横に長く並び、右パネルでは読めない大きさになる。
  // オフにして工程だけの図にする（スイッチ自体は見えたまま）
  if (opt("--steps", "off") === "off") await page.getByRole("button", { name: "Show steps", exact: true }).first().click();
  await page.waitForTimeout(4500);
  await page.mouse.move(700, 10);
  await hideNoise(page);
  // 右パネルだけを切る（本文の幅に縮めても図の文字が読める大きさにする）。パネルは 856px から幅 384px
  const rf = await page.getByText("React Flow").first().boundingBox();
  await shot(page, opt("--out-name", "genealogy"), { clip: { x: 856, y: 46, width: 384, height: Math.ceil(rf.y + rf.height + 10 - 46) } });
  await ctx.close();
};

const targets = only ? [only] : Object.keys(SHOTS).filter((n) => n !== "probe");
for (const n of targets) {
  if (!SHOTS[n]) {
    console.error(`--only ${n} に一致する図がありません`);
    process.exit(1);
  }
  await SHOTS[n]();
}
await browser.close();
console.log(`出力先: ${OUTPUT_DIR}`);
