/**
 * record-video.mjs が録った 3 本（WebM）と timeline.json から、1 本の mp4 を組む。
 *   - ナレッジ化の待ち時間は早送り（約 8 秒に圧縮）
 *   - 場面ごとに字幕を 1 行。Homebrew の ffmpeg には drawtext が無いので、字幕は Playwright で
 *     透過 PNG に描き、overlay で重ねる
 *
 * 使い方:
 *   node scripts/demo-bundle/assemble-video.mjs --in <record の --out> --out ~/Documents/graphium-demo-ja.mp4 --locale ja
 */
import { readFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : def; };
const IN = resolve(opt("in", "/tmp/demo-video"));
const OUTFILE = resolve(opt("out", resolve(IN, "demo.mp4")));
const LOCALE = opt("locale", "ja");
const FONT_FAMILY = "system-ui, -apple-system, sans-serif"; // headless Chromium では Hiragino の名指しが効かず明朝に落ちる。総称で指定する
const FAST_TARGET = Number(opt("fast-seconds", "8"));

const tl = JSON.parse(readFileSync(resolve(IN, "timeline.json"), "utf8"));
const seg = (name) => tl.segments.find((s) => s.name === name);
const markOf = (s, label) => s.marks.find((m) => m.label === label)?.t;
const work = resolve(IN, "work");
mkdirSync(work, { recursive: true });

// 字幕は 1 枚 1 文。途中にも末尾にも句点を置かず、主語（AI・ノート・記録）を省かない
const T = LOCALE === "ja" ? {
  intake1: "まずは手元の記録をフォルダごと取り込みます",
  intake2: "12 本のノートが入り、リンクもそのまま残っています",
  ingest: "AI に読ませてナレッジを作ります（ノートの本文は変わりません）",
  fast: "（早送り）12 本のノートを読んでいます",
  topics: "トピックが自動でまとまりました",
  topic: `このトピックは ${tl.topicNotes ?? "複数"} 本の記録から作られ、どの文も元の記録にたどれます`,
  chat: "ここでは内部参照で質問し、AI に自分の記録と読書メモから答えてもらいます",
  cite: "答えの根拠になった記録をそのまま開けます",
  lp: "AI をつながなくても、見本のノートで同じ流れを試せます",
} : {
  intake1: "Start by bringing in a folder of your records",
  intake2: "Twelve notes are in, with their links intact",
  ingest: "Let the AI read them and build the knowledge (the notes themselves don't change)",
  fast: "(fast forward) reading all twelve notes",
  topics: "Topics have formed on their own",
  topic: `This topic draws on ${tl.topicNotes ?? "several"} records, and each line traces back to one`,
  chat: "Here we ask with the Internal scope, so the AI answers from your records and reading notes",
  cite: "Open the record behind the answer right there",
  lp: "Without an AI connected, the sample notebook walks the same flow",
};

// 字幕を透過 PNG に描く（1 行・最大幅 1120px・白字に半透明の帯）
const browser = await chromium.launch({ headless: true });
const subPage = await (await browser.newContext({ viewport: { width: 1280, height: 200 }, deviceScaleFactor: 1 })).newPage();
let subN = 0;
async function renderSub(text) {
  const out = resolve(work, `sub-${String(subN++).padStart(2, "0")}.png`);
  await subPage.setContent(`<html><body style="margin:0;background:transparent"><div id="s" style="display:inline-block;max-width:1120px;padding:12px 22px;border-radius:10px;background:rgba(0,0,0,.58);color:#fff;font:500 30px/1.45 ${FONT_FAMILY};letter-spacing:.01em">${text.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div></body></html>`);
  const el = subPage.locator("#s");
  await el.screenshot({ path: out, omitBackground: true });
  return out;
}

