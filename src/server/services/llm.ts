// Vercel AI SDK マルチプロバイダー LLM ラッパー
// ModelConfig に基づいて適切なプロバイダーインスタンスを生成する

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { ModelConfig } from "../config/models.js";
import { CodedError } from "../../lib/ai-error-codes.js";

/**
 * ModelConfig からプロバイダーインスタンスを生成する
 *
 * claude-subscription だけは `ai-sdk-provider-claude-code`（＝ Claude Code バイナリの
 * subprocess 起動）を動的 import するため async。重い `@anthropic-ai/claude-agent-sdk` を
 * Web(Vercel) ビルドに静的同梱しないための意図的な遅延ロード。
 *
 * @param opts.allowWebSearch claude-subscription 経路で Claude Code 内蔵の
 *   WebSearch / WebFetch を解禁する。チャット（agent.chat）だけが渡す想定で、
 *   翻訳・Wiki・atomizer 等の決定的に動くべき機能には波及させない。
 */
export async function createModel(
  config: ModelConfig,
  opts?: { allowWebSearch?: boolean },
): Promise<LanguageModel> {
  switch (config.provider) {
    case "anthropic": {
      // `createAnthropic` に baseURL を渡さないと SDK は環境変数 `ANTHROPIC_BASE_URL` を
      // 読み、最終フォールバックで `https://api.anthropic.com/v1` を使う。
      // 環境に `ANTHROPIC_BASE_URL=https://api.anthropic.com`（/v1 なし）が
      // セットされていると、SDK は `${env}/messages` を叩いて 404 を返す。
      // また `fetchAnthropicModels` は historically apiBase に `/v1` を付けない形で
      // 保存していたケースがあるので、ユーザー指定値も末尾を正規化する。
      // → 環境変数の影響を断ち切るため、常に明示的に baseURL を渡す。
      const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";
      const normalizedBase = (() => {
        if (!config.apiBase) return ANTHROPIC_DEFAULT_BASE;
        const trimmed = config.apiBase.replace(/\/$/, "");
        return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
      })();
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: normalizedBase,
      });
      return provider(config.modelId);
    }
    case "openai": {
      // apiBase が設定されている場合は openai-compatible を使う
      // （@ai-sdk/openai は baseURL でカスタムエンドポイントを正しく扱えない場合がある）
      if (config.apiBase) {
        const provider = createOpenAICompatible({
          name: config.name,
          baseURL: config.apiBase,
          apiKey: config.apiKey,
        });
        return provider(config.modelId);
      }
      const provider = createOpenAI({ apiKey: config.apiKey });
      return provider(config.modelId);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return provider(config.modelId);
    }
    case "openai-compatible": {
      if (!config.apiBase) {
        throw new Error("openai-compatible プロバイダーには apiBase が必要です");
      }
      const provider = createOpenAICompatible({
        name: config.name,
        baseURL: config.apiBase,
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    case "claude-subscription": {
      // ローカルの Claude Code CLI を subprocess 起動し、ユーザーの Claude Pro/Max
      // サブスク認証（~/.claude セッション or CLAUDE_CODE_OAUTH_TOKEN）で推論する。
      // API キーは不要。従量課金も発生しない（個人利用向けオプション）。
      //
      // - 動的 import: 重い @anthropic-ai/claude-agent-sdk を Web ビルドに巻き込まない。
      // - pathToClaudeCodeExecutable: 既存 claude を参照し、ネイティブバイナリ同梱を回避。
      //   config.apiBase をこのプロバイダでは「claude CLI の絶対パス（任意）」として流用する。
      // - settingSources 省略 = isolation（~/.claude/CLAUDE.md 等を読み込まない）。
      // - allowedTools は既定で [] とし、Claude Code 内蔵ツール（Read/Write/Bash 等）の
      //   自律実行を止めて純粋なテキスト生成器として使う。Graphium 側のツール実行は
      //   text-tool-call フォールバック（agent-loop-text-tools.ts）が担う。
      // - 例外として allowWebSearch（チャット経路のみが渡す）が真のときだけ WebSearch /
      //   WebFetch を解禁する。検索→読込→要約は CLI のネイティブループ内で完結し、
      //   サブスク枠で web 検索できる。ただし Graphium の text-tool 経路や PROV 追跡の
      //   外側で起きる点に注意（来歴は残らない）。
      const { createClaudeCode } = await import("ai-sdk-provider-claude-code");
      const binaryPath = resolveClaudeBinaryPath(config.apiBase);
      const allowedTools = opts?.allowWebSearch ? ["WebSearch", "WebFetch"] : [];
      const provider = createClaudeCode({
        defaultSettings: {
          ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
          allowedTools,
          logger: false,
        },
      });
      return provider(config.modelId || "sonnet");
    }
    default:
      throw new Error(`未知のプロバイダー: ${config.provider}`);
  }
}

/**
 * claude-subscription プロバイダ用に Claude Code CLI の実行パスを解決する。
 * 優先順:
 *   1. モデル設定の明示パス（config.apiBase）
 *   2. 環境変数 GRAPHIUM_CLAUDE_CLI_PATH
 *   3. 自動検出（detectClaudeBinary）— 結果はプロセス内でキャッシュ
 * いずれも取れなければ undefined を返し、プロバイダ既定（PATH 上の `claude`）に委ねる。
 */
function resolveClaudeBinaryPath(explicit?: string | null): string | undefined {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const fromEnv = process.env.GRAPHIUM_CLAUDE_CLI_PATH;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (cachedAutoClaudePath === null) {
    cachedAutoClaudePath = detectClaudeBinary();
  }
  return cachedAutoClaudePath ?? undefined;
}

/**
 * claude-subscription 用の Claude Code CLI が検出できるか。
 * 1-click サブスク登録ボタンの出し分けに使う（検出できないマシンでは提示しない）。
 * ログイン状態までは見ない — 未ログインは初回推論時の 401（describeAuthError）で導線を出す。
 */
export function isClaudeCliAvailable(): boolean {
  return resolveClaudeBinaryPath() !== undefined;
}

// 自動検出結果のキャッシュ。null = 未計算 / undefined = 検出失敗 / string = 検出済み。
let cachedAutoClaudePath: string | undefined | null = null;

/**
 * `claude` バイナリを自動検出する。Tauri パッケージ版のサイドカーは最小化された PATH で
 * 起動されるため、PATH 依存の `which` だけでは nvm/homebrew 配下を取りこぼす。
 * ログインシェルの PATH と主要インストール先・nvm 走査まで含めて「ほぼ無設定で見つかる」
 * ことを狙う。ユーザーが明示パス／env を指定した場合はそちらが優先される（本関数は呼ばれない）。
 */
function detectClaudeBinary(): string | undefined {
  // 1. 現在の PATH 上の which（dev 起動などで PATH が揃っている場合）
  try {
    const out = execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 3000 })
      .trim()
      .split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* PATH に無い場合は次へ */
  }

  // 2. ログインシェルの PATH（GUI 起動だと PATH が最小化されるため、rc を読ませて解決する）
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-lc", "command -v claude"], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .trim()
      .split("\n")[0];
    if (out && existsSync(out)) return out;
  } catch {
    /* rc が無い等は次へ */
  }

  const home = homedir();

  // 3. よくあるインストール先を直接確認
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"), // Claude Code ネイティブインストーラ既定
    join(home, ".npm-global/bin/claude"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // 4. nvm 配下の全 node バージョンを走査（claude は特定バージョンの bin にだけ入る）
  const nvmDir = join(home, ".nvm/versions/node");
  try {
    for (const version of readdirSync(nvmDir)) {
      const c = join(nvmDir, version, "bin/claude");
      if (existsSync(c)) return c;
    }
  } catch {
    /* nvm 未使用なら無視 */
  }

  return undefined;
}

