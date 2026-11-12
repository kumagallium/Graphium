// chatgpt-plan（Sign in with ChatGPT）の LanguageModel・モデル一覧・エラー変換
//
// 利用者の ChatGPT プランで OpenAI の Responses API を呼ぶ。API キーは使わず、毎回
// マネージャのアクセストークンで Authorization を上書きする。
// Responses API は `store: false` と `stream: true` が必須なので、
// - generateText の経路（doGenerate）は doStream を読み切って generate 結果に組み立てる
// - ストリームが response.completed（または incomplete / failed）無しで終わったら失敗にする

import { createOpenAI } from "@ai-sdk/openai";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Middleware,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { CodedError, type AiErrorCode } from "../../../lib/ai-error-codes.js";
import { llmFetch } from "../llm-fetch.js";
import { chatgptPlanManager } from "./manager.js";

export const CHATGPT_PLAN_BASE_URL = "https://api.openai.com/v1";

// ---- fetch（Authorization の上書き・完了イベントの見張り） ----

/** ストリームが終わりまで届いたことを示すイベント（失敗・エラーも「終わり」として数える） */
const END_TYPES = "(?:response\\.(?:completed|incomplete|failed)|error)";
// 行頭に固定する（`event:` 行、または `data:` 行の JSON の先頭の "type"）。本文中の文字列では反応しない
const STREAM_END_RE = new RegExp(
  `^(?:event:\\s*${END_TYPES}\\s*$|data:\\s*\\{\\s*"type"\\s*:\\s*"${END_TYPES}")`,
  "m",
);

/** response.completed 等が来ないまま閉じたストリームを、読み手の側でエラーにする */
function guardCompletion(res: Response): Response {
  if (!res.body) return res;
  const decoder = new TextDecoder();
  let seen = false;
  let tail = "";
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!seen) {
        const text = tail + decoder.decode(chunk, { stream: true });
        if (STREAM_END_RE.test(text)) seen = true;
        // 行の途中までしか届いていない最後の行だけ持ち越す
        tail = text.slice(text.lastIndexOf("\n") + 1);
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (!seen) throw new Error("The ChatGPT response stream ended before response.completed.");
    },
  });
  return new Response(res.body.pipeThrough(guard), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export type ChatGptPlanFetchDeps = {
  baseFetch?: typeof fetch;
  getToken?: () => Promise<string>;
};

export function createChatGptPlanFetch(deps: ChatGptPlanFetchDeps = {}): typeof fetch {
  const baseFetch = deps.baseFetch ?? llmFetch;
  const getToken = deps.getToken ?? (() => chatgptPlanManager.getAccessToken());
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    // 利用者のトークンは OpenAI の公開 API 以外へは付けない（設定の取り違えで他所へ送らないための歯止め）
    if (!url.startsWith(`${CHATGPT_PLAN_BASE_URL}/`)) {
      throw new Error("chatgpt-plan refuses to send the ChatGPT access token to a host other than api.openai.com.");
    }
    const token = await getToken();
    const headers = new Headers(init?.headers);
    // SDK が付けるダミーの API キーを、利用者のアクセストークンで上書きする
    headers.set("Authorization", `Bearer ${token}`);
    const res = await baseFetch(input, { ...init, headers });
    const isResponsesPost = (init?.method ?? "GET").toUpperCase() === "POST" && /\/responses(\?|$)/.test(url);
    return res.ok && isResponsesPost ? guardCompletion(res) : res;
  }) as typeof fetch;
}

// ---- ストリーム → generate 結果 ----

function mergeMeta(
  a: SharedV3ProviderMetadata | undefined,
  b: SharedV3ProviderMetadata | undefined,
): SharedV3ProviderMetadata | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: SharedV3ProviderMetadata = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = { ...(out[k] ?? {}), ...v };
  return out;
}

/** ストリーム中の error 部品を投げられる形にする（Error ならそのまま、そうでなければ data に載せる） */
export class ChatGptPlanStreamError extends Error {
  readonly data: unknown;
  constructor(message: string, data: unknown) {
    super(message);
    this.name = "ChatGptPlanStreamError";
    this.data = data;
  }
}

