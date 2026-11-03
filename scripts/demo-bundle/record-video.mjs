/**
 * 主要体験のデモ動画を撮る（docs/internal/demo-video-script.md の台本）。
 *
 *   取り込み → ナレッジ化 → トピック一覧 → 1 つのトピックに複数の記録 → @ で記録へ →
 *   チャットで聞く → 引用から出典へ → LP
 *
 * 本物の Web UI を Playwright で操作し、本物の AI（さくら gpt-oss-120b）で回す。録画は
 * Playwright の recordVideo（WebM・1280×800）。場面ごとに context を分けて 3 本に録り、
 * 時刻の記録（timeline.json）を assemble-video.mjs が読んで、待ち時間の早送りと字幕を
 * ffmpeg で付ける。
 *
 * 前提（generate.mjs と同じ隔離 dev）:
 *   DATA_DIR=<scratch> PORT=3931 pnpm exec tsx --env-file .env src/server/index.ts
 *   PORT=3931 pnpm exec vite --port 5931 --strictPort --host 127.0.0.1
 *
 * 使い方:
 *   node --env-file=/path/to/.env scripts/demo-bundle/record-video.mjs \
 *     --url http://127.0.0.1:5931/Graphium/app/ --notes scripts/demo-bundle/notes/ja \
 *     --locale ja --data-dir <DATA_DIR> --enrich-steps scripts/demo-bundle/steps.ja.json \
 *     --question "新玉ねぎで作るなら、炒め時間はどれくらいにすべき？ これまでの試作を踏まえて教えて" \
 *     --out <dir>
 */
import { chromium } from "playwright";
import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync, renameSync } from "fs";
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
const LP_URL = URL.replace(/app\/?$/, "");
const NOTES_DIR = resolve(opt("notes", "scripts/demo-bundle/notes/ja"));
const LOCALE = opt("locale", "ja");
const DATA_DIR = resolve(opt("data-dir", process.env.DATA_DIR ?? ""));
const ENRICH_STEPS = opt("enrich-steps", "");
const QUESTION = opt("question", "");
// 開くトピックの題名に含まれていてほしい語（| 区切り・大文字小文字は区別しない）。
// 合うものが無ければ元ノートが一番多いトピック。引数から正規表現は組まない
const TOPIC_WORDS = opt("topic-match", LOCALE === "ja" ? "玉ねぎ|飴色" : "onion|crumb|hydration").split("|").map((w) => w.trim().toLowerCase()).filter(Boolean);
const topicMatches = (title) => TOPIC_WORDS.some((w) => title.toLowerCase().includes(w));
const OUT = resolve(opt("out", "/tmp/demo-video"));
// 1 場面だけ撮り直す（"1-intake" | "2-knowledge" | "3-landing"）。既存の timeline.json のその場面を差し替える
const ONLY = opt("only", "");
const wants = (name) => !ONLY || ONLY === name;
const API_BASE = opt("api-base", "https://api.ai.sakura.ad.jp/v1");
const MODEL_ID = opt("model-id", "gpt-oss-120b");
const EMBED_MODEL_ID = opt("embed-model-id", "multilingual-e5-large");
const VENDOR = LOCALE === "ja" ? "さくらのAI Engine" : "Sakura AI Engine";
const MODEL_NAME = `${VENDOR} ${MODEL_ID}`;
const EMBED_NAME = `${VENDOR} ${EMBED_MODEL_ID}`;
const KEY = process.env.SAKURA_AI_ENGINE_KEY;
if (!KEY) { console.error("SAKURA_AI_ENGINE_KEY が環境に無い"); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const L = LOCALE === "ja"
  ? { intake: "ファイル取り込み", done: "取り込みました", selectAll: "すべて選択", ingest: /件をナレッジ化/, newChat: "新しいチャット", ask: "気になることを聞いてみましょう", stop: "停止" }
  : { intake: "Bring in files", done: "Brought in", selectAll: "Select all", ingest: /to Knowledge/, newChat: "New chat", ask: "Ask something", stop: "Stop" };

const files = readdirSync(NOTES_DIR).filter((f) => /\.md$/i.test(f)).sort().map((f) => resolve(NOTES_DIR, f));
const readUsage = () => {
  try {
    const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "ai-usage-log.json"), "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.entries ?? [];
    const by = {};
    for (const e of arr) by[e.feature ?? "?"] = (by[e.feature ?? "?"] ?? 0) + 1;
    return { total: arr.length, by };
  } catch { return { total: 0, by: {} }; }
};

const browser = await chromium.launch({ headless: true });
const timeline = { segments: [] };

