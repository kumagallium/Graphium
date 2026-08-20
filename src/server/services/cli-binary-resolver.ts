// ローカル CLI バイナリ（copilot / gh）の実行パス自動検出
//
// llm.ts と copilot-subscription.ts の両方から使われるため、循環 import を
// 避けるために独立したモジュールとして切り出している
// （llm.ts → copilot-subscription.ts は動的 import だが、copilot-subscription.ts
// が llm.ts を静的 import すると dependency-cruiser の no-circular に引っかかる）。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 自動検出結果のキャッシュ。null = 未計算 / undefined = 検出失敗 / string = 検出済み。
let cachedAutoCopilotPath: string | undefined | null = null;
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
 * copilot-subscription プロバイダ用に GitHub Copilot CLI の実行パスを解決する。
 * 優先順: 明示パス（config.apiBase）→ 環境変数 GRAPHIUM_COPILOT_CLI_PATH →
 * 自動検出（プロセス内キャッシュ）。undefined を返しても SDK 側の PATH
 * フォールバックは無い（呼び出し側でエラーにする）。
 */
export function resolveCopilotBinaryPath(
  explicit?: string | null,
): string | undefined {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const fromEnv = process.env.GRAPHIUM_COPILOT_CLI_PATH;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (cachedAutoCopilotPath === null) {
    cachedAutoCopilotPath = detectCliBinary("copilot", [
      "/opt/homebrew/bin/copilot",
      "/usr/local/bin/copilot",
      join(homedir(), ".local/bin/copilot"),
      join(homedir(), ".npm-global/bin/copilot"),
    ]);
  }
  return cachedAutoCopilotPath ?? undefined;
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
