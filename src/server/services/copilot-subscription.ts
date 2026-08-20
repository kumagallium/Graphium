// GitHub Copilot サブスクリプションプロバイダ（公式 @github/copilot-sdk 経由）
//
// ローカルの `copilot` CLI を subprocess 起動し、
// ユーザーの Copilot サブスク認証（CLI のログイン）で推論する。API キーは不要。
//
// なぜ自前アダプタか: コミュニティ製 AI SDK アダプタはプレ GA の SDK（0.1.x）に
// 固定されたまま更新が止まっており、GA 後の CLI とのプロトコル齟齬リスクがある。
// 公式 SDK（GA・MIT）を直接使い、LanguageModelV3 への変換だけをここで持つ。
//
// 設計メモ:
// - CopilotClient は CLI を server モードで 1 プロセス spawn し JSON-RPC で会話する。
//   spawn コスト（数百 ms〜）を呼び出しごとに払わないよう cliPath 単位でキャッシュし、
//   呼び出しごとには短命セッションだけを作って捨てる。
// - LanguageModel 経路（doGenerate / doStream）では `availableTools: []` で Copilot 内蔵
//   ツール（シェル実行・ファイル編集等）を全て無効化し、純粋なテキスト生成器として使う。
// - Graphium のツール（MCP）を使う呼び出しは runCopilotWithTools（下）で、SDK に
//   ツールを handler 付きで渡してネイティブに実行させる。agent-loop がツール有無で
//   経路を振り分ける。
// - AI SDK は stateless、Copilot セッションは stateful。メッセージ履歴は 1 本の
//   テキストに平坦化して送る。
// - system プロンプトは systemMessage: { mode: "replace" } で全置換し、Copilot 既定の
//   コーディングエージェント人格が翻訳・Wiki 等の決定的機能に混ざらないようにする。

import type {
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type {
  CopilotClient,
  CopilotSession,
  SessionEvent,
} from "@github/copilot-sdk";
import { dirname } from "node:path";
import { CodedError } from "../../lib/ai-error-codes.js";
import { resolveGhBinaryPath } from "./cli-binary-resolver.js";

export type CopilotModelSettings = {
  /** `copilot` CLI の絶対パス（必須 — SDK 同梱ランタイムはバンドルに含めないため） */
  cliPath: string;
  /** Copilot 上のモデル ID。空 / "default" は CLI の既定モデルに委ねる */
  modelId?: string;
};

/** "default" / 空文字は「CLI の既定モデル」の意味で undefined に写す */
export function resolveCopilotModelId(modelId?: string): string | undefined {
  const trimmed = modelId?.trim();
  if (!trimmed || trimmed === "default") return undefined;
  return trimmed;
}

/** Copilot の finishReason（OpenAI 語彙に正規化済み）→ AI SDK v3 の unified 表現 */
export function mapCopilotFinishReason(
  raw: string | undefined,
): LanguageModelV3FinishReason {
  switch (raw) {
    case "stop":
      return { unified: "stop", raw };
    case "length":
      return { unified: "length", raw };
    case "content_filter":
      return { unified: "content-filter", raw };
    case "tool_calls":
      return { unified: "tool-calls", raw };
    case undefined:
      // usage イベントが finishReason を載せないことがある。正常終了経路なので stop 扱い。
      return { unified: "stop", raw: undefined };
    default:
      return { unified: "other", raw };
  }
}

type CopilotUsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function mapCopilotUsage(data?: CopilotUsageLike): LanguageModelV3Usage {
  // Copilot の inputTokens はプロバイダ報告値をそのまま total として扱う。
  // cacheRead/Write は参考値（サブスクなのでコスト計算には使われない）。
  return {
    inputTokens: {
      total: data?.inputTokens,
      noCache: undefined,
      cacheRead: data?.cacheReadTokens,
      cacheWrite: data?.cacheWriteTokens,
    },
    outputTokens: {
      total: data?.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
    raw: data ? (data as JSONObject) : undefined,
  };
}

/**
 * AI SDK のメッセージ配列を Copilot セッションの 1 プロンプトへ平坦化する。
 *
 * - system メッセージは systemMessage(replace) へ回すため分離して返す
 * - user 1 通だけの典型ケース（翻訳・Wiki 等）は本文をそのまま使う
 * - 複数ターンは "User:" / "Assistant:" ラベル付きトランスクリプトにする
 * - 画像などテキスト以外のパートは落とし、warning として報告する
 */
export function flattenPromptForCopilot(prompt: LanguageModelV3Prompt): {
  system: string | undefined;
  promptText: string;
  warnings: SharedV3Warning[];
} {
  const warnings: SharedV3Warning[] = [];
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];

  const textOf = (
    content: ReadonlyArray<{ type: string }>,
    role: string,
  ): string => {
    const texts: string[] = [];
    for (const part of content) {
      if (part.type === "text") {
        texts.push((part as { type: "text"; text: string }).text);
      } else if (part.type === "tool-call" || part.type === "tool-result") {
        // text-tool-call フォールバック経由ではツールは本文テキストに埋め込まれて
        // 届くため、通常ここには来ない。来た場合も文脈を失わないよう JSON で残す。
        texts.push(JSON.stringify(part));
      } else {
        warnings.push({
          type: "other",
          message: `copilot-subscription does not support ${part.type} parts in ${role} messages; the part was dropped`,
        });
      }
    }
    return texts.join("\n");
  };

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systemParts.push(message.content);
        break;
      case "user":
        turns.push({ role: "user", text: textOf(message.content, "user") });
        break;
      case "assistant":
        turns.push({
          role: "assistant",
          text: textOf(message.content, "assistant"),
        });
        break;
      case "tool":
        // tool ロールも同様に通常は来ない。トランスクリプト上は user 側の情報として扱う。
        turns.push({ role: "user", text: textOf(message.content, "tool") });
        break;
    }
  }

  const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

  // 単一 user ターンはラベルを付けずそのまま送る（余計な "User:" 接頭辞で
  // 翻訳対象文などが汚れるのを防ぐ）。
  const promptText =
    turns.length === 1 && turns[0].role === "user"
      ? turns[0].text
      : turns
          .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
          .join("\n\n");

  return { system, promptText, warnings };
}

