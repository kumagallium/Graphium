/**
 * README 用スクリーンショット撮影（docs/screenshots/）
 *
 * editor-with-graph_ja（日本語 UI）と editor-with-graph_en を撮る（--langs ja,en）。構図は manual-screenshots-provenance.mjs の
 * editor-with-graph_en と同じ（Bread dough trial #3 の Mix を選び、右に Steps パネル）。
 * ノートの中身は英語のまま（README.ja の文脈でも、UI 文言だけ日本語であればよい）。
 * history / network-graph は manual/public/screenshots/ の図を cp して揃える（撮影はマニュアル側）。
 *
 * 使い方（隔離データの API + vite を起動したうえで。見本データは bread）:
 *   node scripts/readme-screenshots.mjs --port <vite> --data <DATA_DIR> [--out docs/screenshots]
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, f) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : f);
const port = parseInt(opt("--port", "5975"), 10);
const dataDir = opt("--data", "");
const OUT = resolve(opt("--out", resolve(__dirname, "../docs/screenshots")));
if (!dataDir) { console.error("--data が要ります"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${port}/Graphium/app/`;

const NOW = "2026-10-29T09:00:00.000Z";
const P = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const t = (text) => ({ type: "text", text, styles: {} });
const para = (id, ...c) => ({ id, type: "paragraph", props: P, content: c, children: [] });
const cell = (s) => ({ type: "tableCell", content: [t(s)], props: { colspan: 1, rowspan: 1, ...P } });
const table = (id, rows) => ({ id, type: "table", props: { textColor: "default" },
  content: { type: "tableContent", columnWidths: rows[0].map(() => null), headerRows: 1, rows: rows.map((r) => ({ cells: r.map(cell) })) }, children: [] });
const step = (id, title, children) => ({ id, type: "step", props: { textAlignment: "left", variant: "step" }, content: [t(title)], children });
const informedBy = (src, tgt) => ({ id: `lnk_${src.slice(0, 8)}`, sourceBlockId: src, targetBlockId: tgt, type: "informed_by", layer: "prov", createdBy: "human" });

const TRIAL = "a1000000-0000-4000-8000-000000000001";
function seed() {
  const [mix, fer, bak] = [1, 2, 3].map((n) => `m1000000-0000-4000-8000-00000000000${n}`);
  const [tIn, tTool, tOven, tOut] = [1, 2, 3, 4].map((n) => `m1000000-0000-4000-8000-0000000000a${n}`);
  const title = "Bread dough trial #3";
  const blocks = [
    para("m1000000-0000-4000-8000-0000000000b0", t("Trying a slightly wetter dough than trial #2. Same flour, same oven.")),
    step(mix, "Mix", [
      para("m1000000-0000-4000-8000-0000000000b1", t("Combine the dry ingredients with the water in the stand mixer.")),
      table(tIn, [["Name", "Amount"], ["bread flour", "300 g"], ["water", "200 g"], ["dry yeast", "3 g"], ["salt", "5 g"]]),
      table(tTool, [["Name"], ["stand mixer"]]),
    ]),
    step(fer, "Ferment", [para("m1000000-0000-4000-8000-0000000000b2", t("Rest the dough 30 min at room temperature, covered."))]),
    step(bak, "Bake", [
      para("m1000000-0000-4000-8000-0000000000b3", t("Bake at 200 °C for 25 min.")),
      table(tOven, [["Name"], ["oven"]]),
      table(tOut, [["Name"], ["baked loaf"]]),
    ]),
  ];
  const labels = { [tIn]: "material", [tTool]: "tool", [tOven]: "tool", [tOut]: "output" };
  const doc = { version: 6, title, createdAt: NOW, modifiedAt: NOW, source: "human",
    pages: [{ id: "main", title, blocks, labels, provLinks: [informedBy(fer, mix), informedBy(bak, fer)], knowledgeLinks: [] }] };
  writeFileSync(join(dataDir, "notes", `${TRIAL}.json`), JSON.stringify(doc));
}

async function editorWithGraph(browser, lang) {
  const ja = lang === "ja";
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: ja ? "ja-JP" : "en-US", serviceWorkers: "block" });
  await ctx.addInitScript((loc) => {
    localStorage.setItem("graphium_locale", loc);
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
    localStorage.setItem("graphium:graphSelectionLearned", "1");
  }, lang);
  const page = await ctx.newPage();
  await page.goto(`${BASE}#note/${TRIAL}`, { waitUntil: "domcontentloaded" });
  const welcome = page.getByRole("button", { name: /^(Open Graphium|Graphium を開始)/ });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) { await welcome.first().click(); await page.waitForTimeout(1200); }
  await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  // 起動直後は一覧の読み込みが追いつかず「新しいノート」に落ちることがある。見本のノートが出るまで開き直す
  for (let i = 0; i < 4 && !(await page.getByText("Bread dough trial #3").first().isVisible().catch(() => false)); i++) {
    await page.waitForTimeout(3000);
    if (await page.getByText("Bread dough trial #3").first().isVisible().catch(() => false)) break;
    await page.goto(`${BASE}#note/${TRIAL}`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".bn-editor").first().waitFor({ state: "visible", timeout: 20000 });
  }
  await page.waitForTimeout(3000);
  await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: ja ? /整列/ : /Tidy up/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  // manual-screenshots-provenance.mjs の editor-with-graph_en と同じ構図: Mix を選び、Steps パネルを 120px 広げて Tidy up → Fit View
  const node = page.locator(".react-flow__node").filter({ hasText: "Mix" }).first();
  const hint = page.getByText(ja ? /ノードを選ぶと/ : /Select a node/);
  for (let i = 0; i < 4 && (await hint.isVisible().catch(() => false)); i++) {
    await node.click();
    await page.waitForTimeout(1500);
  }
  {
    const handles = page.locator('[role="separator"][data-resize-handle][aria-orientation="vertical"]');
    let target = null;
    for (let i = 0; i < (await handles.count()); i++) {
      const b = await handles.nth(i).boundingBox();
      if (b && b.x > 700 && (!target || b.x < target.x)) target = b;
    }
    if (target) {
      await page.mouse.move(target.x + 3, 400);
      await page.mouse.down();
      await page.mouse.move(target.x - 120, 400, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }
  await page.getByRole("button", { name: ja ? /整列/ : /Tidy up/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.locator(".react-flow__controls-fitview").first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.mouse.move(700, 10);
  await page.addStyleTag({ content: ".bn-side-menu { visibility: hidden !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `editor-with-graph_${lang}.png`) });
  await ctx.close();
}

seed();
const browser = await chromium.launch({ headless: true });
for (const l of opt("--langs", "ja,en").split(",")) await editorWithGraph(browser, l);
await browser.close();
console.log("done");
