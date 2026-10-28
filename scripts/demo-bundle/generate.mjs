/**
 * 見本の束（public/demo/<id>.json）の材料を作る — 本物の Web 版 UI を Playwright で操作して、
 * Markdown のノートを取り込み、ナレッジ化（知見・トピック・洞察・出典照合）を実際の AI で回す。
 *
 * 手で書いた「AI の出力」を見本にしない。見本に入るナレッジは、このスクリプトで
 * Graphium 自身が作ったものだけ。
 *
 * 前提（隔離した dev を自分で立てておく。本番や共有の data に書かないため）:
 *   DATA_DIR=<scratch> PORT=3931 pnpm exec tsx --env-file .env src/server/index.ts
 *   PORT=3931 pnpm exec vite --port 5931 --strictPort --host 127.0.0.1
 *
 * 使い方:
 *   node --env-file=/path/to/.env scripts/demo-bundle/generate.mjs \
 *     --url http://127.0.0.1:5931/Graphium/app/ \
 *     --notes scripts/demo-bundle/notes/ja --locale ja --shots <dir> --data-dir <DATA_DIR>
 *
 * .env には AI の鍵（SAKURA_AI_ENGINE_KEY）を入れておく。鍵はブラウザの localStorage に
 * 直接書き込み、画面にもログにも出さない。
 *
 * 終わったら DATA_DIR の notes/ と wiki/ が材料になる。束にするのは pack.mjs。
 */
import { chromium } from "playwright";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const URL = opt("url", "http://127.0.0.1:5931/Graphium/app/");
const NOTES_DIR = resolve(opt("notes", "scripts/demo-bundle/notes/ja"));
const LOCALE = opt("locale", "ja");
const SHOTS = resolve(opt("shots", "/tmp/demo-shots"));
const API_BASE = opt("api-base", "https://api.ai.sakura.ad.jp/v1");
const MODEL_ID = opt("model-id", "gpt-oss-120b");
const EMBED_MODEL_ID = opt("embed-model-id", "multilingual-e5-large");
const VENDOR = LOCALE === "ja" ? "さくらのAI Engine" : "Sakura AI Engine";
const MODEL_NAME = opt("model-name", `${VENDOR} ${MODEL_ID}`);
const EMBED_NAME = opt("embed-name", `${VENDOR} ${EMBED_MODEL_ID}`);
const DATA_DIR = resolve(opt("data-dir", process.env.DATA_DIR ?? ""));
// 取り込み後に enrich.mjs で足す工程ブロックの指定（省略時は派生リンクの写しだけ）
const ENRICH_STEPS = opt("enrich-steps", "");
const KEY = process.env.SAKURA_AI_ENGINE_KEY;
if (!KEY) {
  console.error("SAKURA_AI_ENGINE_KEY が環境に無い（node --env-file=... で渡す）");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const files = readdirSync(NOTES_DIR)
  .filter((f) => /\.md$/i.test(f))
  .sort()
  .map((f) => resolve(NOTES_DIR, f));
if (files.length === 0) {
  console.error(`Markdown が無い: ${NOTES_DIR}`);
  process.exit(1);
}
console.log(`[gen] notes: ${files.length} files from ${NOTES_DIR}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: LOCALE === "ja" ? "ja-JP" : "en-US" });

// 起動前に localStorage を仕込む: 言語 / ようこそ済み / 機能フラグ / AI の接続先（鍵は env から）
await ctx.addInitScript(
  ({ locale, modelName, embedName, apiBase, modelId, embedModelId, key }) => {
    localStorage.setItem("graphium_locale", locale);
    localStorage.setItem("graphium_welcome_shown", "1");
    // 埋め込みモデルも登録する。無いと取り込みの埋め込みが 500 になり、洞察（埋め込み類似で候補を選ぶ）が作れない
    const settings = {
      model: modelName,
      embeddingModel: embedName,
      features: { claims: true, insights: true, worldGrounding: false, autoFullCheck: false, asterism: false, sourceSummaries: false },
    };
    localStorage.setItem("graphium-settings", JSON.stringify(settings));
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
  // 鍵が万一ログに出ないように、ヘッダーらしきものは落とす
  if (/apiKey|X-LLM-API-Key/i.test(t)) return;
  if (m.type() === "error" || /\[ingest\]|\[wiki|\[topic|\[atomize|\[source-check/i.test(t)) console.log(`[browser:${m.type()}] ${t.slice(0, 300)}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));

const shot = async (name) => {
  const p = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`[gen] shot ${p}`);
};

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("01-boot");