// ── CopilotClient のキャッシュ ──
// spawn した CLI server プロセスは cliPath ごとに 1 つを使い回す。
// 接続死活は毎呼び出しの createSession 失敗で検知し、失敗時はキャッシュを捨てて
// 次回呼び出しで再 spawn させる（自動リトライはしない — エラーは利用者に見せる）。
const clientCache = new Map<string, CopilotClient>();

/**
 * copilot CLI の子プロセスに渡す env を組み立てる。
 *
 * 1. copilot CLI は `#!/usr/bin/env node` で起動するスクリプトのため、spawn 時の
 *    PATH 上に node が無いと `env: node: No such file or directory`（exit 127）で
 *    落ちる。このサーバー自身は既に正しい node（process.execPath）で動いているので、
 *    そのディレクトリを PATH に足すだけで確実に解決できる（nvm バージョン走査より
 *    「今動いているのと同じ node」を使う方が確実）。
 * 2. copilot CLI は `useLoggedInUser: true` の認証解決で内部的に `gh` をサブプロセス
 *    として呼ぶ。`gh` が PATH に無いと CLI 自体は起動できても認証情報が取れず
 *    "Not authenticated" になる（1 だけ直しても再現する別の不具合として発覚）。
 *
 * Tauri パッケージ版はサイドカーが最小化された PATH で起動されており（GUI 起動は
 * ログインシェルの rc を経由しないため nvm/homebrew が PATH に無い）、
 * RuntimeConnection.forStdio に env を省略すると process.env がそのまま子プロセス
 * に継承されてどちらも再現する。
 */
function buildCopilotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const extraDirs = [dirname(process.execPath)];
  const ghPath = resolveGhBinaryPath();
  if (ghPath) extraDirs.push(dirname(ghPath));
  const prefix = extraDirs.join(":");
  env.PATH = env.PATH ? `${prefix}:${env.PATH}` : prefix;
  return env;
}

async function getClient(cliPath: string): Promise<CopilotClient> {
  const cached = clientCache.get(cliPath);
  if (cached) return cached;
  const { CopilotClient, RuntimeConnection } = await import(
    "@github/copilot-sdk"
  );
  const client = new CopilotClient({
    connection: RuntimeConnection.forStdio({
      path: cliPath,
      env: buildCopilotEnv(),
    }),
    // CLI にログイン済みのユーザー（サブスク認証）をそのまま使う
    useLoggedInUser: true,
    logLevel: "none",
  });
  clientCache.set(cliPath, client);
  return client;
}

