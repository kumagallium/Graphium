/**
 * マニュアル用スクリーンショット撮影（設定モーダルのタブ）
 *
 * 設定画面は実アプリでしか撮れない（Storybook だとモーダルの背後が
 * 灰色一色になり、他のスクショと様式が揃わない）。開発サーバーを
 * 隔離データで起動しておき、このスクリプトが英語 UI で開いて撮る。
 *
 * 使い方:
 *   PORT=<api> node_modules/.bin/vite --port 5189 --strictPort   # 別ターミナル
 *   node scripts/manual-screenshots-settings.mjs --port 5189
 *
 * オプション:
 *   --port <port>   開発サーバーのポート（既定 5189）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *   --seed-kb <dataDir>  撮影の前に <dataDir>/appdata/grounding-kb-cache.json へ
 *                   パン作りの判定 4 件（Grounding data タブの一覧用）を書いて終了する。
 *                   API サーバー（その DATA_DIR）を止めた状態で実行し、あとで起動し直してから撮る
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - ウェルカムモーダル（Open Graphium）を先に閉じないと、オーバーレイが
 *   すべてのクリックを横取りして設定ボタンにも届かない
 * - Service Worker を block しないと PWA の自動リロードが click と競合する
 * - タブのボタンはモーダルの外にも同名の要素がありうるので
 *   [data-modal-portal="true"] にスコープする
 * - AI タブはモデルが 1 つも無いと機能セクションを出さない（それが仕様）。
 *   マニュアルは登録済みの状態を説明しているので localStorage に 1 件 seed する
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../manual/public/screenshots");
mkdirSync(OUTPUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 5189;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

/** Grounding data タブ用: モデル判定が沈殿した KB（KbFile 形式。src/features/world-grounding/distilled-kb-retriever.ts） */
const SEED_KB = {
  version: 1,
  checkedBy: "model-cache@v1",
  seedSource: "model-cache@v1",
  entries: [
    {
      id: "kb-bread-gluten-hydration",
      verdict: "established",
      claim: "Higher dough hydration gives a more open crumb, because water lets gluten strands stretch and trap larger gas bubbles.",
      rationale: "Baking science texts agree that wetter doughs develop more extensible gluten and larger alveoli, within limits set by flour strength.",
      keywords: ["hydration", "crumb", "gluten", "dough"],
      sources: [{ kind: "distilled", ref: "Gluten", url: "https://en.wikipedia.org/wiki/Gluten" }],
      version: 1,
      generatedByModel: "gpt-oss-120b",
      grounded: true,
    },
    {
      id: "kb-bread-oven-spring-steam",
      verdict: "supported",
      claim: "Steam in the first minutes of baking improves oven spring by keeping the crust soft and stretchable.",
      rationale: "Commonly reported by bakers and consistent with crust-formation studies, though the size of the effect varies by oven and recipe.",
      keywords: ["steam", "oven spring", "crust", "baking"],
      sources: [{ kind: "distilled", ref: "Baking", url: "https://en.wikipedia.org/wiki/Baking" }],
      version: 1,
      generatedByModel: "gpt-oss-120b",
      grounded: true,
    },
    {
      id: "kb-bread-cold-proof-flavor",
      verdict: "weak",
      claim: "Overnight cold proofing always makes sourdough taste more sour.",
      rationale: "Longer cold fermentation shifts acid balance, but the direction depends on starter, temperature and hydration, so the claim is too broad.",
      keywords: ["cold proof", "sourdough", "flavor", "fermentation"],
      sources: [{ kind: "distilled", ref: "Sourdough", url: "https://en.wikipedia.org/wiki/Sourdough" }],
      version: 1,
      generatedByModel: "gpt-oss-120b",
      grounded: true,
    },
    {
      id: "kb-bread-searing-seals-moisture",
      verdict: "contested",
      claim: "A hot, fast bake seals moisture inside the loaf.",
      rationale: "Crust does slow drying, but loaves lose water as steam either way; sources disagree on how much the bake speed matters.",
      keywords: ["crust", "moisture", "bake", "temperature"],
      sources: [{ kind: "distilled", ref: "Bread", url: "https://en.wikipedia.org/wiki/Bread" }],
      version: 1,
      generatedByModel: "gpt-oss-120b",
      grounded: true,
    },
  ],
};
const seedIdx = args.indexOf("--seed-kb");
if (seedIdx !== -1) {
  const dir = resolve(args[seedIdx + 1], "appdata");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, "grounding-kb-cache.json");
  writeFileSync(file, JSON.stringify(SEED_KB, null, 2));
  console.log(`  ✓ seeded ${SEED_KB.entries.length} KB entries → ${file}`);
  process.exit(0);
}

const BASE_URL = `http://127.0.0.1:${port}/Graphium/app/`;
/** 背景に出すノート（隔離データのノート id）。--note <id> で指定。無ければ空のノート */
const noteIdx = args.indexOf("--note");
const noteId = noteIdx !== -1 ? args[noteIdx + 1] : null;
const hashUrl = () => BASE_URL + (noteId ? `#note/${noteId}` : "");
const VIEWPORT = { width: 1280, height: 800 };

