/**
 * マニュアル用スクリーンショット撮影（共有ライブラリ / 共有ノートの全画面）
 *
 * 共有ライブラリはデスクトップ（Tauri）専用のビューで、本物のアプリでは
 * 共有フォルダを用意しないと撮れない。そこで Storybook の英語・パン作り世界観の
 * ストーリー（Manual (English, bread world) …）を Playwright で開いて撮る。
 *
 * 使い方:
 *   pnpm exec storybook dev -p 6013 --ci --no-open   # 別ターミナルで起動
 *   node scripts/manual-screenshots-shared.mjs --port 6013
 *
 * オプション:
 *   --port <port>   Storybook のポート（既定 6006）
 *   --only <name>   出力名（拡張子なし）を指定して 1 枚だけ撮り直す
 *
 * 追加分（storage-and-sync.md の引用カード・提案まわり）:
 *   shared-citation-cards / share-propose-dialog / shared-library-proposals /
 *   shared-proposal-diff / note-proposals-adopt
 *   （settings-shared-folders は下のブロック。偽装 Tauri で Storage タブを開く）
 *   clip: "root" = #storybook-root の最初の子の箱だけ / rect = 固定の矩形 / fill = 入力欄に文字を入れる
 *
 * 出力先: manual/public/screenshots/
 *
 * 罠:
 * - iframe.html は autodocs の args table（.sb-argstableBlock）を同じ DOM に
 *   持つことがあるので、表の位置は #storybook-root の中から探す
 * - ストーリーは localStorage（「最後に見た」控え・投影キャッシュ）を書くので、
 *   1 枚ごとに新しいブラウザコンテキストを作って持ち越さない
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

const SB = `http://localhost:${port}/iframe.html`;

/**
 * clip の種類:
 *   "table" — パンくずの上端から表の下端 + 余白まで（既存の shared-library.png と同じ切り方）
 *   "view"  — ビュー全体（ビューポートそのまま）。全画面表示・ギャラリー系はこちら
 *
 * settleMs — 描画後に待つ時間（既定 2500ms）。ストーリーの play が非同期の
 *   読み込みを待つ場合など、既定では終わり切らないものだけ延ばす
 */
const SHOTS = [
  {
    id: "sharing-sharedlibraryview--manual-english",
    name: "shared-library",
    clip: "table",
  },
  {
    // Folder 列の見出しのフィルターを開いた状態（ポップオーバーが表の中に収まる）
    id: "sharing-sharedlibraryview--manual-english",
    name: "shared-library-folder-filter",
    clip: "table",
    openFilter: "Folder",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-labels",
    name: "shared-library-labels",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-process",
    name: "shared-library-process",
    clip: "view",
    // 手順フローの自動レイアウト（ELK）は Storybook では初回の実測待ちを取りこぼして
    // ノードが (0,0) に重なったままになる。実アプリと同じ並びを撮るために整列を 1 回押す
    click: "Tidy up",
    settleMs: 6000,
  },
  {
    id: "sharing-sharedlibraryview--manual-english-templates",
    name: "shared-library-templates",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-update-marks",
    name: "shared-library-update-marks",
    clip: "table",
  },
  {
    id: "sharing-sharedlibraryview--manual-english-detail-comments",
    name: "shared-library-detail-comments",
    clip: "view",
    // コメントはパネル下部に固定されるので、既定の高さだとプレビューが 1 行しか
    // 見えない。本文とコメントの両方が入る高さで撮る
    viewport: { width: 1280, height: 1160 },
  },
  {
    id: "sharing-sharednoteview--manual-english",
    name: "shared-note-full-view",
    clip: "view",
    // 本文もコメントのレールも短いので、既定の高さだと下半分が余白になる
    viewport: { width: 1280, height: 620 },
  },
  {
    id: "sharing-sharednoteview--manual-english-ask-ai",
    name: "shared-note-ask-ai",
    clip: "view",
    // 全画面のコメント版と同じ切り方に揃える（並べたときに高さが揃う）
    viewport: { width: 1280, height: 620 },
    // 会話を出すのはストーリーの play（履歴 → その会話を選ぶ）。
    // 既定の 2500ms では読み込み待ちを含む play が終わり切らないことがある
    settleMs: 4000,
  },
  {
    id: "sharing-sharedcitationcard--manual-english-statuses",
    name: "shared-citation-cards",
    clip: "root",
    viewport: { width: 720, height: 600 },
  },
  {
    id: "sharing-proposechangesdialog--manual-english",
    name: "share-propose-dialog",
    clip: "rect",
    rect: { x: 376, y: 187, width: 528, height: 426 },
    fill: { placeholder: "One line on what you changed", text: "Lower the hydration to 72% and add a rest step" },
  },
  {
    id: "sharing-sharedlibraryview--manual-english-proposals",
    name: "shared-library-proposals",
    clip: "table",
  },
  {
    // 既存ストーリー。右レールの Changes タブ（Proposer / Author の色分け）
    id: "sharing-sharednoteview--proposal-diff-manual",
    name: "shared-proposal-diff",
    clip: "view",
    viewport: { width: 1280, height: 660 },
  },
  {
    id: "sharing-noteproposalspanel--manual-english",
    name: "note-proposals-adopt",
    clip: "view",
    viewport: { width: 420, height: 640 },
  },
];

