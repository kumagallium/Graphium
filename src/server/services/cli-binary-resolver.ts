// ローカル CLI バイナリ（copilot / gh）の実行パス自動検出
//
// llm.ts と copilot-subscription.ts の両方から使われるため、循環 import を
// 避けるために独立したモジュールとして切り出している
// （llm.ts → copilot-subscription.ts は動的 import だが、copilot-subscription.ts
// が llm.ts を静的 import すると dependency-cruiser の no-circular に引っかかる）。

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { isManagedCopilotCliPath, managedCopilotCliPath } from "./copilot-cli-location.js";

// 自動検出結果のキャッシュ。null = 未計算 / undefined = 検出失敗 / string = 検出済み（動作確認済み）。
let cachedAutoCopilotPath: string | undefined | null = null;
// 検出失敗（undefined）は永久には覚えない — 後から入れた CLI を拾えるよう一定時間で捨てる
const execFileAsync = promisify(execFile);
const NEGATIVE_CACHE_MS = 30_000;
let cachedAutoCopilotAt = 0;
let cachedAutoGhPath: string | undefined | null = null;

/**
 * CLI バイナリの汎用自動検出。Tauri パッケージ版のサイドカーは最小化された PATH で
 * 起動されるため、PATH 依存の `which` だけでは nvm/homebrew 配下を取りこぼす。
 * which → ログインシェルの PATH → 既知のインストール先 → nvm 配下走査の順で探し、
 * 「ほぼ無設定で見つかる」ことを狙う。明示パス／env 指定時は本関数は呼ばれない。
 */
function detectCliBinary(
  binName: string,
  candidates: string[],
): string | undefined {
  // 1. 現在の PATH 上の which（dev 起動などで PATH が揃っている場合）
  try {
    const out = execFileSync("which", [binName], { encoding: "utf-8", timeout: 3000 })
      .trim()
      .split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* PATH に無い場合は次へ */
  }

  // 2. ログインシェルの PATH（GUI 起動だと PATH が最小化されるため、rc を読ませて解決する）
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-lc", `command -v ${binName}`], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .trim()
      .split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* rc が無い等は次へ */
  }

  // 3. よくあるインストール先を直接確認
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // 4. nvm 配下の全 node バージョンを走査（npm global 系 CLI は特定バージョンの bin にだけ入る）
  const nvmDir = join(homedir(), ".nvm/versions/node");
  try {
    for (const version of readdirSync(nvmDir)) {
      const c = join(nvmDir, version, `bin/${binName}`);
      if (existsSync(c)) return c;
    }
  } catch {
    /* nvm 未使用なら無視 */
  }

  return undefined;
}

/**
 * copilot CLI の子プロセスに渡す env を組み立てる（実行時と `--version` 検証で共通）。
 *
 * 1. copilot CLI は `#!/usr/bin/env node` で起動するスクリプトのため、spawn 時の
 *    PATH 上に node が無いと exit 127 で落ちる。このサーバー自身が動いている node
 *    （process.execPath）のディレクトリを PATH に足す。
 * 2. copilot CLI は認証解決で内部的に `gh` を呼ぶ。`gh` が PATH に無いと
 *    "Not authenticated" になるため、gh のディレクトリも足す。
 * 3. Graphium が取得した CLI は版を固定するため `COPILOT_AUTO_UPDATE=false` を付ける。
 *
 * Tauri パッケージ版のサイドカーは最小化された PATH で起動される。
 */
export function buildCopilotEnv(cliPath?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const extraDirs = [dirname(process.execPath)];
  const ghPath = resolveGhBinaryPath();
  if (ghPath) extraDirs.push(dirname(ghPath));
  const prefix = extraDirs.join(delimiter);
  // Windows は "Path" など大文字小文字が違うキーで持つ。既存のキーを書き換える
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = env[pathKey] ? `${prefix}${delimiter}${env[pathKey]}` : prefix;
  if (cliPath && isManagedCopilotCliPath(cliPath)) env.COPILOT_AUTO_UPDATE = "false";
  return env;
}

/** Copilot CLI の出どころ */
export type CopilotCliSource = "configured" | "detected" | "managed";