function dropClient(cliPath: string): void {
  const client = clientCache.get(cliPath);
  clientCache.delete(cliPath);
  if (client) {
    void client.forceStop().catch(() => {});
  }
}

/** テスト用: キャッシュ済みクライアントを全て破棄する */
export async function resetCopilotClients(): Promise<void> {
  for (const [path] of clientCache) {
    dropClient(path);
  }
}

/**
 * 認証系のエラーを CodedError（COPILOT_SUBSCRIPTION_AUTH_EXPIRED）へ正規化する。
 * それ以外はメッセージを整えた Error として返す。
 */
function normalizeCopilotError(err: unknown): Error {
  if (err instanceof CodedError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (
    /\b401\b|unauthorized|not (signed|logged) in|authentication|sign in|log ?in required/i.test(
      message,
    )
  ) {
    return new CodedError(
      "GitHub Copilot authentication is missing or expired. Run `copilot` in a terminal to sign in, then retry.",
      "COPILOT_SUBSCRIPTION_AUTH_EXPIRED",
    );
  }
  if (/ENOENT/.test(message)) {
    return new Error(
      `GitHub Copilot CLI could not be launched (${message}). Check the CLI path in Settings → AI, or install it with \`npm install -g @github/copilot\`.`,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/** session.error イベントを Error へ変換する（errorType: authentication は認証導線へ） */
function errorFromSessionEvent(data: {
  errorType: string;
  message: string;
  statusCode?: number;
}): Error {
  if (data.errorType === "authentication" || data.statusCode === 401) {
    return new CodedError(
      "GitHub Copilot authentication is missing or expired. Run `copilot` in a terminal to sign in, then retry.",
      "COPILOT_SUBSCRIPTION_AUTH_EXPIRED",
    );
  }
  return new Error(`Copilot: ${data.message}`);
}

// イベント無音のまま放置されたときのハング防止（宙吊り await 対策）。
// 長い Wiki 生成でも 1 イベント間隔がこの時間を超えることは想定しない。
const INACTIVITY_TIMEOUT_MS = (() => {
  const fromEnv = Number(process.env.GRAPHIUM_COPILOT_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 300_000;
})();

type TurnCallbacks = {
  onDelta: (text: string) => void;
  onFinal: (text: string) => void;
  onUsage: (usage: LanguageModelV3Usage, finishReason: string | undefined) => void;
};

/**
 * 1 ターン分のプロンプトを送信し、完了まで待つ。
 * イベント購読とタイムアウト・abort の後始末をここに集約する。
 *
 * 完了の判定は `waitForIdle` で変わる:
 * - false（既定・ツールなし）: 最初の assistant.turn_end で完了。1 往復なのでこれで足りる。
 * - true（ツールあり）: session.idle まで待つ。ツールを呼ぶターンは
 *   「空の assistant.message → tool 実行 → turn_end」で一度区切られ、その後に
 *   最終回答のターンが続く（実測: turn_end が 2 回来て最後に idle）。
 *   最初の turn_end で止めると最終回答を取りこぼす。
 */
async function runTurn(
  session: CopilotSession,
  promptText: string,
  abortSignal: AbortSignal | undefined,
  callbacks: TurnCallbacks,
  waitForIdle = false,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      unsubscribe();
      if (err) reject(err);
      else resolve();
    };

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        settle(
          new Error(
            `Copilot CLI did not respond within ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s`,
          ),
        );
      }, INACTIVITY_TIMEOUT_MS);
    };

    const onAbort = () => {
      void session.abort().catch(() => {});
      const reason = abortSignal?.reason;
      settle(
        reason instanceof Error ? reason : new Error("Request was aborted"),
      );
    };

    const unsubscribe = session.on((event: SessionEvent) => {
      // サブエージェント由来のイベントは対象外（availableTools: [] なので通常発生しない）
      if ("agentId" in event && event.agentId) return;
      resetTimer();
      switch (event.type) {
        case "assistant.message_delta":
          callbacks.onDelta(event.data.deltaContent);
          break;
        case "assistant.message":
          // ツール実行を挟むと途中の空メッセージも来る。空は最終回答を上書きしない。
          if (event.data.content || !waitForIdle) callbacks.onFinal(event.data.content);
          break;
        case "assistant.usage":
          callbacks.onUsage(mapCopilotUsage(event.data), event.data.finishReason);
          break;
        case "session.error":
          settle(errorFromSessionEvent(event.data));
          break;
        case "assistant.turn_end":
          if (!waitForIdle) settle();
          break;
        case "session.idle":
          settle();
          break;
        default:
          break;
      }
    });

    resetTimer();
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    session.send({ prompt: promptText }).catch((err: unknown) => {
      settle(normalizeCopilotError(err));
    });
  });
}