let n = 0;
const pieces = [];
/** 1 片を切り出して mp4 にする。speed>1 で早送り。subs は [{text, from, to}]（入力の時刻、speed 適用前） */
async function piece(file, from, to, speed, subs) {
  const out = resolve(work, `p${String(n++).padStart(2, "0")}.mp4`);
  const inputs = ["-ss", String(from), "-to", String(to), "-i", file];
  let chain = `[0:v]setpts=PTS/${speed},fps=30,scale=1280:800:flags=lanczos,format=yuv420p[v0]`;
  let cur = "v0";
  for (const [i, s] of subs.entries()) {
    const png = await renderSub(s.text);
    inputs.push("-i", png);
    const a = Math.max(0, ((s.from ?? from) - from) / speed);
    const b = Math.max(a + 0.3, ((s.to ?? to) - from) / speed);
    const next = `v${i + 1}`;
    chain += `;[${cur}][${i + 1}:v]overlay=(W-w)/2:H-h-40:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[${next}]`;
    cur = next;
  }
  const argv = ["-y", ...inputs, "-an", "-filter_complex", chain, "-map", `[${cur}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30", out];
  execFileSync("ffmpeg", argv, { stdio: ["ignore", "ignore", "inherit"] });
  pieces.push(out);
  console.log(`[assemble] ${out} (${from.toFixed(1)}→${to.toFixed(1)} x${speed}, subs ${subs.length})`);
}

function durationOf(file) {
  const r = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return Number(r.trim());
}

// ── 場面 1 ──
{
  const s = seg("1-intake"); const d = durationOf(s.file);
  const app = markOf(s, "app") ?? 0, dropped = markOf(s, "files-dropped") ?? 2, done = markOf(s, "intake-done") ?? d;
  await piece(s.file, Math.max(0, app - 0.5), d, 1, [
    { text: T.intake1, from: app, to: dropped + 1 },
    { text: T.intake2, from: done, to: d },
  ]);
}
// ── 場面 2 ──
{
  const s = seg("2-knowledge"); const d = durationOf(s.file);
  const list = markOf(s, "list") ?? 0, click = markOf(s, "ingest-click") ?? 5, idone = markOf(s, "ingest-done") ?? click + 10;
  const topics = markOf(s, "topics") ?? idone, topic = markOf(s, "topic-open") ?? topics + 3;
  const typed = markOf(s, "question-typed") ?? topic + 10, sent = markOf(s, "question-sent") ?? typed, adone = markOf(s, "answer-done") ?? sent + 10;
  const cite = markOf(s, "citation-click") ?? adone;
  // トピックの字幕はチャットを開くまで。chat-open の印が無い古い録画は @ を押した 4 秒後
  const mention = markOf(s, "mention-click") ?? topic + 4;
  const chatOpen = markOf(s, "chat-open") ?? Math.min(mention + 4, typed - 2);
  const normalUntil = Math.min(click + 10, idone);
  await piece(s.file, Math.max(0, list - 0.5), normalUntil, 1, [{ text: T.ingest, from: list, to: normalUntil }]);
  const fastLen = Math.max(1, idone - 2 - normalUntil);
  await piece(s.file, normalUntil, idone - 2, Math.max(1, fastLen / FAST_TARGET), [{ text: T.fast }]);
  await piece(s.file, idone - 2, d, 1, [
    { text: T.topics, from: topics, to: topic },
    { text: T.topic, from: topic, to: chatOpen },
    { text: T.chat, from: chatOpen, to: adone + 1 },
    { text: T.cite, from: cite, to: d },
  ]);
}
// ── 場面 3 ──
{
  const s = seg("3-landing"); const d = durationOf(s.file);
  const lp = markOf(s, "lp") ?? 0;
  await piece(s.file, Math.max(0, lp - 0.5), d, 1, [{ text: T.lp, from: lp, to: d }]);
}

// ── つなぐ ──
const inputs = pieces.flatMap((p) => ["-i", p]);
const chain = pieces.map((_, i) => `[${i}:v]`).join("") + `concat=n=${pieces.length}:v=1:a=0[v]`;
execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", chain, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", OUTFILE], { stdio: ["ignore", "ignore", "inherit"] });
await browser.close();
console.log(`[assemble] ${OUTFILE} (${durationOf(OUTFILE).toFixed(1)}s)`);