/** AI タブ用の表示専用モデル。API キーはダミーで、推論は一切走らせない */
const SAMPLE_MODELS = [
  { id: "m1", name: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet", apiKey: "dummy", apiBase: null },
];

/** 2 件登録した状態（登録モデルの行と割り当ての選択肢を見せる図用） */
const TWO_MODELS = [
  ...SAMPLE_MODELS,
  { id: "m2", name: "gpt-oss-120b", provider: "openai-compatible", modelId: "gpt-oss-120b", apiKey: "dummy", apiBase: "https://api.example.com/v1" },
];

const SHOTS = [
  // Display は既定の表示だと Reading colors の選択欄が下端で切れる。モーダルの高さは
  // viewport を伸ばしても増えないので、中身を最下部までスクロールして入れる
  // モーダルの高さは 48rem で頭打ちなので、タブ全体は 1 画面に入らない。最下部までスクロールして
  // 拡大縮小のショートカット〜読みやすさ（色）〜来歴ラベル名を写す（Language は画面外。alt はそれに合わせてある）
  { tab: "Display & Language", name: "settings-display-tab", scrollModal: "end" },
  { tab: "Storage", name: "settings-storage" },
  // AI は既定の高さだと一番下の「Advanced」が切れる
  { tab: "AI", name: "settings-ai-tab", viewport: { width: 1280, height: 900 } },
  // 登録モデル（開いた状態）と Model assignment
  {
    tab: "AI",
    name: "settings-ai-models",
    models: TWO_MODELS,
    prepare: async (page) => {
      await page.getByText("Registered Models", { exact: true }).first().click();
      await page.waitForTimeout(600);
    },
  },
  // Grounding data タブ（世界照合が ON のときだけ出る）
  { tab: "Grounding data", name: "grounding-data-tab", viewport: { width: 1280, height: 800 } },
  // Add model → 「Connect with an address」→ Provider で Copilot（サブスク）を選んだ画面
  {
    tab: "AI",
    name: "settings-copilot-provider",
    prepare: async (page) => {
      await page.getByText("Add model", { exact: true }).first().click();
      await page.waitForTimeout(800);
      await page.getByText("Connect with an address", { exact: false }).first().click();
      await page.waitForTimeout(800);
      const sel = page.locator('[data-modal-portal="true"] select').first();
      const opt = await sel.locator("option").evaluateAll((os) => os.find((o) => /Copilot/.test(o.textContent))?.value);
      await sel.selectOption(opt);
      await page.waitForTimeout(800);
    },
    // 既定の表示だと Select a model の default が下端で切れる。見出し「Add Model」を上端に置く
    scrollModalTo: "Add Model",
  },
  // AI タブの一番下にある「Experimental features」を開いた状態（スイッチ一覧）。
  // 折りたたみは既定で畳んであるので、見出しを押して開き、最下部までスクロールする
  {
    tab: "AI",
    name: "settings-experimental",
    viewport: { width: 1280, height: 1500 },
    prepare: async (page) => {
      await page.getByText("Experimental features", { exact: true }).first().click();
      await page.waitForTimeout(800);
      // モーダルの高さは 48rem で頭打ちでスイッチの並びが途中で切れるので、この図だけ縦に伸ばす
      // （中身は同じ。画面の高さ - 2rem まで）
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('[data-modal-portal="true"] *')).find((e) =>
          /48rem/.test(e.className?.toString?.() ?? ""),
        );
        if (el) el.style.height = "calc(100dvh - 2rem)";
      });
      await page.waitForTimeout(500);
    },
    // 見出し「Experimental features」を上端に置く（スイッチの並びを上から見せる）
    scrollModalTo: "Experimental features",
    // 背景（サイドバー・暗幕）を外し、モーダル本体だけを切る（本文の幅に縮めても文字が読める大きさにする）
    clip: async (page) =>
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('[data-modal-portal="true"] *')).find((e) =>
          /48rem/.test(e.className?.toString?.() ?? ""),
        );
        const r = el.getBoundingClientRect();
        return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
      }),
  },
  // 洞察のテスト。実行はせず「テストの中身」を開いた状態
  {
    tab: "AI",
    name: "settings-insight-test",
    viewport: { width: 1280, height: 1400 },
    prepare: async (page) => {
      // 洞察は「Experimental features」グループの中（既定で畳まれている）
      await page.getByText("Experimental features", { exact: true }).first().click();
      await page.waitForTimeout(600);
      await page.getByText("Show what the test contains", { exact: false }).first().click();
      await page.waitForTimeout(600);
    },
    clip: async (page) =>
      page.evaluate(() => {
        // Insight model の見出しから、開いたテスト説明の末尾までを切る
        const label = Array.from(document.querySelectorAll("*")).find(
          (e) => e.children.length === 0 && (e.textContent || "").trim() === "Insight model",
        );
        const det = Array.from(document.querySelectorAll("details")).find((d) => d.open && /test contains/.test(d.textContent));
        label.scrollIntoView({ block: "start" });
        // 固定ヘッダー（タブの下線）に貼り付くので、内側に余白を作る
        let sc = label.parentElement;
        while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
        if (sc) sc.scrollTop -= 40;
        const l = label.getBoundingClientRect();
        const d = det.getBoundingClientRect();
        return { x: Math.max(0, l.left - 24), y: Math.max(0, l.top - 14), width: 728, height: d.bottom - l.top + 14 };
      }),
  },
];