type PreparedCall = {
  client: CopilotClient;
  session: CopilotSession;
  promptText: string;
  warnings: SharedV3Warning[];
};

async function prepareCall(
  settings: CopilotModelSettings,
  options: LanguageModelV3CallOptions,
): Promise<PreparedCall> {
  const { system, promptText, warnings } = flattenPromptForCopilot(
    options.prompt,
  );

  // サンプリング系パラメータは CLI 側が管理しており指定できない。
  // agent-loop が subscription プロバイダには temperature を渡さない規約だが、
  // 直接呼ばれた場合にも黙って無視せず warning として可視化する。
  for (const key of ["temperature", "topP", "topK"] as const) {
    if (options[key] !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: key,
        details: `copilot-subscription ignores ${key} (controlled by the Copilot CLI)`,
      });
    }
  }
  if (options.tools && options.tools.length > 0) {
    // LanguageModelV3 経路（generateText 経由）では AI SDK が execute を剥がして
    // 渡してくるため、ここではツールを実行できない。ツール付きの呼び出しは
    // agent-loop が runCopilotWithTools（下）へ振り分けるので、通常ここには来ない。
    warnings.push({
      type: "unsupported",
      feature: "tools",
      details:
        "copilot-subscription runs tools through runCopilotWithTools, not through the LanguageModel interface",
    });
  }

  const client = await getClient(settings.cliPath);
  let session: CopilotSession;
  try {
    session = await client.createSession({
      model: resolveCopilotModelId(settings.modelId),
      clientName: "graphium",
      availableTools: [],
      ...(system !== undefined
        ? { systemMessage: { mode: "replace" as const, content: system } }
        : {}),
    });
  } catch (err) {
    // CLI プロセス死亡・起動失敗の可能性があるためキャッシュを無効化し、
    // 次回呼び出しで再 spawn できるようにする。
    dropClient(settings.cliPath);
    throw normalizeCopilotError(err);
  }
  return { client, session, promptText, warnings };
}

async function disposeSession(
  client: CopilotClient,
  session: CopilotSession,
): Promise<void> {
  // セッションは ~/.copilot 配下に状態が残るため、使い捨てた分は削除しておく
  await client.deleteSession(session.sessionId).catch(() => {});
}

// ── ツール付き実行（Copilot をエージェントとして扱う経路） ──
//
// AI SDK の LanguageModelV3 経路（generateText → doGenerate）では、AI SDK がツールの
// `execute` を剥がして {name, description, inputSchema} だけをプロバイダに渡す。
// プロバイダの立場では実行関数が手に入らないので、Copilot SDK の handler に何も
// 入れられない。一方 Copilot SDK は「handler 付きでツールを渡せば、モデルが呼んだ
// ときに SDK が handler を実行して結果をモデルへ返す」までを CLI 側で一気に回す。
//
// そこで generateText を経由せず、agent-loop から直接この関数を呼ぶ。runAgentLoop は
// execute 付きの tools を持っているので、それを Copilot SDK の Tool（handler 付き）に
// 包んで渡し、handler の中で AI SDK の execute を呼ぶ。ツール呼び出しの記録は
// handler 内で自分で取る（引数・結果・所要時間を確実に握れる）。
//
// 実測（2026-08-18、CLI 1.0.80 / SDK 1.0.9）: skipPermission: true が無いと
// "Permission denied and could not request permission from user" で止まる。
// Graphium のツールは MCP 経由でユーザーが有効化したものなので、追加の許可 UI は
// 出さずに実行してよい。

/** AI SDK の tool 定義（execute 付き）の最小形。agent-loop から渡ってくる形と揃える */
export type ExecutableTool = {
  description?: string;
  inputSchema: unknown;
  execute?: (input: unknown, options: unknown) => Promise<unknown> | unknown;
};

