// Claude Code CLI のログインアカウント情報の読み取り
//
// claude-subscription プロバイダは認証をローカルの `claude` CLI に委譲しており、
// どのアカウント（個人/チーム）で推論されるかは CLI のログイン状態で決まる。
// Graphium 内のモデル削除・再登録では切り替わらないため、「今どのアカウントが
// 使われるか」を設定画面で見える化する目的で、CLI がログイン時にキャッシュする
// .claude.json の oauthAccount を読み取って返す。
//
// 注意: oauthAccount は CLI が最後にログインしたアカウントのキャッシュであり、
// 実際の資格情報（macOS Keychain "Claude Code-credentials" / ~/.claude/.credentials.json）
// そのものではない。`/login` で両方更新されるため実用上は一致するが、
// UI では「Claude Code CLI のログイン情報」として表示し、断定しない。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ClaudeCliAccount = {
  email: string | null;
  organization: string | null;
  organizationType: string | null;
};

/** .claude.json 相当の生 JSON 文字列から oauthAccount を抽出する（テスト可能な純関数） */
export function parseClaudeCliAccount(raw: string): ClaudeCliAccount | null {
  try {
    const data = JSON.parse(raw) as { oauthAccount?: unknown };
    const acc = data?.oauthAccount;
    if (!acc || typeof acc !== "object" || Array.isArray(acc)) return null;
    const rec = acc as Record<string, unknown>;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    const email = str(rec.emailAddress);
    const organization = str(rec.organizationName);
    const organizationType = str(rec.organizationType);
    // メールも組織名も無いエントリは表示価値が無いので「不明」扱いに倒す
    if (!email && !organization) return null;
    return { email, organization, organizationType };
  } catch {
    return null;
  }
}

/**
 * CLI 設定ファイル（.claude.json）の探索候補。
 * CLI は CLAUDE_CONFIG_DIR 設定時はその配下、既定ではホーム直下に置く。
 * 一部インストールは ~/.claude/ 配下に持つためフォールバックとして含める。
 */
function claudeConfigCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    candidates.push(join(fromEnv.trim(), ".claude.json"));
  }
  candidates.push(join(home, ".claude.json"));
  candidates.push(join(home, ".claude", ".claude.json"));
  return candidates;
}

/** ローカルの Claude Code CLI のログインアカウント情報を読む。見つからなければ null。 */
export function readClaudeCliAccount(): ClaudeCliAccount | null {
  for (const path of claudeConfigCandidates()) {
    try {
      if (!existsSync(path)) continue;
      const parsed = parseClaudeCliAccount(readFileSync(path, "utf-8"));
      if (parsed) return parsed;
    } catch {
      /* 読めないファイルはスキップして次の候補へ */
    }
  }
  return null;
}

/**
 * CLAUDE_CODE_OAUTH_TOKEN が設定されているか。
 * 設定時、CLI は .claude.json のログインよりこのトークンを優先するため、
 * oauthAccount の表示は実際に使われるアカウントと食い違い得る。UI で区別する。
 */
export function isClaudeTokenFromEnv(): boolean {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return typeof token === "string" && token.trim().length > 0;
}
