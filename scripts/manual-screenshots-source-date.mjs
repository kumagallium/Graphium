/**
 * マニュアル用スクリーンショット撮影（資料の日付）
 *
 * 英語 UI・パン作りの世界のノートを隔離した DATA_DIR に置き、動いている dev（vite + API）で撮る。
 *   - ノートの題の下のチップと、押したときの入力欄 → manual/public/screenshots/source-date-chip.png
 *   - ノート一覧の「Source date」列と、その順の並び → manual/public/screenshots/notes-list-source-date.png
 *
 * 使い方（本物の vault には触れない。DATA_DIR は使い捨ての場所にする）:
 *   node scripts/manual-screenshots-source-date.mjs --seed <DATA_DIR>      # ノートを置く（索引は消す）
 *   PORT=<api> DATA_DIR=<DATA_DIR> pnpm exec tsx watch --env-file .env src/server/index.ts
 *   PORT=<api> pnpm exec vite --port <web> --strictPort
 *   node scripts/manual-screenshots-source-date.mjs --port <web>
 */
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT_DIR = path.resolve(import.meta.dirname, "../manual/public/screenshots");

// ── ノートを置く ──────────────────────────────────────────────
const seedDir = opt("--seed");
if (seedDir) {
  const note = (id, title, createdAt, text, extra = {}) => ({
    id,
    doc: {
      version: 6,
      title,
      pages: [
        {
          id: "main",
          title,
          blocks: [{ id: `${id}-b1`, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] }],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
      source: "human",
      kind: "note",
      createdAt,
      modifiedAt: createdAt,
      ...extra,
    },
  });
  const notes = [
    note("n-paper-2012", "Hydration level and crumb structure in sourdough", "2026-11-22T01:00:00.000Z",
      "Source: Journal of Baking Science, March 2012.", { noteContexts: ["Sources/Papers"], sourceDate: "2012-03" }),
    note("n-talk-2019", "Shaping tension and oven spring", "2026-11-22T01:10:00.000Z",
      "Source: a talk at a baking workshop, 2019.", { noteContexts: ["Sources/Talks"], sourceDate: "2019" }),
    note("n-blog-2026", "Why I switched to a longer autolyse", "2026-11-22T01:05:00.000Z",
      "Source: a blog post from 1 November 2026.", { noteContexts: ["Sources/Blog"], sourceDate: "2026-11-01" }),
    note("n-own-1", "Sandwich loaf trial 3", "2026-11-10T09:00:00.000Z", "Baked at 210 °C for 35 minutes."),
    note("n-own-2", "Sandwich loaf trial 4", "2026-11-18T09:00:00.000Z", "Baked at 200 °C for 38 minutes."),
  ];
  mkdirSync(path.join(seedDir, "notes"), { recursive: true });
  mkdirSync(path.join(seedDir, "appdata"), { recursive: true });
  for (const n of notes) writeFileSync(path.join(seedDir, "notes", `${n.id}.json`), JSON.stringify(n.doc, null, 2));
  // 索引はアプリが初回に作る
  rmSync(path.join(seedDir, "appdata", "note-index.json"), { force: true });
  console.log(`seeded: ${seedDir}`);
  process.exit(0);
}

// ── 撮る ──────────────────────────────────────────────────────
const port = Number(opt("--port")) || 5174;
const base = `http://localhost:${port}/Graphium/app/`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("graphium_locale", "en");
  } catch {
    /* 使えないときは英語の既定のまま */
  }
});
const page = await context.newPage();

async function open(hash) {
  await page.goto(`${base}${hash}`, { waitUntil: "load" });
  // 初回のようこそ画面（サーバー保存の案内）を閉じる
  const welcome = page.locator("button", { hasText: /Graphium/ }).filter({ hasText: /Start|Open/ });
  try {
    await welcome.first().waitFor({ state: "visible", timeout: 8000 });
    await welcome.first().click();
  } catch {
    /* 出なければそのまま */
  }
}

// 1) ノート一覧（資料の日付の順）
await open("#notes");
const sourceHeader = page.locator("th", { hasText: "Source date" });
await sourceHeader.waitFor({ state: "visible", timeout: 60000 });
await sourceHeader.click(); // 新しい順（↓）
await page.waitForTimeout(400);
const table = page.locator("table").first();
const tb = await table.boundingBox();
if (!tb) throw new Error("一覧の表が見つかりません");
const listOut = path.join(OUT_DIR, "notes-list-source-date.png");
await page.screenshot({
  path: listOut,
  clip: { x: Math.floor(tb.x) - 8, y: Math.floor(tb.y) - 48, width: Math.ceil(tb.width) + 16, height: Math.ceil(tb.height) + 64 },
});
console.log(`saved: ${listOut}`);

// 2) ノートの題の下のチップと入力欄
await open("#note/n-paper-2012");
const chip = page.locator("button", { hasText: "Source date" }).first();
await chip.waitFor({ state: "visible", timeout: 60000 });
await chip.click();
const editor = page.locator('[data-testid="source-date-editor"]');
await editor.waitFor({ state: "visible" });
await page.waitForTimeout(300);
const title = page.locator("textarea").first();
const t = await title.boundingBox();
const e = await editor.boundingBox();
if (!t || !e) throw new Error("題か入力欄が見つかりません");
const chipOut = path.join(OUT_DIR, "source-date-chip.png");
const x = Math.floor(t.x) + 24;
const y = Math.floor(t.y) - 8;
await page.screenshot({
  path: chipOut,
  clip: { x, y, width: Math.min(760, Math.ceil(e.x + e.width - x) + 120), height: Math.ceil(e.y + e.height - y) + 16 },
});
console.log(`saved: ${chipOut}`);

await browser.close();