export type CopilotToolCallRecord = {
  tool_name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
};

export type RunCopilotWithToolsParams = {
  settings: CopilotModelSettings;
  systemPrompt: string;
  /** AI SDK の ModelMessage 配列（flattenPromptForCopilot でテキストに平坦化する） */
  prompt: LanguageModelV3Prompt;
  tools: Record<string, ExecutableTool>;
  abortSignal?: AbortSignal;
};

export type RunCopilotWithToolsResult = {
  text: string;
  toolCalls: CopilotToolCallRecord[];
  usage: LanguageModelV3Usage;
  finishReason: LanguageModelV3FinishReason;
  warnings: SharedV3Warning[];
};

/** AI SDK の inputSchema（Zod / jsonSchema() ラッパー / 生 JSON Schema）を JSON Schema オブジェクトへ */
async function toJsonSchema(inputSchema: unknown): Promise<Record<string, unknown>> {
  try {
    const { asSchema } = await import("ai");
    const schema = asSchema(inputSchema as never);
    const resolved = await Promise.resolve(schema.jsonSchema);
    if (resolved && typeof resolved === "object") return resolved as Record<string, unknown>;
  } catch {
    // 下のフォールバックへ
  }
  return { type: "object", properties: {} };
}

/** ツール実行結果を記録用のオブジェクトに正規化する（web-sources 等が output を読む） */
function normalizeToolOutput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (raw == null) return {};
  return { result: raw };
}

/**
 * Copilot にツールを渡して 1 ターン実行し、最終テキストとツール呼び出しの記録を返す。
 * ツールの実行ループは Copilot CLI 側が回す（モデル → handler → モデル …）。
 */
export async function runCopilotWithTools(
  params: RunCopilotWithToolsParams,
): Promise<RunCopilotWithToolsResult> {
  const { settings, systemPrompt, prompt, tools, abortSignal } = params;
  const { system: systemFromPrompt, promptText, warnings } = flattenPromptForCopilot(prompt);
  // agent-loop は system を別引数で持つ。prompt 側にも system が入っていれば結合する。
  const system = [systemPrompt, systemFromPrompt].filter((s) => s && s.trim()).join("\n\n");

  const { defineTool } = await import("@github/copilot-sdk");
  const toolCalls: CopilotToolCallRecord[] = [];
  const sdkTools = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) =>
      defineTool(name, {
        description: tool.description,
        parameters: await toJsonSchema(tool.inputSchema),
        // Graphium のツールはユーザーが設定で有効化した MCP。追加の許可プロンプトは出さない。
        skipPermission: true,
        handler: async (args: unknown) => {
          const startedAt = Date.now();
          const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
          if (!tool.execute) {
            const output = { error: `tool "${name}" has no execute` };
            toolCalls.push({ tool_name: name, input, output, duration_ms: 0 });
            return output;
          }
          try {
            const raw = await tool.execute(input, { toolCallId: `${name}:${toolCalls.length}`, messages: [] });
            const output = normalizeToolOutput(raw);
            toolCalls.push({ tool_name: name, input, output, duration_ms: Date.now() - startedAt });
            return raw ?? output;
          } catch (err) {
            // ツール側の失敗はモデルに見せて続行させる（text-tools ループと同じ扱い）。
            const message = err instanceof Error ? err.message : String(err);
            const output = { error: message };
            toolCalls.push({ tool_name: name, input, output, duration_ms: Date.now() - startedAt });
            return output;
          }
        },
      }),
    ),
  );

  const client = await getClient(settings.cliPath);
  let session: CopilotSession;
  try {
    session = await client.createSession({
      model: resolveCopilotModelId(settings.modelId),
      clientName: "graphium",
      tools: sdkTools,
      // 渡した Graphium ツールだけを見せる。Copilot 内蔵ツール（シェル・ファイル編集）は出さない。
      availableTools: Object.keys(tools),
      ...(system ? { systemMessage: { mode: "replace" as const, content: system } } : {}),
    });
  } catch (err) {
    dropClient(settings.cliPath);
    throw normalizeCopilotError(err);
  }

  let deltaText = "";
  let finalText: string | undefined;
  let usage = mapCopilotUsage(undefined);
  let finishReason = mapCopilotFinishReason(undefined);
  try {
    await runTurn(session, promptText, abortSignal, {
      onDelta: (t) => {
        deltaText += t;
      },
      onFinal: (t) => {
        // ツール呼び出しを挟むと assistant.message が複数回来る（途中の「〜を調べます」と
        // 最終回答）。最後に来たものが最終回答。
        finalText = t;
      },
      onUsage: (u, reason) => {
        usage = u;
        finishReason = mapCopilotFinishReason(reason);
      },
    }, /* waitForIdle */ true);
  } catch (err) {
    throw normalizeCopilotError(err);
  } finally {
    await disposeSession(client, session);
  }

  return {
    text: finalText ?? deltaText,
    toolCalls,
    usage,
    finishReason,
    warnings,
  };
}

class CopilotSubscriptionLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "copilot-subscription";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly settings: CopilotModelSettings;

  constructor(settings: CopilotModelSettings) {
    this.settings = settings;
    this.modelId = settings.modelId?.trim() || "default";
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { client, session, promptText, warnings } = await prepareCall(
      this.settings,
      options,
    );
    let deltaText = "";
    let finalText: string | undefined;
    let usage = mapCopilotUsage(undefined);
    let finishReason = mapCopilotFinishReason(undefined);
    try {
      await runTurn(session, promptText, options.abortSignal, {
        onDelta: (t) => {
          deltaText += t;
        },
        onFinal: (t) => {
          finalText = t;
        },
        onUsage: (u, reason) => {
          usage = u;
          finishReason = mapCopilotFinishReason(reason);
        },
      });
    } catch (err) {
      throw normalizeCopilotError(err);
    } finally {
      await disposeSession(client, session);
    }
    // 最終メッセージイベントが完全形。delta しか来なかった場合はその累積を使う。
    const text = finalText ?? deltaText;
    return {
      content: [{ type: "text", text }],
      finishReason,
      usage,
      warnings,
      response: { modelId: this.modelId },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { client, session, promptText, warnings } = await prepareCall(
      this.settings,
      options,
    );
    const settings = this.settings;
    void settings;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings });
        const textId = "0";
        let textStarted = false;
        let sawDelta = false;
        let usage = mapCopilotUsage(undefined);
        let finishReason = mapCopilotFinishReason(undefined);
        try {
          await runTurn(session, promptText, options.abortSignal, {
            onDelta: (t) => {
              if (!textStarted) {
                controller.enqueue({ type: "text-start", id: textId });
                textStarted = true;
              }
              sawDelta = true;
              controller.enqueue({ type: "text-delta", id: textId, delta: t });
            },
            onFinal: (t) => {
              // delta を流していない（非ストリーミング応答）場合のみ全文を 1 delta で流す。
              // delta 済みなら final は同内容の重複なので捨てる。
              if (!sawDelta && t.length > 0) {
                if (!textStarted) {
                  controller.enqueue({ type: "text-start", id: textId });
                  textStarted = true;
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: t,
                });
              }
            },
            onUsage: (u, reason) => {
              usage = u;
              finishReason = mapCopilotFinishReason(reason);
            },
          });
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: textId });
          }
          controller.enqueue({ type: "finish", finishReason, usage });
        } catch (err) {
          controller.enqueue({
            type: "error",
            error: normalizeCopilotError(err),
          });
        } finally {
          await disposeSession(client, session);
          controller.close();
        }
      },
    });

    return { stream };
  }
}

/** copilot-subscription の LanguageModel を生成する（llm.ts の createModel から呼ぶ） */
export function createCopilotModel(
  settings: CopilotModelSettings,
): LanguageModelV3 {
  return new CopilotSubscriptionLanguageModel(settings);
}

/**
 * Copilot で利用可能なモデル一覧を返す（設定 UI の「モデル一覧を取得」用）。
 * 先頭に "default"（CLI 既定モデル）を置き、以降は SDK から取得した実 ID を並べる。
 */
export async function listCopilotModels(cliPath: string): Promise<string[]> {
  const client = await getClient(cliPath);
  try {
    // createSession と違い listModels は自動接続しないため明示的に接続する
    //（start は接続済みなら即 return する冪等実装）。
    await client.start();
    const models = await client.listModels();
    return ["default", ...models.map((m) => m.id)];
  } catch (err) {
    dropClient(cliPath);
    throw normalizeCopilotError(err);
  }
}