// 保存先が「このサーバー」であることを確かめる（隔離した DATA_DIR に書くため）。
// ようこそは飛ばしているので、/api/storage/capabilities で見る
const caps = await page.evaluate(async () => {
  const r = await fetch("/api/storage/capabilities");
  return r.ok ? r.json() : null;
});
console.log(`[gen] storage capabilities: ${JSON.stringify(caps)}`);
if (!caps?.serverStorage) {
  console.error("サーバー保存が使えない（vite の /api が自分の API サーバーに向いていない）。中止");
  await browser.close();
  process.exit(1);
}

// ── 1. ファイル取り込み（サイドバー → 隠し input に Markdown を渡す） ──
const intakeLabel = LOCALE === "ja" ? "ファイル取り込み" : "Bring in files";
await page.getByRole("button", { name: intakeLabel }).first().click();
await page.waitForTimeout(800);
const fileInput = page.locator('input[type="file"][multiple][accept]');
await fileInput.setInputFiles(files);
// 「取り込みました」が出るまで待つ
const doneTitle = LOCALE === "ja" ? "取り込みました" : "Brought in";
await page.getByText(doneTitle, { exact: false }).first().waitFor({ timeout: 120_000 });
await page.waitForTimeout(1000);
await shot("02-intake-done");
// 閉じる（Escape で閉じる想定。閉じなければ次の遷移で消える）
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// ── 1.5 取り込んだノートに派生リンクと工程ブロックを足す（ナレッジ化の前） ──
// サーバー保存（DATA_DIR）のファイルを直接書き換えるので、終わったら読み直す
{
  const enrichArgs = [resolve(__dirname, "enrich.mjs"), "--data-dir", DATA_DIR];
  if (ENRICH_STEPS) enrichArgs.push("--steps", resolve(ENRICH_STEPS));
  const r = spawnSync(process.execPath, enrichArgs, { encoding: "utf8" });
  console.log((r.stdout || "").trim());
  if (r.status !== 0) {
    console.error("[gen] enrich failed:", r.stderr);
    await browser.close();
    process.exit(1);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
}

// ── 2. ノート一覧で全選択 → 一括ナレッジ化 ──
await page.goto(`${URL}#notes`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const selectAll = page.getByRole("checkbox", { name: LOCALE === "ja" ? "すべて選択" : "Select all" });
await selectAll.first().click();
await page.waitForTimeout(500);
const ingestBtn = page.getByRole("button", { name: LOCALE === "ja" ? /件をナレッジ化/ : /to Knowledge/ });
const ingestLabel = await ingestBtn.first().textContent();
console.log(`[gen] clicking: ${ingestLabel}`);
await shot("03-selected");
await ingestBtn.first().click();

// ── 3. 終わるまで待つ ──
// ナレッジ化のキューはブラウザの中にあり、ページを動かすと消える。終わったかどうかは
// 画面の文言ではなく、隔離 DATA_DIR の ai-usage-log.json（サーバーが 1 呼び出し 1 行で書く）
// の伸びで見る: 取り込み（wiki.ingest）がノートの数だけ走り、そのあと 3 分間なにも増えなければ終わり
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
const started = Date.now();
const MAX_MS = 90 * 60 * 1000;
const QUIET_MS = 180_000;
let lastTotal = -1;
let changedAt = Date.now();
while (Date.now() - started < MAX_MS) {
  await page.waitForTimeout(15_000);
  const u = readUsage();
  if (u.total !== lastTotal) {
    lastTotal = u.total;
    changedAt = Date.now();
  }
  const wikiDir = resolve(DATA_DIR, "wiki");
  const wikiCount = existsSync(wikiDir) ? readdirSync(wikiDir).filter((f) => f.endsWith(".json")).length : 0;
  const elapsed = Math.round((Date.now() - started) / 1000);
  const ingested = u.by["wiki.ingest"] ?? 0;
  console.log(`[gen] t+${elapsed}s calls=${u.total} ingest=${ingested}/${files.length} wiki=${wikiCount} by=${JSON.stringify(u.by)}`);
  if (ingested >= files.length && Date.now() - changedAt > QUIET_MS) break;
}
await shot("04-ingest-done");

// ── 4. ナレッジ一覧を一枚撮って終わり ──
await page.goto(`${URL}#knowledge/topic`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("05-topics");
await page.goto(`${URL}#knowledge/claim`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("06-claims");
await page.goto(`${URL}#knowledge/atom`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("07-atoms");

await browser.close();
console.log("[gen] done");
