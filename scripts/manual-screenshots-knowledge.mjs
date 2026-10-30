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
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
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