function toThrowable(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  const o = raw as { message?: unknown; error?: { message?: unknown }; code?: unknown } | null;
  const message =
    (typeof o?.message === "string" && o.message) ||
    (typeof o?.error?.message === "string" && o.error.message) ||
    (typeof o?.code === "string" && o.code) ||
    "The ChatGPT response stream reported an error.";
  return new ChatGptPlanStreamError(message, raw);
}

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

/** doStream の結果を最後まで読み、LanguageModelV3 の generate 結果に組み立てる */
export async function assembleGenerateResult(
  streamResult: LanguageModelV3StreamResult,
): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3Content[] = [];
  const textParts = new Map<string, Extract<LanguageModelV3Content, { type: "text" }>>();
  const reasoningParts = new Map<string, Extract<LanguageModelV3Content, { type: "reasoning" }>>();
  let warnings: SharedV3Warning[] = [];
  let meta: LanguageModelV3ResponseMetadata = {};
  let finish: { usage: LanguageModelV3Usage; finishReason: LanguageModelV3FinishReason; providerMetadata?: SharedV3ProviderMetadata } | null =
    null;

  const reader = streamResult.stream.getReader();
  try {
    for (;;) {
      const { done, value: part } = await reader.read();
      if (done) break;
      switch (part.type) {
        case "stream-start":
          warnings = part.warnings;
          break;
        case "response-metadata": {
          const { type: _t, ...rest } = part;
          meta = { ...meta, ...rest };
          break;
        }
        case "text-start": {
          const p = { type: "text" as const, text: "", ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) };
          textParts.set(part.id, p);
          content.push(p);
          break;
        }
        case "text-delta": {
          const p = textParts.get(part.id);
          if (p) {
            p.text += part.delta;
            p.providerMetadata = mergeMeta(p.providerMetadata, part.providerMetadata);
          }
          break;
        }
        case "text-end": {
          const p = textParts.get(part.id);
          if (p) p.providerMetadata = mergeMeta(p.providerMetadata, part.providerMetadata);
          break;
        }
        case "reasoning-start": {
          const p = { type: "reasoning" as const, text: "", ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) };
          reasoningParts.set(part.id, p);
          content.push(p);
          break;
        }
        case "reasoning-delta": {
          const p = reasoningParts.get(part.id);
          if (p) {
            p.text += part.delta;
            p.providerMetadata = mergeMeta(p.providerMetadata, part.providerMetadata);
          }
          break;
        }
        case "reasoning-end": {
          // store:false では暗号化された推論内容が start / end のどちらかの providerMetadata に入る。
          // 道具を使う複数ステップで次の呼び出しに必要なので、両方をマージして残す
          const p = reasoningParts.get(part.id);
          if (p) p.providerMetadata = mergeMeta(p.providerMetadata, part.providerMetadata);
          break;
        }
        case "tool-call":
        case "tool-result":
        case "tool-approval-request":
        case "source":
        case "file":
          content.push(part);
          break;
        case "finish":
          finish = { usage: part.usage, finishReason: part.finishReason, providerMetadata: part.providerMetadata };
          break;
        case "error":
          throw toThrowable(part.error);
        default:
          // tool-input-* / raw は generate 結果に要らない
          break;
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (!finish) {
    throw new Error("The ChatGPT response stream ended before it finished.");
  }
  // 中身の無いテキスト・推論の殻は落とす（メタデータがあるものは残す）
  const cleaned = content.filter((c) => (c.type === "text" || c.type === "reasoning" ? c.text.length > 0 || !!c.providerMetadata : true));
  return {
    content: cleaned,
    finishReason: finish.finishReason,
    usage: finish.usage ?? EMPTY_USAGE,
    ...(finish.providerMetadata ? { providerMetadata: finish.providerMetadata } : {}),
    ...(streamResult.request ? { request: streamResult.request } : {}),
    response: { ...meta, ...(streamResult.response?.headers ? { headers: streamResult.response.headers } : {}) },
    warnings,
  };
}

// ---- middleware ----

/** Responses API（ChatGPT プラン）が受け付けないサンプリング指定を落とす */
const SAMPLING_KEYS = ["temperature", "topP", "topK", "presencePenalty", "frequencyPenalty", "seed"] as const;

