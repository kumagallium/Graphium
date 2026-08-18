// サブスクリプション型プロバイダの共通判定（サーバー・クライアント共有 / 依存なし）
//
// 「サブスクリプション型」= 認証をローカル CLI のログインに委譲するプロバイダ。
// 共通する性質:
//   - API キーを持たない（空キーが正常状態）
//   - temperature 等のサンプリングパラメータは CLI 側が管理し指定不可
//   - AI SDK の LanguageModel 経路（generateText）ではツールを実行できない。
//     copilot-subscription は agent-loop の専用経路（runCopilotAgentLoop）で SDK に
//     ツールを handler 付きで渡してネイティブに実行する。他のサブスク型を足すときは
//     同じ経路を用意するか、text-tool-call フォールバックに任せる
//   - 従量課金が発生しない（使用量ダッシュボードでコスト計算対象外）

export const SUBSCRIPTION_PROVIDERS = [
  "copilot-subscription",
] as const;

export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

export function isSubscriptionProvider(
  provider: string | null | undefined,
): provider is SubscriptionProvider {
  return (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(provider ?? "");
}
