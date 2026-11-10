/**
 * マニュアル用スクリーンショット撮影（ノートを開かずに話すチャット画面）
 *
 * チャット画面（左ナビのチャットのタブ・会話・横の全体グラフ）と、画像を添えた会話を、
 * Storybook の英語・パン作り世界観のストーリー（Manual (English, bread world)）から撮る。本物のアプリでは AI が付けた題の
 * 一覧を用意しにくいので、Storybook で撮る（共有ライブラリ・音声ノートと同じ作法）。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6016 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-chat.mjs --port 6016
 *
 * 出力先: manual/public/screenshots/chat-images.png（画像を添えた会話と、入力欄に添えた画像）
 *         manual/public/screenshots/chat-beside-graph.png（左ナビのチャットのタブ・会話・横の全体グラフ。
 *           画面全体を撮る。グラフの配置が終わり、答えの一度きりの火花が消えるまで待ち、触れたページが収まるまで寄せる）
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

const shots = [
  // 入力欄の画像は play が貼り付けるので、送る前の画像の列が出るまで待つ
  { story: "molecules-chatimages--manual-english", file: "chat-images.png", waitFor: '[data-testid="pending-chat-images"] img' },
  { story: "organisms-standalonechat-chatbesidegraph--manual-english-bread", file: "chat-beside-graph.png", graph: true },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
await ctx.addInitScript(() => localStorage.setItem("graphium_locale", "en"));
const page = await ctx.newPage();
for (const { story, file, waitFor, graph } of shots) {
  await page.goto(`${SB}?id=${story}&viewMode=story`);
  if (graph) {
    // グラフの配置は読み込むたびに変わる。触れたページが重ならずに収まる配置になるまで読み直す
    let framed = false;
    for (let attempt = 1; attempt <= 20 && !framed; attempt++) {
      if (attempt > 1) await page.goto(`${SB}?id=${story}&viewMode=story&attempt=${attempt}`);
      // 使ったページに印（act）が付く＝配置が終わった。火花の canvas が消えるまで待つ
      await page.waitForFunction(() => {
        const el = [...document.querySelectorAll("div")].find((d) => d._cyreg);
        return !!el && el._cyreg.cy.nodes("[act > 0]").length > 0;
      }, null, { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('canvas[aria-hidden="true"]'), null, { timeout: 15000 });
      await page.waitForTimeout(4500); // 配置の落ち着きを待つ（早く寄せると配置のあとで全体に戻る）
      // 触れたページ（使った・読んだ）が収まるまで寄せる。題名は寄せたときだけ出る（引いた全体では
      // 小さすぎて描かれない）。利用者が拡大するのと同じ操作。重なる・離れすぎる配置は採らない
      framed = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find((d) => d._cyreg);
        if (!el) return false;
        const cy = el._cyreg.cy;
        const touched = cy.nodes("[act > 0], .ai-read");
        const bb = touched.boundingBox({ includeLabels: false });
        const z = Math.min(0.9, 0.7 * Math.min(cy.width() / Math.max(bb.w, 1), cy.height() / Math.max(bb.h, 1)));
        if (z < 0.55) return `z=${z.toFixed(2)}`;
        const pts = touched.map((n) => n.position());
        let minD = Infinity;
        for (let i = 0; i < pts.length; i++)
          for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) * z);
        if (minD < 45) return `minD=${minD.toFixed(0)} z=${z.toFixed(2)}`;
        cy.zoom({ level: z, position: { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 } });
        cy.center(touched);
        window.__chatZoom = z;
        return true;
      });
      if (framed !== true) console.log("配置を読み直す", attempt, framed);
      framed = framed === true;
      if (framed) {
        await page.waitForTimeout(1500);
        // 寄せたあとに配置が動いて戻っていないか
        framed = await page.evaluate(() => {
          const el = [...document.querySelectorAll("div")].find((d) => d._cyreg);
          return !!el && Math.abs(el._cyreg.cy.zoom() - window.__chatZoom) < 0.01;
        });
      }
    }
    if (!framed) throw new Error("触れたページが読める配置にならなかった");
    await page.mouse.move(700, 600);
    await page.waitForTimeout(1500);
    const out = resolve(OUTPUT_DIR, file);
    await page.screenshot({ path: out });
    console.log(`saved ${out}`);
    continue;
  }
  // ストーリーの decorator が作る枠（幅 1100 の div）をそのまま切り抜く
  const frame = page.locator("#storybook-root > div").first();
  await frame.waitFor({ state: "visible" });
  if (waitFor) await page.locator(waitFor).first().waitFor({ state: "visible" });
  else await page.getByText("Chat list", { exact: true }).or(page.getByRole("navigation")).first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
  const out = resolve(OUTPUT_DIR, file);
  await frame.screenshot({ path: out });
  console.log(`saved ${out}`);
}
await browser.close();
