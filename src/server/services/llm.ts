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
 * copilot-subscription だけは `@github/copilot-sdk`（＝ Copilot CLI の subprocess 起動）を
 * 動的 import するため async。重い SDK を Web(Vercel) ビルドに静的同梱しないための
 * 意図的な遅延ロード。
 */
export async function createModel(config: ModelConfig): Promise<LanguageModel> {
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
        throw new Error("The openai-compatible provider requires apiBase");
      }
      const provider = createOpenAICompatible({
        name: config.name,
        baseURL: config.apiBase,
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    case "claude-subscription": {
      // 旧 claude-subscription（Claude Code CLI 経由でサブスク枠を使う）は撤去した。
      // Anthropic の規約がサードパーティ製品からの Pro/Max サブスク利用を明文で
      // 禁止しているため（Agent SDK 経由の「本物の CLI 起動」でも同じ）。
      // 保存済み設定は config/models.ts の purge が起動時に取り除くので、通常ここには
      // 来ない。来た場合（purge 前の並行リクエスト等）は移行先を案内して失敗させる。
      throw new Error(
        "Claude subscription support has been removed (Anthropic's terms do not allow third-party apps to use subscription auth). Use a GitHub Copilot subscription or an API-key provider in Settings → AI instead.",
      );
    }
    case "copilot-subscription": {
      // ローカルの GitHub Copilot CLI（公式 @github/copilot-sdk 経由）を subprocess
      // 起動し、ユーザーの Copilot サブスク認証（CLI のログイン）で推論する。
      // API キーは不要（詳細は copilot-subscription.ts）。
      //
      // - 動的 import: @github/copilot-sdk を Web ビルドに巻き込まない。
      // - config.apiBase は「copilot CLI の絶対パス（任意）」として流用する。
      // - SDK に PATH フォールバックが無い（既定は npm 同梱ランタイム解決で、
      //   バンドルには存在しない）ため、パスが解決できなければここで明確に失敗させる。
      const { createCopilotModel } = await import("./copilot-subscription.js");
      const binaryPath = resolveCopilotBinaryPath(config.apiBase);
      if (!binaryPath) {
        throw new Error(
          "GitHub Copilot CLI not found. Install it (e.g. `npm install -g @github/copilot`), sign in with `copilot`, or set the CLI path in Settings → AI.",
        );
      }
      return createCopilotModel({
        cliPath: binaryPath,
        modelId: config.modelId,
      });
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
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

// 自動検出結果のキャッシュ。null = 未計算 / undefined = 検出失敗 / string = 検出済み。
let cachedAutoCopilotPath: string | undefined | null = null;

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
 * API キーでプロバイダーのモデル一覧を取得する
 * (Crucible Agent の POST /models/available と同等)
 */
export async function fetchAvailableModels(
  provider: string,
  apiKey: string,
  apiBase?: string,
): Promise<string[]> {
  // copilot-subscription は API キーではなくローカル CLI（SDK の listModels）から取得する。
  // apiBase はこのプロバイダでは「copilot CLI の絶対パス（任意）」。
  if (provider === "copilot-subscription") {
    const { listCopilotModels } = await import("./copilot-subscription.js");
    const binaryPath = resolveCopilotBinaryPath(apiBase);
    if (!binaryPath) {
      throw new Error(
        "GitHub Copilot CLI not found. Install it (e.g. `npm install -g @github/copilot`) or set the CLI path first.",
      );
    }
    return listCopilotModels(binaryPath);
  }

  const base = apiBase || DEFAULT_API_BASE[provider];
  if (!base) {
    throw new Error(`${provider} requires an API Base URL`);
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