export const chatgptPlanMiddleware: LanguageModelV3Middleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const next: LanguageModelV3CallOptions = { ...params };
    for (const k of SAMPLING_KEYS) delete next[k];
    next.providerOptions = {
      ...params.providerOptions,
      openai: { ...(params.providerOptions?.openai ?? {}), store: false },
    };
    return next;
  },
  // API が stream: true 必須のため、doGenerate は呼ばずに doStream を読み切って組み立てる
  wrapGenerate: async ({ doStream }) => {
    try {
      return await assembleGenerateResult(await doStream());
    } catch (err) {
      // 利用上限・対象外・認証切れは CodedError にして投げる。APICallError でなくなるので、
      // SDK が 429 などを無駄に再試行しない。UNAVAILABLE（503）は SDK の再試行に任せる
      const described = describeChatGptPlanError(err);
      if (described && described.code !== "CHATGPT_PLAN_UNAVAILABLE") {
        throw new CodedError(described.message, described.code);
      }
      throw normalizeChatGptPlanError(err) ?? err;
    }
  },
};

export function createChatGptPlanModel(modelId: string, deps: ChatGptPlanFetchDeps = {}): LanguageModel {
  const provider = createOpenAI({
    apiKey: "chatgpt-plan",
    baseURL: CHATGPT_PLAN_BASE_URL,
    fetch: createChatGptPlanFetch(deps),
  });
  return wrapLanguageModel({ model: provider.responses(modelId), middleware: chatgptPlanMiddleware });
}

// ---- モデル一覧 ----

/** /models が返した HTTP 失敗（describeChatGptPlanError が statusCode・responseBody を読む） */
export class ChatGptPlanHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(statusCode: number, responseBody: string) {
    super(`ChatGPT plan API error (${statusCode})`);
    this.name = "ChatGptPlanHttpError";
    this.statusCode = statusCode;
    this.responseBody = responseBody.slice(0, 2000);
  }
}

export async function listChatGptPlanModels(
  deps: ChatGptPlanFetchDeps = {},
): Promise<{ id: string; name: string }[]> {
  const token = await (deps.getToken ?? (() => chatgptPlanManager.getAccessToken()))();
  const res = await (deps.baseFetch ?? fetch)(`${CHATGPT_PLAN_BASE_URL}/models`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new ChatGptPlanHttpError(res.status, text);
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  // 文書どおりの { models: [{ slug, display_name, visibility }] } と、{ data: [{ id }] } の両方を読む
  const items = (Array.isArray(body?.models) ? body.models : Array.isArray(body?.data) ? body.data : []) as Record<string, unknown>[];
  const out: { id: string; name: string }[] = [];
  for (const m of items) {
    // visibility があるときは "list" だけ載せる（無い項目は載せる）。順序はそのまま
    if (m.visibility !== undefined && m.visibility !== "list") continue;
    const id = typeof m.slug === "string" && m.slug ? m.slug : typeof m.id === "string" ? m.id : "";
    if (!id) continue;
    out.push({ id, name: typeof m.display_name === "string" && m.display_name ? m.display_name : id });
  }
  return out;
}

// ---- エラーの読み取り・変換 ----

type Found = { status?: number; code?: string; param?: string; message?: string; detail?: string };

/** APICallError（statusCode / responseBody / data）とストリーム中の error の両方から手掛かりを集める */
function collect(err: unknown): Found {
  const found: Found = {};
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number): void => {
    if (v == null || depth > 6) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("{")) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {
          // JSON でなければ無視
        }
      }
      return;
    }
    if (typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (found.status === undefined && typeof o.statusCode === "number") found.status = o.statusCode;
    if (found.code === undefined && typeof o.code === "string") found.code = o.code;
    if (found.param === undefined && typeof o.param === "string") found.param = o.param;
    if (found.message === undefined && typeof o.message === "string") found.message = o.message;
    if (found.detail === undefined && typeof o.detail === "string") found.detail = o.detail;
    // AI SDK の RetryError は最後の失敗（lastError）と全部の失敗（errors）を持つ
    for (const k of ["lastError", "responseBody", "data", "error", "response", "cause"]) visit(o[k], depth + 1);
    if (Array.isArray(o.errors)) for (const e of [...o.errors].reverse()) visit(e, depth + 1);
  };
  visit(err, 0);
  return found;
}

