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
//   - copilot-subscription だけは web 検索を内蔵する（hasBuiltinWebSearch）

//
// chatgpt-plan（Sign in with ChatGPT）は CLI を使わず、OpenAI の公開 Responses API を
// 利用者の OAuth トークンで呼ぶ。API キー無し・温度指定なし・従量課金なしは同じだが、
// ツールは AI SDK の LanguageModel 経路でそのまま実行できる（runsToolsThroughLanguageModel）。

export const SUBSCRIPTION_PROVIDERS = [
  "copilot-subscription",
  "chatgpt-plan",
] as const;

/**
 * サブスク型のうち、AI SDK の LanguageModel 経路（generateText）でツールを実行できるもの。
 * agent-loop はこれが true のプロバイダを text-tool-call フォールバックへ回さない。
 */
export function runsToolsThroughLanguageModel(provider: string | null | undefined): boolean {
  return provider === "chatgpt-plan";
}

export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

export function isSubscriptionProvider(
  provider: string | null | undefined,
): provider is SubscriptionProvider {
  return (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(provider ?? "");
}

/** プロバイダ内蔵の web 検索ツール名（Copilot CLI の built-in GitHub MCP が公開する `web_search`） */
export const BUILTIN_WEB_SEARCH_TOOL = "web_search";

/**
 * プロバイダ自身が web 検索ツールを内蔵しているか。
 * copilot-subscription は Copilot CLI の内蔵 `web_search`（Bing）を持ち、検索 MCP を
 * 繋がなくてもチャットの外部参照で Web を引ける。サーバー（agent.ts が内蔵ツールを
 * 見せる判断）とクライアント（外部参照の「検索手段なし」警告）が同じ判定を使う。
 */
export function hasBuiltinWebSearch(provider: string | null | undefined): boolean {
  return provider === "copilot-subscription";
}