const VIEWPORT = { width: 1280, height: 800 };
/** 表の下端に付ける余白（CSS px） */
const CLIP_PADDING = 16;

const browser = await chromium.launch({ headless: true });

/** 表の下端までの clip を測る。表が見つからなければ null（ビュー全体にフォールバック） */
async function measureTableClip(page) {
  return await page.evaluate((padding) => {
    const root = document.querySelector("#storybook-root") ?? document.body;
    const table = root.querySelector("table");
    if (!table) return null;
    const rect = table.getBoundingClientRect();
    const bottom = Math.min(
      Math.ceil(rect.bottom + padding),
      document.documentElement.clientHeight,
    );
    return {
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: Math.max(bottom, 1),
    };
  }, CLIP_PADDING);
}

const targets = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
const SETTINGS_SHARED = "settings-shared-folders";
if (targets.length === 0 && only !== SETTINGS_SHARED) {
  console.error(`--only ${only} に一致するスクショがありません`);
  process.exit(1);
}

console.log(`Storybook: ${SB}`);
for (const shot of targets) {
  // ストーリーが書く localStorage を次のストーリーへ持ち越さないよう、毎回作り直す
  const viewport = shot.viewport ?? VIEWPORT;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`${SB}?id=${shot.id}&viewMode=story`, {
    waitUntil: "load",
    timeout: 30000,
  });
  // ストーリーが描かれるまで待つ（loadEntries は Promise なので描画は 1 tick 遅れる）
  await page.waitForSelector("#storybook-root *", { timeout: 15000 });
  await page.waitForTimeout(shot.settleMs ?? 2500);

  if (shot.click) {
    await page.getByRole("button", { name: shot.click }).first().click();
    await page.waitForTimeout(1500);
  }

  if (shot.openFilter) {
    // 見出しセルの中のフィルターボタン（Folder 列）
    const th = page.locator("#storybook-root th", { hasText: shot.openFilter }).first();
    await th.locator("button").first().click();
    await page.waitForTimeout(800);
  }

  if (shot.fill) {
    await page.getByPlaceholder(shot.fill.placeholder).fill(shot.fill.text);
    await page.waitForTimeout(500);
  }

  if (shot.clip === "root") {
    const path = `${OUTPUT_DIR}/${shot.name}.png`;
    await page.locator("#storybook-root > div").first().screenshot({ path });
    console.log(`  OK ${shot.name}.png (root)`);
    await page.close();
    await ctx.close();
    continue;
  }

  const clip =
    shot.clip === "table" ? await measureTableClip(page) : shot.clip === "rect" ? shot.rect : null;
  const path = `${OUTPUT_DIR}/${shot.name}.png`;
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  const size = clip ? `${clip.width}x${clip.height}` : `${viewport.width}x${viewport.height}`;
  console.log(`  OK ${shot.name}.png (${size} @2x)${clip ? "" : " — view"}`);

  await page.close();
  await ctx.close();
}