const MESSAGES: Record<Extract<AiErrorCode, `CHATGPT_PLAN_${string}`>, string> = {
  CHATGPT_PLAN_AUTH_EXPIRED:
    "Your ChatGPT sign-in is missing or has expired. Sign in again in Settings → AI.",
  CHATGPT_PLAN_LIMIT_REACHED:
    "The ChatGPT plan usage limit has been reached. Check your usage in ChatGPT settings → Usage, then try again later.",
  CHATGPT_PLAN_NOT_ELIGIBLE:
    "This ChatGPT account, workspace, or region can't use plan access from Graphium. Check your plan in ChatGPT, or choose another AI provider in Settings → AI.",
  CHATGPT_PLAN_UNAVAILABLE:
    "ChatGPT plan access is temporarily unavailable. Your sign-in is kept; try again in a little while.",
};

const CODE_MAP: Record<string, keyof typeof MESSAGES> = {
  subscription_sharing_usage_limit_exceeded: "CHATGPT_PLAN_LIMIT_REACHED",
  subscription_sharing_user_not_eligible: "CHATGPT_PLAN_NOT_ELIGIBLE",
  subscription_sharing_route_not_supported: "CHATGPT_PLAN_NOT_ELIGIBLE",
  chatpass_v2_scope_not_authorized: "CHATGPT_PLAN_NOT_ELIGIBLE",
  chatpass_v2_invalid_authorization_context: "CHATGPT_PLAN_NOT_ELIGIBLE",
  subscription_sharing_usage_unavailable: "CHATGPT_PLAN_UNAVAILABLE",
  subscription_sharing_user_unavailable: "CHATGPT_PLAN_UNAVAILABLE",
  subscription_sharing_invalid_user: "CHATGPT_PLAN_AUTH_EXPIRED",
  CHATGPT_PLAN_AUTH_EXPIRED: "CHATGPT_PLAN_AUTH_EXPIRED",
  CHATGPT_PLAN_LIMIT_REACHED: "CHATGPT_PLAN_LIMIT_REACHED",
  CHATGPT_PLAN_NOT_ELIGIBLE: "CHATGPT_PLAN_NOT_ELIGIBLE",
  CHATGPT_PLAN_UNAVAILABLE: "CHATGPT_PLAN_UNAVAILABLE",
};

/**
 * chatgpt-plan の失敗を、利用者に案内できる { message, code } に変換する。
 * 対応が無ければ null（呼び出し側はそのまま投げ直す）。
 */
export function describeChatGptPlanError(err: unknown): { message: string; code: AiErrorCode } | null {
  // こちらで投げた CodedError は、文言を保ったまま通す
  if (err instanceof CodedError && err.code in MESSAGES) {
    return { message: err.message, code: err.code };
  }
  const f = collect(err);
  const mapped = f.code ? CODE_MAP[f.code] : undefined;
  if (mapped) return { message: MESSAGES[mapped], code: mapped };
  // code が無い（または未知の）401 / 403 / 503 は素のステータスで判断する
  if (f.status === 401) return { message: MESSAGES.CHATGPT_PLAN_AUTH_EXPIRED, code: "CHATGPT_PLAN_AUTH_EXPIRED" };
  if (f.status === 403) return { message: MESSAGES.CHATGPT_PLAN_NOT_ELIGIBLE, code: "CHATGPT_PLAN_NOT_ELIGIBLE" };
  if (f.status === 503) return { message: MESSAGES.CHATGPT_PLAN_UNAVAILABLE, code: "CHATGPT_PLAN_UNAVAILABLE" };
  return null;
}

/**
 * 利用者向けの code を持たないが、文を整えて投げたいエラー（unsupported_capability）。
 * error.param を文に含める。該当しなければ null。
 */
export function normalizeChatGptPlanError(err: unknown): Error | null {
  const f = collect(err);
  if (f.code !== "subscription_sharing_unsupported_capability") return null;
  return new Error(
    `The ChatGPT plan does not support this capability${f.param ? ` (${f.param})` : ""}${f.message ? `: ${f.message}` : "."}`,
  );
}
