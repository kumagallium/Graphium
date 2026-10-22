// 無料枠のある AI 接続先の一覧（事実だけを持つ。表示は FreeProviderCardView）
//
// 方針:
// - 各社を同じ物差し（Graphium で回せる量・学習への利用・登録に要るもの）で並べる。
//   おすすめ・初期選択・並びによる優先はしない（並びは英語名の順で、言語に依らずここで決める）
// - データの置き場は providers.json の 1 か所だけ。月 1 回の点検
//   （scripts/check-free-providers.mjs）も同じファイルを読む。数字はマニュアル
//   「AI の使用量と無料枠の目安」（manual/ja/ai-usage-limits.md）と同じにする
// - 古くなっても壊れ方を穏やかにする: モデル ID は初期値として使うだけで、接続先の
//   一覧に無ければ一覧の先頭に戻す（pickInitialModel）。確認日から時間が経ったら画面で知らせる
// - Copilot はワンクリック接続（CopilotOneClick）で別に出すので、ここには入れない

import data from "./providers.json";

/** 無料枠の入力・出力が AI の学習に使われるか */
export type TrainingPolicy =
  /** 使わない（規約・約款に明記） */
  | "no"
  /** 既定で使う（設定で止められる場合を含む） */
  | "yes"
  /** モデルの提供元ごとに違う */
  | "depends";

export type FreeProviderText = { amount: string; training: string; signup: string };

export type FreeProvider = {
  id: string;
  /** 英語名。並びの基準で、英語の画面に出す */
  name: string;
  /** 日本語の画面での名前（英語名と違うときだけ） */
  nameJa?: string;
  /** OpenAI 互換のベース URL。{accountId} は利用者が入れる */
  apiBase: string;
  /** 無料枠で使うモデル ID（初期値。空なら接続先の一覧の先頭） */
  model: string;
  training: TrainingPolicy;
  /** API キーを発行するページ */
  signupUrl: string;
  /** 数字を確認した日（YYYY-MM-DD） */
  checkedAt: string;
  text: { en: FreeProviderText; ja: FreeProviderText };
};

/** ベース URL に利用者が埋める部分（Cloudflare のアカウント ID） */
export const ACCOUNT_ID_PLACEHOLDER = "{accountId}";

/** 確認日からこの日数を過ぎたら、画面で「古い可能性」を出す */
export const STALE_AFTER_DAYS = 180;

export const FREE_PROVIDERS: readonly FreeProvider[] = [...(data.providers as FreeProvider[])].sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

/** 画面に出す名前。日本語の画面では nameJa があればそれ */
export function providerName(provider: FreeProvider, locale: string): string {
  return locale === "ja" && provider.nameJa ? provider.nameJa : provider.name;
}

export function providerText(provider: FreeProvider, locale: string): FreeProviderText {
  return locale === "ja" ? provider.text.ja : provider.text.en;
}

export function needsAccountId(apiBase: string): boolean {
  return apiBase.includes(ACCOUNT_ID_PLACEHOLDER);
}

/** テンプレートの {accountId} を埋める。空のうちは空文字（未入力のまま登録させない） */
export function resolveApiBase(template: string, accountId: string): string {
  if (!needsAccountId(template)) return template;
  const id = accountId.trim();
  return id ? template.replace(ACCOUNT_ID_PLACEHOLDER, encodeURIComponent(id)) : "";
}

/** 接続先から取れたモデル一覧のうち、最初に選んでおくもの。カタログのモデルが一覧に無ければ先頭 */
export function pickInitialModel(available: readonly string[], preferred: string | null | undefined): string {
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? "";
}

/** 一覧のうち一番新しい確認日 */
export function latestCheckedAt(providers: readonly FreeProvider[]): string {
  return providers.reduce((latest, p) => (p.checkedAt > latest ? p.checkedAt : latest), "");
}

/** 確認日から STALE_AFTER_DAYS を過ぎたか（日付が読めないときも古い扱い） */
export function isCatalogStale(checkedAt: string, now: Date, days = STALE_AFTER_DAYS): boolean {
  const checked = Date.parse(`${checkedAt}T00:00:00Z`);
  if (Number.isNaN(checked)) return true;
  return now.getTime() - checked > days * 24 * 60 * 60 * 1000;
}
