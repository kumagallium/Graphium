// サブスクリプション型プロバイダの共通判定（サーバー・クライアント共有 / 依存なし）
//
// 「サブスクリプション型」= 認証をローカル CLI のログインに委譲するプロバイダ。
// 共通する性質:
//   - API キーを持たない（空キーが正常状態）
//   - temperature 等のサンプリングパラメータは CLI 側が管理し指定不可
//   - AI SDK ネイティブのツール呼び出し非対応（text-tool-call フォールバックを使う）
//   - 従量課金が発生しない（使用量ダッシュボードでコスト計算対象外）

export const SUBSCRIPTION_PROVIDERS = [
  "claude-subscription",
  "copilot-subscription",
] as const;

export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

export function isSubscriptionProvider(
  provider: string | null | undefined,
): provider is SubscriptionProvider {
  return (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(provider ?? "");
}