/** `<bin> --version` が 10 秒以内に成功するか（壊れた CLI を採用しないための確認） */
export function copilotBinaryRuns(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], {
      stdio: "ignore",
      env: buildCopilotEnv(bin),
      timeout: 10_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** 自動検出のキャッシュを捨てる（Graphium が CLI を取得し終えたときなどに呼ぶ） */
export function resetCopilotCliCache(): void {
  cachedAutoCopilotPath = null;
  cachedAutoCopilotAt = 0;
  pendingDetect = null;
}

/** copilotBinaryRuns の非同期版 */
export async function copilotBinaryRunsAsync(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["--version"], {
      env: buildCopilotEnv(bin),
      timeout: 10_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** detectCliBinary の非同期版（イベントループを止めない。探す順は同じ） */
async function detectCliBinaryAsync(
  binName: string,
  candidates: string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("which", [binName], { timeout: 3000 });
    const out = stdout.trim().split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* PATH に無い場合は次へ */
  }
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await execFileAsync(shell, ["-lc", `command -v ${binName}`], {
      timeout: 3000,
    });
    const out = stdout.trim().split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* rc が無い等は次へ */
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const nvmDir = join(homedir(), ".nvm/versions/node");
  try {
    for (const version of readdirSync(nvmDir)) {
      const c = join(nvmDir, version, `bin/${binName}`);
      if (existsSync(c)) return c;
    }
  } catch {
    /* nvm 未使用なら無視 */
  }
  return undefined;
}

function copilotCandidates(): string[] {
  return [
    "/opt/homebrew/bin/copilot",
    "/usr/local/bin/copilot",
    join(homedir(), ".local/bin/copilot"),
    join(homedir(), ".npm-global/bin/copilot"),
  ];
}

function autoCacheValid(): boolean {
  return (
    cachedAutoCopilotPath !== null &&
    (cachedAutoCopilotPath !== undefined || Date.now() - cachedAutoCopilotAt <= NEGATIVE_CACHE_MS)
  );
}

// 進行中の非同期検出（同時呼び出しで CLI を重複起動しない）
let pendingDetect: Promise<string | undefined> | null = null;

async function detectWorkingCopilotAsync(): Promise<string | undefined> {
  if (autoCacheValid()) return cachedAutoCopilotPath ?? undefined;
  if (!pendingDetect) {
    pendingDetect = (async () => {
      const found = await detectCliBinaryAsync("copilot", copilotCandidates());
      const ok = found && (await copilotBinaryRunsAsync(found)) ? found : undefined;
      cachedAutoCopilotPath = ok;
      cachedAutoCopilotAt = Date.now();
      return ok;
    })().finally(() => {
      pendingDetect = null;
    });
  }
  return pendingDetect;
}

function detectWorkingCopilot(): string | undefined {
  if (!autoCacheValid()) {
    const found = detectCliBinary("copilot", copilotCandidates());
    // 見つかっても動かないもの（platform パッケージ欠落の npm 版など）は採用しない
    cachedAutoCopilotPath = found && copilotBinaryRuns(found) ? found : undefined;
    cachedAutoCopilotAt = Date.now();
  }
  return cachedAutoCopilotPath ?? undefined;
}

/**
 * Copilot CLI の実行パスと出どころを解決する。
 * 優先順: 明示パス（config.apiBase）→ 環境変数 GRAPHIUM_COPILOT_CLI_PATH →
 * 自動検出（動くものだけ・プロセス内キャッシュ）→ Graphium が取得した CLI（存在すれば）。
 */
function resolveExplicit(
  explicit?: string | null,
): { path: string; source: CopilotCliSource } | undefined {
  if (explicit && explicit.trim().length > 0) {
    return { path: explicit.trim(), source: "configured" };
  }
  const fromEnv = process.env.GRAPHIUM_COPILOT_CLI_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return { path: fromEnv.trim(), source: "configured" };
  }
  return undefined;
}

export function resolveCopilotBinary(
  explicit?: string | null,
): { path: string; source: CopilotCliSource } | undefined {
  const fixed = resolveExplicit(explicit);
  if (fixed) return fixed;
  const detected = detectWorkingCopilot();
  if (detected) return { path: detected, source: "detected" };
  const managed = managedCopilotCliPath();
  if (existsSync(managed)) return { path: managed, source: "managed" };
  return undefined;
}

/** resolveCopilotBinary の非同期版（status 用。検出・動作確認でイベントループを止めない。キャッシュは共有） */
export async function resolveCopilotBinaryAsync(
  explicit?: string | null,
): Promise<{ path: string; source: CopilotCliSource } | undefined> {
  const fixed = resolveExplicit(explicit);
  if (fixed) return fixed;
  const detected = await detectWorkingCopilotAsync();
  if (detected) return { path: detected, source: "detected" };
  const managed = managedCopilotCliPath();
  if (existsSync(managed)) return { path: managed, source: "managed" };
  return undefined;
}

/**
 * copilot-subscription プロバイダ用に GitHub Copilot CLI の実行パスを解決する。
 * undefined を返しても SDK 側の PATH フォールバックは無い（呼び出し側でエラーにする）。
 */
export function resolveCopilotBinaryPath(
  explicit?: string | null,
): string | undefined {
  return resolveCopilotBinary(explicit)?.path;
}

/**
 * copilot-subscription 用の GitHub Copilot CLI が検出できるか。
 * 1-click サブスク登録ボタンの出し分けに使う（検出できないマシンでは提示しない）。
 * ログイン状態までは見ない — 未ログインは初回推論時の認証エラーで導線を出す。
 */
export function isCopilotCliAvailable(): boolean {
  return resolveCopilotBinaryPath() !== undefined;
}

/**
 * `gh` CLI の実行パスを解決する（copilot-subscription が子プロセスの PATH に
 * 足すため）。Copilot CLI は `useLoggedInUser: true` の認証解決で内部的に `gh`
 * をサブプロセスとして呼ぶため、PATH 上に `gh` が無いと「起動はできるが
 * 認証情報が取れない」状態になる（copilot バイナリ自体の PATH 問題とは別）。
 */
export function resolveGhBinaryPath(): string | undefined {
  if (cachedAutoGhPath === null) {
    cachedAutoGhPath = detectCliBinary("gh", [
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      join(homedir(), ".local/bin/gh"),
    ]);
  }
  return cachedAutoGhPath ?? undefined;
}