/**
 * settings-shared-folders: 設定 → Storage の「Share with other people」。
 * 偽装 Tauri（StorageDesktop ストーリー）で開き、localStorage に名前と共有フォルダを seed する。
 * - 共有フォルダ・Blob フォルダ・名前は localStorage（graphium-shared-root / graphium-shared-blob-root / graphium-author-identity）
 * - 接続テストは本物だと共有フォルダへ書いて読む往復をするので、test-connection.ts のモジュールを取得時に
 *   「成功を返す」版へ差し替える（実在のフォルダは触らない）
 * - 到達確認（shared_root_diagnose）の invoke も偽装して「届いている」と答える
 */
if (!only || only === SETTINGS_SHARED) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 975 }, deviceScaleFactor: 2, locale: "en-US" });
  await ctx.addInitScript(() => {
    localStorage.setItem("graphium_locale", "en");
    localStorage.setItem("graphium-author-identity", JSON.stringify({ name: "Ken Sato", email: "ken@example.org" }));
    localStorage.setItem("graphium-shared-root", "/Volumes/Bakery/Shared");
    localStorage.setItem("graphium-shared-blob-root", "/Volumes/Bakery/Shared-blobs");
  });
  const page = await ctx.newPage();
  await page.route("**/settings/modal.stories.tsx*", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      'if (cmd === "get_graphium_root")',
      'if (cmd === "shared_root_diagnose") return { reachable: true, alternatives: [] }; if (cmd === "shared_root_remote") return null; if (cmd === "get_graphium_root")',
    );
    await route.fulfill({ response: res, body });
  });
  await page.route("**/lib/storage/shared/test-connection.ts*", async (route) => {
    const res = await route.fetch();
    const body = (await res.text())
      .replace("export async function testSharedConnection(", "export async function __origTestSharedConnection(")
      .replace("export async function testBlobConnection(", "export async function __origTestBlobConnection(")
      + "\nexport async function testSharedConnection() { return { ok: true, id: \"demo\", hash: \"demo\" }; }\nexport async function testBlobConnection() { return { ok: true, hash: \"demo\" }; }\n";
    await route.fulfill({ response: res, body });
  });
  await page.goto(`${SB}?id=organisms-settingsmodal--storage-desktop&viewMode=story`);
  const portal = page.locator('[data-modal-portal="true"]').first();
  await portal.getByText("Where your notes are saved").waitFor({ state: "visible", timeout: 30000 });
  await page.getByText("Share with other people").first().click();
  await page.waitForTimeout(600);
  // モーダルの高さを広げ、名前と共有フォルダが 1 枚に入るようにする（撮る間だけ）
  await page.addStyleTag({ content: "[data-modal-portal] .relative.rounded-xl{height:calc(100dvh - 2rem)!important;max-height:none!important}" });
  await page.getByText("Share with your team").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Test connection" }).first().click();
  await page.getByText(/Round-trip OK/).first().waitFor({ state: "visible", timeout: 10000 });
  // 先頭の「保存先」（偽装の仮パスが出る）を外し、Share with other people を上端に寄せる
  await page.getByText("Share with other people").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(800);
  const path = `${OUTPUT_DIR}/${SETTINGS_SHARED}.png`;
  await page.screenshot({ path });
  console.log(`  OK ${SETTINGS_SHARED}.png`);
  await ctx.close();
}

await browser.close();
console.log(`\nDone! ${targets.length} 枚を manual/public/screenshots/ に保存しました`);
