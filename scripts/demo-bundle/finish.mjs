/**
 * generate.mjs のあとの仕上げ — 同じ隔離 dev に対して、
 *   1. ノート一覧で全選択 → 一括ナレッジ化（前の回で失敗・未処理だったノートだけが対象になる。
 *      ナレッジ化済みで変わっていないノートは Graphium 側が外す）
 *   2. 設定 → ナレッジ管理 → 「洞察を発見」（知見をまたぐ洞察 = atom を作る。取り込み時の自動発見は
 *      一括の経路では走らないので、ここで全域スキャンを 1 回回す）
 * を実際の UI で行う。待ち方は generate.mjs と同じ（DATA_DIR の ai-usage-log.json の伸び）。
 *
 * 使い方:
 *   node --env-file=/path/to/.env scripts/demo-bundle/finish.mjs \
 *     --url http://127.0.0.1:5931/Graphium/app/ --locale ja --data-dir <DATA_DIR> --shots <dir>
 *   --skip-ingest で 1 を飛ばす / --skip-insights で 2 を飛ばす
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const URL = opt("url", "http://127.0.0.1:5931/Graphium/app/");
const LOCALE = opt("locale", "ja");
const DATA_DIR = resolve(opt("data-dir", process.env.DATA_DIR ?? ""));
const SHOTS = resolve(opt("shots", "/tmp/demo-shots"));
const API_BASE = opt("api-base", "https://api.ai.sakura.ad.jp/v1");
const MODEL_ID = opt("model-id", "gpt-oss-120b");
const EMBED_MODEL_ID = opt("embed-model-id", "multilingual-e5-large");
const VENDOR = LOCALE === "ja" ? "さくらのAI Engine" : "Sakura AI Engine";
const MODEL_NAME = opt("model-name", `${VENDOR} ${MODEL_ID}`);
const EMBED_NAME = opt("embed-name", `${VENDOR} ${EMBED_MODEL_ID}`);
const KEY = process.env.SAKURA_AI_ENGINE_KEY;
if (!KEY) {
  console.error("SAKURA_AI_ENGINE_KEY が環境に無い（node --env-file=... で渡す）");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const L = LOCALE === "ja"
  ? { selectAll: "すべて選択", ingest: /件をナレッジ化/, settings: "設定", tab: "ナレッジ管理", discover: "洞察を発見" }
  : { selectAll: "Select all", ingest: /to Knowledge/, settings: "Settings", tab: "Knowledge", discover: "Discover Insights" };

const readUsage = () => {
  try {
    const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "ai-usage-log.json"), "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.entries ?? [];
    const by = {};
    for (const e of arr) by[e.feature ?? "?"] = (by[e.feature ?? "?"] ?? 0) + 1;
    return { total: arr.length, by };
  } catch {
    return { total: 0, by: {} };
  }
};

/** 使用量ログが quietMs のあいだ増えなくなるまで待つ（最初の呼び出しが来るまでは minWaitMs 待つ） */
async function waitQuiet(page, label, { quietMs = 150_000, minWaitMs = 30_000, maxMs = 60 * 60 * 1000 } = {}) {
  const started = Date.now();
  let last = readUsage().total;
  let changedAt = Date.now();
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(10_000);
    const u = readUsage();
    if (u.total !== last) {
      last = u.total;
      changedAt = Date.now();
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[finish:${label}] t+${elapsed}s calls=${u.total} by=${JSON.stringify(u.by)}`);
    if (Date.now() - started > minWaitMs && Date.now() - changedAt > quietMs) break;
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: LOCALE === "ja" ? "ja-JP" : "en-US" });
await ctx.addInitScript(
  ({ locale, modelName, embedName, apiBase, modelId, embedModelId, key }) => {
    localStorage.setItem("graphium_locale", locale);
    localStorage.setItem("graphium_welcome_shown", "1");
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({
        model: modelName,
        embeddingModel: embedName,
        features: { claims: true, insights: true, worldGrounding: false, autoFullCheck: false, asterism: false, sourceSummaries: false },
      }),
    );
    localStorage.setItem(
      "graphium-llm-models",
      JSON.stringify([
        { id: "demo-gen-model", name: modelName, provider: "openai-compatible", modelId, apiKey: key, apiBase },
        { id: "demo-gen-embed", name: embedName, provider: "openai-compatible", modelId: embedModelId, apiKey: key, apiBase },
      ]),
    );
  },
  { locale: LOCALE, modelName: MODEL_NAME, embedName: EMBED_NAME, apiBase: API_BASE, modelId: MODEL_ID, embedModelId: EMBED_MODEL_ID, key: KEY },
);
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/apiKey|X-LLM-API-Key/i.test(t)) return;
  if (m.type() === "error") console.log(`[browser:error] ${t.slice(0, 200)}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));
// 「洞察を発見」は window.confirm で回数を確認してくる → 受け入れる
page.on("dialog", async (d) => {
  console.log(`[finish] dialog: ${d.message().slice(0, 200)}`);
  await d.accept();
});
const shot = async (name) => {
  const p = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`[finish] shot ${p}`);
};

// ── 1. 一括ナレッジ化の 2 回目（取りこぼしだけが対象） ──
if (!has("skip-ingest")) {
  await page.goto(`${URL}#notes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("checkbox", { name: L.selectAll }).first().click();
  await page.waitForTimeout(500);
  const btn = page.getByRole("button", { name: L.ingest });
  if ((await btn.count()) > 0) {
    console.log(`[finish] clicking: ${await btn.first().textContent()}`);
    const before = readUsage().by["wiki.ingest"] ?? 0;
    await btn.first().click();
    await page.waitForTimeout(20_000);
    const after = readUsage().by["wiki.ingest"] ?? 0;
    if (after > before) {
      await waitQuiet(page, "ingest");
    } else {
      console.log("[finish] 取りこぼしは無かった（取り込みの呼び出しが増えなかった）");
    }
  }
  await shot("11-reingest");
}

// ── 2. 洞察を発見（設定 → ナレッジ管理） ──
if (!has("skip-insights")) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: L.settings }).first().click();
  await page.waitForTimeout(1000);
  // 設定はポータルのモーダル。同じ語（英語の "Knowledge"）がサイドバーにもあるので、モーダルの中だけで探す
  const modal = page.locator('[data-modal-portal="true"]').last();
  await modal.getByRole("tab", { name: L.tab }).or(modal.getByRole("button", { name: L.tab })).first().click();
  await page.waitForTimeout(1000);
  await shot("12-maintenance");
  const discover = modal.getByRole("button", { name: L.discover });
  await discover.first().scrollIntoViewIfNeeded();
  await discover.first().click();
  await page.waitForTimeout(5000);
  await waitQuiet(page, "insights", { quietMs: 120_000, minWaitMs: 20_000 });
  await shot("13-insights-done");
}

await browser.close();
console.log("[finish] done");