const targets = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
if (targets.length === 0) {
  console.error(`--only ${only} に一致するスクショがありません`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-US",
  serviceWorkers: "block",
});

// 言語とモデルは初回描画より先に置く（設定モーダルは開いた瞬間に読む）
await ctx.addInitScript(
  ([models]) => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-llm-models", JSON.stringify(models));
    // 画面の大きさで出るズームの案内（右下）を写り込ませない
    localStorage.setItem("graphium-zoom-hint-dismissed", "1");
    // 世界照合・洞察を ON にした状態（Grounding data タブと Insight discovery が出る）
    if (!localStorage.getItem("graphium-settings")) {
      localStorage.setItem(
        "graphium-settings",
        JSON.stringify({ features: { claims: true, insights: true, worldGrounding: true } }),
      );
    }
    // 折りたたみは既定（畳んだ状態）で撮る。前回の撮影が残した開閉を持ち越さない
    Object.keys(localStorage)
      .filter((k) => k.startsWith("graphium-settings-group:"))
      .forEach((k) => localStorage.removeItem(k));
  },
  [SAMPLE_MODELS],
);

/**
 * ボタンをテキストで探して押す。
 *
 * getByRole("button", { name }) は使わない — サイドバーの設定ボタンは
 * アクセシビリティツリー側で拾えず（lucide のアイコンとステータス点を含む
 * 組み方のため）空振りする。DOM の click() でも React の合成イベントは発火する。
 */
async function clickByText(page, text, scopeSelector = null) {
  const ok = await page.evaluate(
    ([t, s]) => {
      const root = s ? document.querySelector(s) : document;
      if (!root) return false;
      const btn = Array.from(root.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === t,
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    [text, scopeSelector],
  );
  if (!ok) throw new Error(`ボタンが見つかりません: ${text}`);
}

/** 設定モーダルを開く（毎回ページを読み直す。リサイズでモーダルが閉じるため、サイズは開く前に決める） */
async function openSettings(viewport, models = null) {
  const page = await ctx.newPage();
  // 図ごとに登録モデルを差し替える（コンテキストの init より後に走って上書きする）
  if (models) {
    await page.addInitScript(
      (m) => localStorage.setItem("graphium-llm-models", JSON.stringify(m)),
      models,
    );
  }
  await page.setViewportSize(viewport);
  await page.goto(hashUrl(), { waitUntil: "domcontentloaded" });
  // ウェルカムモーダルのオーバーレイは全クリックを横取りするうえ、背後の
  // サイドバーごとアクセシビリティツリーから外すので、出るのを待って先に閉じる
  // （出る前に読みに行くと「設定ボタンが無い」ように見えて空振りする）
  const welcome = page.getByRole("button", { name: "Open Graphium", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (await welcome.count()) {
    await welcome.click();
    await page.waitForTimeout(1200);
  }
  // 描画が終わるまで待つ（ウェルカムが出ない 2 回目以降は読み込み前に押しに行って空振りする）
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "Settings"),
  );
  await clickByText(page, "Settings");
  await page.waitForTimeout(1500);
  return page;
}

console.log(`dev server: ${BASE_URL}`);
for (const shot of targets) {
  const page = await openSettings(shot.viewport ?? VIEWPORT, shot.models);
  await clickByText(page, shot.tab, '[data-modal-portal="true"]');
  await page.waitForTimeout(1200);
  if (shot.prepare) await shot.prepare(page);
  if (shot.scrollModal === "end") {
    // モーダル内のスクロール領域（中身が溢れている要素）を最下部へ
    await page.evaluate(() => {
      const root = document.querySelector('[data-modal-portal="true"]');
      for (const el of root.querySelectorAll("*")) {
        if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
      }
    });
    await page.waitForTimeout(500);
  }
  if (shot.scrollModalTo) {
    // 指定の文言を持つ要素が、モーダル内のスクロール領域の上端から 16px 下に来るようにする
    const moved = await page.evaluate((text) => {
      const root = document.querySelector('[data-modal-portal="true"]');
      const target = Array.from(root.querySelectorAll("*")).find(
        (e) => e.children.length === 0 && (e.textContent || "").trim() === text,
      );
      if (!target) return "not found";
      let box = target.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (!box) return "no scroll box";
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
      return "ok";
    }, shot.scrollModalTo);
    if (moved !== "ok") throw new Error(`scrollModalTo "${shot.scrollModalTo}": ${moved}`);
    await page.waitForTimeout(500);
  }
  const out = resolve(OUTPUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: out, ...(shot.clip ? { clip: await shot.clip(page) } : {}) });
  console.log(`  ✓ ${shot.name}.png  (${shot.tab})`);
  await page.close();
}

await ctx.close();
await browser.close();
console.log(`出力先: ${OUTPUT_DIR}`);
