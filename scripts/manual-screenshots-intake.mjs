/**
 * マニュアル用スクリーンショット撮影（取り込みの受け皿と「Brought in」レポート）
 *
 * Storybook の IntakeModal（Idle / Done）を英語で開き、ダイアログだけを切り抜く。
 * レポートの数字は Storybook のチャンネルで state を差し替える（Done の既定は 38 件で大きすぎるため）。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-intake.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *
 * 出力先: manual/public/screenshots/intake-receptacle.png / intake-report.png
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
const SB = `http://localhost:${port}/iframe.html`;

const SHOTS = [
  { name: "intake-receptacle", id: "features-intake-intakemodal--idle", wait: "Drop a folder or files here" },
  {
    name: "intake-report",
    id: "features-intake-intakemodal--done",
    // ノート 2・素材 2・リンク 1・フォルダ 3・失敗 0。作成数 > 0 かつ AI 利用可で「Add all to knowledge」が出る
    state: {
      kind: "done", notes: 2, notesExisting: 0, materials: 2, linksResolved: 1, linksUnresolved: 0,
      failed: [], skipped: 0, skippedByExt: {}, folders: 3, materialsExisting: 0,
      createdNoteIds: ["note-1", "note-2"], createdMediaFileIds: ["file-1", "file-2"],
      ocrPending: 0, officeDerived: 0, officeSkipped: 0, aiAvailable: true,
    },
    wait: "Add all to knowledge",
  },
];

const browser = await chromium.launch({ headless: true });
for (const shot of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
  const page = await ctx.newPage();
  await page.goto(`${SB}?id=${shot.id}&viewMode=story`);
  await page.getByText("Close").or(page.getByText("Drop a folder or files here")).first().waitFor({ state: "visible", timeout: 60000 });
  if (shot.state) {
    // URL の args は入れ子の数値を拾わないので、ページ内からチャンネルで state ごと差し替える
    await page.evaluate(({ id, state }) => {
      window.__STORYBOOK_ADDONS_CHANNEL__.emit("updateStoryArgs", { storyId: id, updatedArgs: { state } });
    }, { id: shot.id, state: shot.state });
  }
  await page.getByText(shot.wait).first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(1000);
  const dialog = page.locator('div.fixed div.rounded-xl.shadow-lg').first();
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  // 出現のアニメーションが続くと locator.screenshot が安定待ちで落ちるので、箱を測って切り抜く
  await page.waitForTimeout(800);
  const box = await dialog.boundingBox();
  if (!box) throw new Error("ダイアログが見つかりません");
  await page.screenshot({ path: out, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  console.log(`saved ${out}`);
  await ctx.close();
}
await browser.close();