/** 録画つきの context を作る。seed=false なら localStorage を仕込まない（LP 用） */
async function openSegment(name, { seed = true } = {}) {
  const dir = resolve(OUT, `raw-${name}`);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: LOCALE === "ja" ? "ja-JP" : "en-US",
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  });
  if (seed) {
    await ctx.addInitScript(
      ({ locale, modelName, embedName, apiBase, modelId, embedModelId, key }) => {
        localStorage.setItem("graphium_locale", locale);
        localStorage.setItem("graphium_welcome_shown", "1");
        // 右下に出る「画面が狭く感じたら」の案内を出さない（動画の邪魔になる）
        localStorage.setItem("graphium-zoom-hint-dismissed", "1");
        localStorage.setItem("graphium-settings", JSON.stringify({
          model: modelName, embeddingModel: embedName,
          features: { claims: true, insights: true, worldGrounding: false, autoFullCheck: false, asterism: false, sourceSummaries: false },
        }));
        localStorage.setItem("graphium-llm-models", JSON.stringify([
          { id: "demo-gen-model", name: modelName, provider: "openai-compatible", modelId, apiKey: key, apiBase },
          { id: "demo-gen-embed", name: embedName, provider: "openai-compatible", modelId: embedModelId, apiKey: key, apiBase },
        ]));
      },
      { locale: LOCALE, modelName: MODEL_NAME, embedName: EMBED_NAME, apiBase: API_BASE, modelId: MODEL_ID, embedModelId: EMBED_MODEL_ID, key: KEY },
    );
  } else {
    await ctx.addInitScript((locale) => { localStorage.setItem("graphium_locale", locale); }, LOCALE);
  }
  const page = await ctx.newPage();
  const t0 = Date.now();
  const seg = { name, dir, marks: [] };
  timeline.segments.push(seg);
  const mark = (label) => { seg.marks.push({ label, t: (Date.now() - t0) / 1000 }); console.log(`[rec:${name}] ${label} @${((Date.now() - t0) / 1000).toFixed(1)}s`); };
  const close = async () => {
    const video = page.video();
    await ctx.close();
    const path = await video.path();
    const out = resolve(OUT, `${name}.webm`);
    renameSync(path, out);
    seg.file = out;
    console.log(`[rec:${name}] saved ${out}`);
  };
  return { page, mark, close };
}

// ── 場面 1: 取り込み ──
if (wants("1-intake")) {
  const { page, mark, close } = await openSegment("1-intake");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  mark("app");
  await page.getByRole("button", { name: L.intake }).first().click();
  await page.waitForTimeout(1500);
  mark("intake-open");
  await page.locator('input[type="file"][multiple][accept]').setInputFiles(files);
  mark("files-dropped");
  await page.getByText(L.done, { exact: false }).first().waitFor({ timeout: 120_000 });
  mark("intake-done");
  await page.waitForTimeout(3500);
  await close();
}

// ── 画面の外: 派生リンクと工程を足す ──
if (wants("2-knowledge")) {
  const enrichArgs = [resolve(__dirname, "enrich.mjs"), "--data-dir", DATA_DIR];
  if (ENRICH_STEPS) enrichArgs.push("--steps", resolve(ENRICH_STEPS));
  const r = spawnSync(process.execPath, enrichArgs, { encoding: "utf8" });
  console.log((r.stdout || "").trim());
}

