#!/usr/bin/env node
/**
 * 保存経路の E2E スモークテスト（自己完結・決定論的）
 *
 * シナリオ:
 *   ノート A 作成 → 本文入力 → 明示保存（Ctrl+S）
 *   → ノート B 作成 → 本文入力 → 明示保存
 *   → ノート一覧から A を SidePeek で開閉
 *   → リロード → A / B の内容がディスク・画面ともに混線なく一致
 *
 * 守っている不変条件（過去のデータ破壊バグ）:
 *   - 保存で複製が生まれない（activeFileId set なら saveFile。PR #454）
 *   - SidePeek の開閉が別ノートの内容を壊さない / タイトルを巻き戻さない
 *     （PR #502: SidePeek のノート切替でデータ破壊、PR #514: stale docCache）
 *
 * 実行: pnpm test:e2e （または node e2e/save-smoke.mjs）
 *   - vite: ポート 5177 / server: ポート 3004（環境変数で変更可）
 *   - DATA_DIR は実行ごとに空にする（デフォルトは OS 一時ディレクトリ配下）
 *   - オートセーブ（3 秒デバウンス）待ちの flaky を避けるため保存は Ctrl+S 明示
 *   - confirm ダイアログは自動 accept
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_PORT = Number(process.env.E2E_VITE_PORT ?? 5177);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3004);
const DATA_DIR = process.env.E2E_DATA_DIR ?? join(tmpdir(), "graphium-save-smoke-data");
const NOTES_DIR = join(DATA_DIR, "notes");
const APP_URL = `http://127.0.0.1:${VITE_PORT}/Graphium/app/`;
const HEADLESS = process.env.E2E_HEADED !== "1";

const log = (msg) => console.log(`[e2e] ${msg}`);

// ── 子プロセス管理 ─────────────────────────────────────────────
const children = [];

function spawnChild(name, cmd, args, extraEnv) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    // プロセスグループごと kill できるよう detach する
    // （tsx / vite は子プロセスを持つため、単体 kill では port が残る）
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[${name}] ${d}`);
  });
  child.stderr.on("data", (d) => process.stderr.write(`[${name}:err] ${d}`));
  child.on("exit", (code, signal) => {
    if (!child.__expectedExit) {
      console.error(`[e2e] ${name} exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
  children.push({ name, child });
  return child;
}

function killChildren() {
  for (const { name, child } of children) {
    child.__expectedExit = true;
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM"); // グループごと kill
        log(`killed ${name} (pgid ${child.pid})`);
      } catch {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
      }
    }
  }
}

process.on("SIGINT", () => { killChildren(); process.exit(130); });
process.on("SIGTERM", () => { killChildren(); process.exit(143); });

// ── 待機ヘルパー ─────────────────────────────────────────────
async function waitForHttp(url, timeoutMs = 90_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* まだ起動していない */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** ディスク上のノート JSON を読む（server-fs は <DATA_DIR>/notes/<id>.json に保存する） */
function readNotesOnDisk() {
  if (!existsSync(NOTES_DIR)) return [];
  const notes = [];
  for (const f of readdirSync(NOTES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      notes.push({ file: f, doc: JSON.parse(readFileSync(join(NOTES_DIR, f), "utf-8")) });
    } catch {
      // 書き込み途中の可能性 → 呼び出し側の poll で再試行される
      notes.push({ file: f, doc: null });
    }
  }
  return notes;
}

