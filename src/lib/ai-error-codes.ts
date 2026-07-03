// AI 関連エラーの機械可読コード（サーバー・クライアント共有 / 依存なし）
//
// サーバーは AI セットアップ・認証系のエラーレスポンスに `code` フィールドを付け、
// クライアントは code → i18n 文言に変換して表示する（src/lib/ai-error.ts の localizeAiError）。
// `error`（英語メッセージ文字列）は従来どおり保持するので、旧クライアント・旧サーバーが
// 混在してもレスポンス形状は壊れない（code が無ければメッセージをそのまま出すだけ）。

export const AI_ERROR_CODES = {
  /** モデルが 1 件も登録されていない（400） */
  NO_MODEL_REGISTERED: "NO_MODEL_REGISTERED",
  /** claude-subscription（Claude Code CLI 経由）の OAuth セッション切れ（401） */
  SUBSCRIPTION_AUTH_EXPIRED: "SUBSCRIPTION_AUTH_EXPIRED",
  /** API キーが無効か期限切れ（401） */
  INVALID_API_KEY: "INVALID_API_KEY",
  /** API キーに権限が無い（403） */
  API_KEY_FORBIDDEN: "API_KEY_FORBIDDEN",
  /** Embedding が OpenAI / OpenAI 互換以外のプロバイダーで要求された */
  EMBEDDING_MODEL_UNSUPPORTED: "EMBEDDING_MODEL_UNSUPPORTED",
} as const;

export type AiErrorCode = keyof typeof AI_ERROR_CODES;

/**
 * code プロパティ付き Error。
 * サーバー内部（agent-loop / llm / embedding）で throw し、各ルートの catch が
 * errorBody() 経由で JSON レスポンスの `code` フィールドへ通す。
 */
export class CodedError extends Error {
  readonly code: AiErrorCode;
  constructor(message: string, code: AiErrorCode) {
    super(message);
    this.name = "CodedError";
    this.code = code;
  }
}

/** err から既知の AI エラーコードを取り出す（未知の code / code 無しは undefined） */
export function aiErrorCodeOf(err: unknown): AiErrorCode | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in AI_ERROR_CODES
    ? (code as AiErrorCode)
    : undefined;
}

/** モデル未登録（400）用の共通レスポンスボディ */
export function noModelRegisteredBody(): { error: string; code: AiErrorCode } {
  return {
    error: "No AI model is registered. Add a model in Settings → AI Setup.",
    code: "NO_MODEL_REGISTERED",
  };
}

/**
 * catch した err を `{ error, code? }` ボディへ変換する。
 * code は既知のもの（AI_ERROR_CODES）だけ通し、未知の値は落とす。
 */
export function errorBody(
  err: unknown,
  fallback = "Unknown error",
): { error: string; code?: AiErrorCode } {
  const message =
    err instanceof Error && err.message
      ? err.message
      : typeof err === "string" && err
        ? err
        : fallback;
  const code = aiErrorCodeOf(err);
  return { error: message, ...(code ? { code } : {}) };
}
