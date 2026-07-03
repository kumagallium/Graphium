// AI 系エラーのクライアント側共通処理（サーバー側は src/lib/ai-error-codes.ts を直接使う）
//
// - aiErrorFromResponse: fetch 失敗レスポンスの { error, code } を code 付き Error に変換
// - localizeAiError:     code → i18n 文言（code 無し / 未知はサーバーメッセージそのまま）
// - ensureAgentConfigured: AI 発火経路の共通ガード（未設定ならトースト + 設定 AI タブ導線）
//
// ⚠️ このモジュールは i18n / settings store を import するためクライアント専用。
//    サーバーコードからは import しないこと。

import { t as tStatic } from "../i18n";
import { isAgentConfigured } from "../features/settings/store";
import { aiErrorCodeOf, type AiErrorCode } from "./ai-error-codes";

/**
 * fetch の失敗レスポンス（JSON: { error, code? }）から code 付き Error を作る。
 * throw は呼び出し側で行う: `if (!res.ok) throw await aiErrorFromResponse(res, "...")`
 * 未知の code もそのまま Error に載せる（新サーバー + 旧クライアント定義でも情報を落とさない）。
 */
export async function aiErrorFromResponse(
  res: Response,
  fallback: string,
): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  const err = new Error(
    typeof data.error === "string" && data.error ? data.error : fallback,
  );
  if (typeof data.code === "string") {
    (err as Error & { code?: string }).code = data.code;
  }
  return err;
}

// エラーコード → i18n キー。新しいコードを足したら en.ts / ja.ts に対応キーを追加する。
const CODE_TO_I18N_KEY: Record<AiErrorCode, string> = {
  NO_MODEL_REGISTERED: "aiError.noModelRegistered",
  SUBSCRIPTION_AUTH_EXPIRED: "aiError.subscriptionAuthExpired",
  INVALID_API_KEY: "aiError.invalidApiKey",
  API_KEY_FORBIDDEN: "aiError.apiKeyForbidden",
  EMBEDDING_MODEL_UNSUPPORTED: "aiError.embeddingModelUnsupported",
};

/**
 * AI 系エラーを表示用文字列へ変換する。
 * 既知の code は i18n 文言、code 無し / 未知はメッセージをそのまま返す
 * （旧サーバー混在時のグレースフルデグラデーション）。
 */
export function localizeAiError(err: unknown): string {
  const code = aiErrorCodeOf(err);
  if (code) return tStatic(CODE_TO_I18N_KEY[code]);
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return tStatic("aiChat.runFailed");
}

/** AI 未設定ガード発火の通知イベント。note-app がトースト表示のために listen する */
export const AI_NOT_CONFIGURED_EVENT = "graphium-ai-not-configured";

/**
 * AI 発火経路の共通ガード。モデル未登録ならリクエストを発火させず、
 * トースト通知（AI_NOT_CONFIGURED_EVENT → note-app）と設定画面 AI タブへの導線
 * （graphium-open-settings、chat panel.tsx と同じ dispatch 形状）を出して false を返す。
 * 使い方: `if (!ensureAgentConfigured()) return;`
 */
export function ensureAgentConfigured(): boolean {
  if (isAgentConfigured()) return true;
  window.dispatchEvent(new CustomEvent(AI_NOT_CONFIGURED_EVENT));
  window.dispatchEvent(
    new CustomEvent("graphium-open-settings", { detail: { tab: "ai" } }),
  );
  return false;
}
