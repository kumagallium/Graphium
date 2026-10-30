/**
 * マニュアル用スクリーンショット撮影（音声ノートのブロック）
 *
 * 音声ノートはデスクトップ（Tauri）専用で、録音と AI が要るので本物のアプリでは撮りにくい。
 * Storybook の英語・パン作り世界観のストーリー（Manual (English, bread world)）を開いて、
 * ブロックだけを切り抜く。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-voice-note.mjs --port 6013
 *
 * 出力先: manual/public/screenshots/voice-note-block.png
 *         manual/public/screenshots/voice-note-settings.png（設定 > AI > 音声ノート）
 *         manual/public/screenshots/voice-note-ready.png（録音前のブロック）
 *         manual/public/screenshots/voice-note-recording.png（録音中のブロック + 画面下の録音バー）
 *         manual/public/screenshots/voice-note-write-out.png（Write out の 2 段メニュー）
 *         manual/public/screenshots/voice-note-hide-names.png（名前を伏せた清書と、伏せていないかもしれない名前）
 *
 * 1 枚ずつ撮る: --only <名前>（例: --only voice-note-recording）。省略すると全部撮る
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 6006;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
const want = (name) => !only || only === name;
const SB = `http://localhost:${port}/iframe.html`;
const PAD = 16;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
// 英語 UI で描く（i18n は localStorage の graphium_locale を見る）
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
if (want("voice-note-block")) {
await page.goto(`${SB}?id=blocks-meetingtranscriptblock--manual-english&viewMode=story`);
const card = page.locator("#storybook-root [contenteditable=false]").first();
await card.waitFor({ state: "visible" });
await page.waitForTimeout(1500);
const box = await card.boundingBox();
if (!box) throw new Error("ブロックが見つかりません");
const out = resolve(OUTPUT_DIR, "voice-note-block.png");
await page.screenshot({
  path: out,
  clip: { x: Math.max(0, box.x - PAD), y: Math.max(0, box.y - PAD), width: box.width + PAD * 2, height: box.height + PAD * 2 },
});
console.log(`saved ${out}`);

}

if (want("voice-note-settings")) {
// 設定 > AI > 音声ノートの節。ストーリー側の 680px の囲い（meta の 480px の囲いの内側）を切り抜く
await page.goto(`${SB}?id=molecules-meetingsettingssection--manual-english&viewMode=story`);
const section = page.locator("#storybook-root > div > div").first();
await section.waitFor({ state: "visible" });
await page.waitForTimeout(1000);
// 「Always hide these words」欄はコールバック（onMaskTerms）が要る。ストーリーの args は
// 関数を持てないので、Storybook のチャンネル経由でページ内から差し込む
await page.evaluate(() => {
  window.__STORYBOOK_ADDONS_CHANNEL__.emit("updateStoryArgs", {
    storyId: "molecules-meetingsettingssection--manual-english",
    updatedArgs: { onMaskTerms: () => {}, maskTerms: "Rye Street Bakery, Q4 pricing" },
  });
});
await page.waitForTimeout(1000);
const settingsOut = resolve(OUTPUT_DIR, "voice-note-settings.png");
await section.screenshot({ path: settingsOut });
console.log(`saved ${settingsOut}`);
}

// ── ここから追加の 4 枚 ──
const STORY = (id, extra = "") => `${SB}?id=${id}&viewMode=story${extra}`;
async function openCard(id, extra = "") {
  await page.goto(STORY(id, extra));
  const c = page.locator("#storybook-root [contenteditable=false]").first();
  await c.waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  return c;
}
// 撮る間だけ消すもの: BlockNote のハンドル
const hideNoise = () => page.addStyleTag({ content: ".bn-side-menu{visibility:hidden!important}" });
const clipOf = (box) => ({
  x: Math.max(0, box.x - PAD), y: Math.max(0, box.y - PAD), width: box.width + PAD * 2, height: box.height + PAD * 2,
});

if (want("voice-note-ready")) {
  const c = await openCard("blocks-meetingtranscriptblock--ready");
  await hideNoise();
  const o = resolve(OUTPUT_DIR, "voice-note-ready.png");
  await page.screenshot({ path: o, clip: clipOf(await c.boundingBox()) });
  console.log(`saved ${o}`);
}

if (want("voice-note-recording")) {
  const c = await openCard("blocks-meetingtranscriptblock--manual-english-recording");
  await hideNoise();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const cardPng = await page.screenshot({ clip: clipOf(await c.boundingBox()) });
  await page.goto(STORY("molecules-meetingrecorderbar--talking", "&args=elapsedMs:30000"));
  const bar = page.locator("div.fixed.bottom-4").first();
  await bar.waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
  const bb = await bar.boundingBox();
  // 影が切れないよう、バーの周りは広めに取る
  const barPng = await page.screenshot({ clip: { x: bb.x - 32, y: bb.y - 24, width: bb.width + 64, height: bb.height + 48 } });
  // 2 枚を縦に並べて 1 枚にする
  const comp = await ctx.newPage();
  await comp.setContent(
    `<body style="margin:0;background:${bg};display:inline-block;font-size:0">
      <img src="data:image/png;base64,${cardPng.toString("base64")}" style="display:block">
      <img src="data:image/png;base64,${barPng.toString("base64")}" style="display:block;margin:0 auto">
    </body>`,
  );
  await comp.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  // 画像は 2x の実寸なので CSS では半分の大きさで置く
  await comp.evaluate(() => document.querySelectorAll("img").forEach((i) => (i.style.width = i.naturalWidth / 2 + "px")));
  const o = resolve(OUTPUT_DIR, "voice-note-recording.png");
  await comp.locator("body").screenshot({ path: o });
  await comp.close();
  console.log(`saved ${o}`);
}

if (want("voice-note-write-out")) {
  const c = await openCard("blocks-meetingtranscriptblock--manual-english", "&args=canMinutes:!true;initialTab:cleanup");
  await hideNoise();
  await page.getByRole("button", { name: "Write out" }).click();
  await page.waitForTimeout(400);
  // 1 段目の Clean copy を選ぶ（2 段目が開く）
  const item = page.locator("[data-level='1']", { hasText: "Clean copy" }).first();
  await item.hover();
  await page.waitForTimeout(500);
  // 1 段目の先頭（Transcript (original)）にフォーカスが残ると、選択中に見えて紛らわしいので外す
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(300);
  const menuBox = await page.locator("[data-level='2']").first().boundingBox();
  const cbox = await c.boundingBox();
  const bottom = Math.max(cbox.y + cbox.height, menuBox.y + menuBox.height);
  const right = Math.max(cbox.x + cbox.width, menuBox.x + menuBox.width);
  const o = resolve(OUTPUT_DIR, "voice-note-write-out.png");
  await page.screenshot({
    path: o,
    clip: { x: Math.max(0, cbox.x - PAD), y: Math.max(0, cbox.y - PAD), width: right - cbox.x + PAD * 2, height: bottom - cbox.y + PAD * 2 },
  });
  console.log(`saved ${o}`);
}

if (want("voice-note-hide-names")) {
  const c = await openCard("blocks-meetingtranscriptblock--manual-english-hide-names");
  await hideNoise();
  const o = resolve(OUTPUT_DIR, "voice-note-hide-names.png");
  await page.screenshot({ path: o, clip: clipOf(await c.boundingBox()) });
  console.log(`saved ${o}`);
}
await browser.close();