/**
 * API キーでプロバイダーのモデル一覧を取得する
 * (Crucible Agent の POST /models/available と同等)
 */
export async function fetchAvailableModels(
  provider: string,
  apiKey: string,
  apiBase?: string,
): Promise<string[]> {
  const base = apiBase || DEFAULT_API_BASE[provider];
  if (!base) {
    throw new Error(`${provider} には API Base URL が必要です`);
  }

  const fetcher = PROVIDER_FETCHER[provider] ?? fetchOpenAIModels;
  return fetcher(base, apiKey);
}

const DEFAULT_API_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
};

type ModelFetcher = (apiBase: string, apiKey: string) => Promise<string[]>;

const PROVIDER_FETCHER: Record<string, ModelFetcher> = {
  anthropic: fetchAnthropicModels,
  google: fetchGoogleModels,
  // openai, groq, ollama は OpenAI 互換
};

async function fetchOpenAIModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw await formatApiError(res);
  const data = (await res.json()) as {
    data?: { id: string }[];
  };
  return (data.data ?? []).map((m) => m.id).sort();
}

async function fetchAnthropicModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/v1/models`;
  const all: string[] = [];
  const params = new URLSearchParams({ limit: "100" });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${url}?${params}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) throw await formatApiError(res);
    const data = (await res.json()) as {
      data?: { id: string }[];
      has_more?: boolean;
      last_id?: string;
    };
    all.push(...(data.data ?? []).map((m) => m.id));
    if (!data.has_more) break;
    params.set("after_id", data.last_id ?? "");
  }
  return all.sort();
}

async function fetchGoogleModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/v1beta/models`;
  const all: string[] = [];
  const params = new URLSearchParams({ key: apiKey, pageSize: "100" });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${url}?${params}`);
    if (!res.ok) throw await formatApiError(res);
    const data = (await res.json()) as {
      models?: {
        name: string;
        supportedGenerationMethods?: string[];
      }[];
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
      const name = m.name.startsWith("models/")
        ? m.name.slice("models/".length)
        : m.name;
      if (name) all.push(name);
    }
    if (!data.nextPageToken) break;
    params.set("pageToken", data.nextPageToken);
  }
  return all.sort();
}

// プロバイダー API の失敗レスポンスを、code 付き Error（認証系）または素の Error に変換する。
// メッセージは英語フォールバック（サーバーは locale を知らない）。クライアントは code を
// i18n 文言に置き換える（src/lib/ai-error.ts の localizeAiError）。
async function formatApiError(res: Response): Promise<Error> {
  if (res.status === 401) {
    return new CodedError("The API key is invalid.", "INVALID_API_KEY");
  }
  if (res.status === 403) {
    return new CodedError("The API key does not have permission.", "API_KEY_FORBIDDEN");
  }
  const text = await res.text().catch(() => "");
  return new Error(`Provider API error (${res.status}): ${text.slice(0, 200)}`);
}