// ── 場面 2: ナレッジ化 → トピック → 記録へ → チャット → 出典へ ──
if (wants("2-knowledge")) {
  const { page, mark, close } = await openSegment("2-knowledge");
  await page.goto(`${URL}#notes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  mark("list");
  await page.getByRole("checkbox", { name: L.selectAll }).first().click();
  await page.waitForTimeout(1200);
  mark("select-all");
  await page.getByRole("button", { name: L.ingest }).first().click();
  mark("ingest-click");
  // 終わるまで待つ（generate.mjs と同じ: 使用量ログが 2 分半増えなくなるまで）
  const started = Date.now();
  let last = readUsage().total; let changedAt = Date.now();
  while (Date.now() - started < 60 * 60 * 1000) {
    await page.waitForTimeout(10_000);
    const u = readUsage();
    if (u.total !== last) { last = u.total; changedAt = Date.now(); }
    const ingested = u.by["wiki.ingest"] ?? 0;
    console.log(`[rec] t+${Math.round((Date.now() - started) / 1000)}s calls=${u.total} ingest=${ingested}/${files.length}`);
    if (ingested >= files.length && Date.now() - changedAt > 150_000) break;
  }
  mark("ingest-done");
  await page.waitForTimeout(1500);
  // トピック一覧
  await page.goto(`${URL}#knowledge/topic`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  mark("topics");
  await page.mouse.wheel(0, 300); await page.waitForTimeout(1500); await page.mouse.wheel(0, -300); await page.waitForTimeout(1000);
  // 元ノートが一番多いトピックを開く
  const wikiDir = resolve(DATA_DIR, "wiki");
  const topics = readdirSync(wikiDir).filter((f) => f.endsWith(".json"))
    .map((f) => ({ id: f.replace(/\.json$/, ""), doc: JSON.parse(readFileSync(resolve(wikiDir, f), "utf8")) }))
    .filter((w) => w.doc.wikiMeta?.kind === "topic")
    .sort((a, b) => (b.doc.wikiMeta.derivedFromNotes?.length ?? 0) - (a.doc.wikiMeta.derivedFromNotes?.length ?? 0));
  const topic = topics.find((w) => topicMatches(w.doc.title) && (w.doc.wikiMeta.derivedFromNotes?.length ?? 0) >= 4) ?? topics[0];
  console.log(`[rec] topic: ${topic.doc.title} (${topic.doc.wikiMeta.derivedFromNotes.length} notes)`);
  timeline.topicTitle = topic.doc.title; timeline.topicNotes = topic.doc.wikiMeta.derivedFromNotes.length;
  await page.goto(`${URL}#knowledge/topic/${topic.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  mark("topic-open");
  await page.mouse.wheel(0, 250); await page.waitForTimeout(2000);
  // 要点の @ を押して記録へ
  const mention = page.locator(".bn-editor").getByText(/^@/).first();
  if (await mention.count()) { await mention.click(); mark("mention-click"); await page.waitForTimeout(3500); await page.goBack({ waitUntil: "networkidle" }); await page.waitForTimeout(2000); }
  // チャット
  await page.goto(`${URL}#chats`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: L.newChat }).first().click();
  mark("chat-open");
  await page.waitForTimeout(800);
  const box = page.getByRole("textbox", { name: L.ask }).first();
  await box.click();
  await box.pressSequentially(QUESTION, { delay: 45 });
  mark("question-typed");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  mark("question-sent");
  // 答えが終わったかは、画面の文言でなく保存された会話（appdata の standalone-chat:<id>）で見る。
  // 停止ボタンは「考え中…」のあいだ出ないことがあり、画面だけ見ると途中で切ってしまう
  const chatSaved = () => {
    const dir = resolve(DATA_DIR, "appdata");
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => {
      if (!f.startsWith("standalone-chat:")) return false;
      try { const c = JSON.parse(readFileSync(resolve(dir, f), "utf8")); return (c.messages ?? []).filter((m) => m.role === "assistant").length >= 1; } catch { return false; }
    });
  };
  const cs = Date.now();
  while (Date.now() - cs < 6 * 60 * 1000) { if (chatSaved()) break; await page.waitForTimeout(1500); }
  // 題名の生成など、保存後の呼び出しが落ち着くまで少し待つ
  await page.waitForTimeout(4000);
  mark("answer-done");
  // 引用から出典へ（答えの中の 📝 ボタン = 記録への引用）
  const cite = page.getByRole("button", { name: /^📝/ }).first();
  if (await cite.count()) { await cite.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500); await cite.click(); mark("citation-click"); await page.waitForTimeout(4500); }
  else console.log("[rec] 引用のボタンが見つからなかった");
  await close();
}

// ── 場面 3: LP（仕込み無しの context。言語の localStorage だけでも index.html の再訪
//    リダイレクトが app へ飛ばすので、?intro=1 で LP に留める） ──
if (wants("3-landing")) {
  const { page, mark, close } = await openSegment("3-landing", { seed: false });
  await page.goto(`${LP_URL}?intro=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  mark("lp");
  const btn = page.getByRole("link", { name: LOCALE === "ja" ? "見本のノートを見る" : "See a sample notebook" }).first();
  if (await btn.count()) { await btn.hover(); }
  await page.waitForTimeout(3500);
  await close();
}

await browser.close();
const tlPath = resolve(OUT, "timeline.json");
if (ONLY && existsSync(tlPath)) {
  // 撮り直した場面だけ差し替え、ほかの場面と topicTitle などはそのまま
  const prev = JSON.parse(readFileSync(tlPath, "utf8"));
  prev.segments = prev.segments.map((s) => timeline.segments.find((n) => n.name === s.name) ?? s);
  for (const n of timeline.segments) if (!prev.segments.some((s) => s.name === n.name)) prev.segments.push(n);
  Object.assign(timeline, { ...prev, segments: prev.segments });
}
writeFileSync(tlPath, JSON.stringify(timeline, null, 2));
console.log(`[rec] timeline: ${resolve(OUT, "timeline.json")}`);
console.log("[rec] done");
