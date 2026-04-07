/**
 * スクリーンショット自動撮影スクリプト
 *
 * 使い方:
 *   # アプリのスクリーンショット（サンドボックスモード）
 *   pnpm dev --port 5174 &
 *   node scripts/take-screenshots.mjs --app --base-url http://localhost:5174/Graphium/
 *
 *   # Storybook のスクリーンショット
 *   pnpm storybook &
 *   node scripts/take-screenshots.mjs --storybook
 *
 * 出力先: docs/screenshots/
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../docs/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const isStorybook = args.includes("--storybook");
const baseUrlArg = args.find((a) => a.startsWith("--base-url="));
const BASE_URL = baseUrlArg
  ? baseUrlArg.split("=")[1]
  : "http://localhost:5174/Graphium/";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

async function capture(url, name, waitMs = 2000) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: `${OUTPUT_DIR}/${name}.png` });
    console.log(`  OK ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
  } finally {
    await page.close();
  }
}

if (isStorybook) {
  const SB = "http://localhost:6006/iframe.html";
  console.log("Storybook screenshots:");
  const stories = [
    ["organisms-editor--with-initial-content", "editor-content"],
    ["organisms-multipage--multiple-pages", "multipage"],
    ["organisms-networkgraph--multi-hop", "graph"],
    ["organisms-labelbadge--all-labels", "context-labels"],
    ["organisms-provgenerator--with-samples", "prov-generator"],
    ["navigation-notelistview--default", "note-list"],
    ["organisms-aiassistantmodal--default", "ai-assistant"],
    ["organisms-labelgalleryview--default", "label-gallery"],
    ["organisms-linkbadge--note-demo", "block-link"],
  ];
  for (const [id, name] of stories) {
    await capture(`${SB}?id=${id}&viewMode=story`, name, 3000);
  }
} else {
  console.log(`App screenshots (base: ${BASE_URL}):`);
  await capture(BASE_URL, "login", 2000);
  await capture(`${BASE_URL}?sandbox`, "sandbox", 3000);
}

await browser.close();
console.log(`\nDone! Screenshots saved to docs/screenshots/`);