/** ノート数が expected 件になり、全件 JSON として読めるまで poll */
async function waitForNotesOnDisk(expected, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const notes = readNotesOnDisk();
    if (notes.length === expected && notes.every((n) => n.doc !== null)) return notes;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timeout: expected ${expected} notes on disk, found ${notes.length} (${notes.map((n) => n.file).join(", ")})`
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// ── シナリオ本体 ─────────────────────────────────────────────
async function createNoteViaUi(page, title, body) {
  // 「+ Note」で必ず空エディタから始める（初期表示のビューに依存しない）
  await page.getByRole("button", { name: "+ Note" }).click();
  const titleBox = page.getByPlaceholder("Note title");
  await titleBox.waitFor({ timeout: 15_000 });
  // エディタのリセットを確認してから入力（新規ノートのタイトルは既定で "New note"。
  // 前ノートのタイトルが残ったまま入力すると、別ノートへの上書き事故を検出できない）
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[placeholder="Note title"]');
      return el && el.value === "New note";
    },
    { timeout: 15_000 }
  );
  await titleBox.fill(title);
  const editor = page.locator(".bn-editor").first();
  await editor.click();
  await page.keyboard.type(body);
  // オートセーブ（3 秒）を待たず明示保存（flaky 回避）。
  // useAutoSave の Ctrl/Cmd+S ハンドラは window キャプチャ登録なのでフォーカス位置に依らない。
  await page.keyboard.press("Control+s");
}

async function openNoteListFromSidebar(page) {
  // サイドバーの「All Notes」ナビ（テキスト + 件数バッジ）。「+ Note」とは一致しない。
  await page.getByRole("button", { name: /^All Notes\b/ }).first().click();
  await page.locator("table tbody tr").first().waitFor({ timeout: 15_000 });
}

/** 一覧行のタイトルテキスト。行の中央クリックは「＋ Context」ボタン等に
 *  当たってしまうため、必ずタイトル文字列そのものをクリックする */
function noteListTitle(page, title) {
  return page
    .locator("table tbody tr", { hasText: title })
    .first()
    .getByText(title, { exact: true });
}

async function run() {
  // 1. DATA_DIR を毎回空にする（決定論性）
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  log(`DATA_DIR: ${DATA_DIR}`);

  // 2. server（Hono, ポート SERVER_PORT）と vite（ポート VITE_PORT）を起動
  //    - vite の /api プロキシは PORT 環境変数を参照するため両方に渡す
  //    - .env はあれば読む（node の --env-file は spawn env を上書きしない）
  const env = { PORT: String(SERVER_PORT), DATA_DIR };
  const tsxBin = join(ROOT, "node_modules", ".bin", "tsx");
  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  const serverArgs = existsSync(join(ROOT, ".env"))
    ? ["--env-file", ".env", "src/server/index.ts"]
    : ["src/server/index.ts"];
  spawnChild("server", tsxBin, serverArgs, env);
  // --host 127.0.0.1: vite の localhost バインドは IPv6 (::1) のみになる環境があり、
  // 127.0.0.1 への接続が refused になるため明示する
  spawnChild("vite", viteBin, ["--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], env);

  log("waiting for server & vite ...");
  await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/storage/capabilities`);
  await waitForHttp(APP_URL);
  log("servers are up");

  // 3. ブラウザシナリオ
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: "en-US", // UI ラベルを英語に固定（セレクタの決定論性）
    });
    const page = await context.newPage();
    // confirm / alert は自動 accept（保存失敗 alert 等で固まらないように）
    page.on("dialog", (d) => d.accept().catch(() => {}));

    await page.goto(APP_URL, { waitUntil: "load" });

    // ウェルカムダイアログ（初回のみ表示）を閉じる
    await page.getByRole("button", { name: "Open Graphium" }).click({ timeout: 30_000 });
    log("welcome dismissed");

    // ── ノート A / B を作成して明示保存 ──
    await createNoteViaUi(page, "Note A", "Alpha content 111");
    await waitForNotesOnDisk(1);
    log("Note A saved to disk");

    await createNoteViaUi(page, "Note B", "Bravo content 222");
    await waitForNotesOnDisk(2);
    log("Note B saved to disk");

    // ── ノート一覧から A を SidePeek で開閉（#502 / #514 の混線経路） ──
    await openNoteListFromSidebar(page);
    await noteListTitle(page, "Note A").click();
    const peek = page.locator("[data-side-peek]");
    await peek.waitFor({ timeout: 15_000 });
    await peek.getByText("Alpha content 111").waitFor({ timeout: 15_000 });
    log("SidePeek shows Note A content");
    await page.locator('[title="Close side peek"]').click();
    await peek.waitFor({ state: "hidden", timeout: 15_000 });
    log("SidePeek closed");

    // ── リロード → 最後に開いていたノート B が復元される ──
    await page.reload({ waitUntil: "load" });
    const titleBox = page.getByPlaceholder("Note title");
    await titleBox.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector('[placeholder="Note title"]')?.value === "Note B",
      { timeout: 30_000 }
    );
    const bodyB = await page.locator(".bn-editor").first().innerText();
    assert(bodyB.includes("Bravo content 222"), `Note B body after reload: ${JSON.stringify(bodyB)}`);
    assert(!bodyB.includes("Alpha content 111"), "Note B must not contain Note A content (cross-contamination)");
    log("Note B intact after reload");

    // ── ノート A をフルで開いて内容確認（ダブルクリック = フルオープン） ──
    await openNoteListFromSidebar(page);
    await noteListTitle(page, "Note A").dblclick();
    await page.waitForFunction(
      () => document.querySelector('[placeholder="Note title"]')?.value === "Note A",
      { timeout: 30_000 }
    );
    const bodyA = await page.locator(".bn-editor").first().innerText();
    assert(bodyA.includes("Alpha content 111"), `Note A body after reload: ${JSON.stringify(bodyA)}`);
    assert(!bodyA.includes("Bravo content 222"), "Note A must not contain Note B content (cross-contamination)");
    log("Note A intact after reload");

    // ── ディスクレベルの最終検証（複製なし・内容の混線なし） ──
    const notes = readNotesOnDisk();
    assert(notes.length === 2, `expected exactly 2 notes on disk (no duplicates), found ${notes.length}`);
    const noteA = notes.find((n) => n.doc?.title === "Note A");
    const noteB = notes.find((n) => n.doc?.title === "Note B");
    assert(noteA, "Note A missing on disk");
    assert(noteB, "Note B missing on disk");
    const rawA = JSON.stringify(noteA.doc);
    const rawB = JSON.stringify(noteB.doc);
    assert(rawA.includes("Alpha content 111"), "Note A content missing on disk");
    assert(!rawA.includes("Bravo content 222"), "Note A on disk contaminated with Note B content");
    assert(rawB.includes("Bravo content 222"), "Note B content missing on disk");
    assert(!rawB.includes("Alpha content 111"), "Note B on disk contaminated with Note A content");
    log("disk-level verification passed");

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

let failed = false;
try {
  await run();
  log("PASS: save-path smoke test");
} catch (err) {
  failed = true;
  console.error("[e2e] FAIL:", err);
} finally {
  killChildren();
  // プロセスグループの終了を少し待ってから抜ける（port の解放）
  await new Promise((r) => setTimeout(r, 500));
}
process.exit(failed ? 1 : 0);
