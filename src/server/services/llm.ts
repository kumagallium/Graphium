// Vercel AI SDK マルチプロバイダー LLM ラッパー
// ModelConfig に基づいて適切なプロバイダーインスタンスを生成する

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelConfig } from "../config/models.js";
import { CodedError } from "../../lib/ai-error-codes.js";
import { resolveCopilotBinaryPath } from "./cli-binary-resolver.js";

// copilot-subscription / gh の CLI パス解決は cli-binary-resolver.ts に集約している
// （copilot-subscription.ts も同モジュールを使うため、循環 import を避けている）。
export {
  resolveCopilotBinaryPath,
  isCopilotCliAvailable,
  resolveGhBinaryPath,
} from "./cli-binary-resolver.js";

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
