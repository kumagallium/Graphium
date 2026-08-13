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
// - `availableTools: []` で Copilot 内蔵ツール（シェル実行・ファイル編集等）を全て
//   無効化し、純粋なテキスト生成器として使う。Graphium 側のツール実行は
//   text-tool-call フォールバック（agent-loop）が担う。
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
import { CodedError } from "../../lib/ai-error-codes.js";

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

async function getClient(cliPath: string): Promise<CopilotClient> {
  const cached = clientCache.get(cliPath);
  if (cached) return cached;
  const { CopilotClient, RuntimeConnection } = await import(
    "@github/copilot-sdk"
  );
  const client = new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: cliPath }),
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
 * 1 ターン分のプロンプトを送信し、完了（turn_end / idle）まで待つ。
 * イベント購読とタイムアウト・abort の後始末をここに集約する。
 */
async function runTurn(
  session: CopilotSession,
  promptText: string,
  abortSignal: AbortSignal | undefined,
  callbacks: TurnCallbacks,
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
          callbacks.onFinal(event.data.content);
          break;
        case "assistant.usage":
          callbacks.onUsage(mapCopilotUsage(event.data), event.data.finishReason);
          break;
        case "session.error":
          settle(errorFromSessionEvent(event.data));
          break;
        case "assistant.turn_end":
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
    warnings.push({
      type: "unsupported",
      feature: "tools",
      details:
        "copilot-subscription does not expose native tool calling; Graphium uses the text-tool-call fallback instead",
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
