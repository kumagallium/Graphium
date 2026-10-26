// 無料枠のある AI 接続先の一覧（事実だけを持つ。表示は FreeProviderCardView）
//
// 方針:
// - 各社を同じ物差し（Graphium で回せる量・学習への利用・登録に要るもの）で並べる。
//   おすすめ・初期選択・並びによる優先はしない（並びは英語名の順で、言語に依らずここで決める）
// - データの置き場は providers.json の 1 か所だけ。月 1 回の点検
//   （scripts/check-free-providers.mjs）も同じファイルを読む。数字はマニュアル
//   「AI の使用量と無料枠の目安」（manual/ja/ai-usage-limits.md）と同じにする
// - 古くなっても壊れ方を穏やかにする: モデル ID は初期値として使うだけで、接続先の
//   一覧に無ければふだん使いの系統か一覧の先頭に戻す（pickConnectModel）。確認日から時間が経ったら画面で知らせる
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
  /** Graphium のプロバイダー ID（省略時は openai-compatible） */
  provider?: string;
  /** false なら無料枠が無い（使った分だけ請求）。省略時は無料枠あり */
  freeTier?: boolean;
  /** ベース URL。{accountId} は利用者が入れる。openai-compatible 以外は点検用で、登録には使わない */
  apiBase: string;
  /** 最初に選んでおくモデル ID（一覧に無ければ preferModel、それも無ければ一覧の先頭） */
  model: string;
  /** ふだん使いの系統（正規表現）。合うもののうち名前の新しいものを選ぶ */
  preferModel?: string;
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

/** API キーでつなぐクラウドの接続先すべて（英語名の順） */
export const CLOUD_PROVIDERS: readonly FreeProvider[] = [...(data.providers as FreeProvider[])].sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

/** そのうち無料枠のあるもの */
export const FREE_PROVIDERS: readonly FreeProvider[] = CLOUD_PROVIDERS.filter((p) => p.freeTier !== false);

export function hasFreeTier(provider: FreeProvider): boolean {
  return provider.freeTier !== false;
}

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

/** チャットに使えないモデル（埋め込み・音声・画像・検閲など）。名前で見分ける */
const NON_CHAT_MODEL = /(embed|whisper|tts|transcri|speech|audio|realtime|dall-e|image|imagen|moderation|rerank|search|computer-use|babbage|davinci|guard)/i;

/**
 * つないだ直後に選んでおくモデル。モデル ID は決め打ちしない（廃止・改名で壊れるため）:
 * 1. チャットに使えないモデルを除く（全部除かれたら元の一覧のまま）
 * 2. preferred が一覧にあればそれ
 * 3. preferPattern（ふだん使いの系統）に合うもののうち、名前の新しいもの（数字を数として比べた降順）
 * 4. それも無ければ一覧の先頭
 */
export function pickConnectModel(
  available: readonly string[],
  { preferred, preferPattern }: { preferred?: string; preferPattern?: string } = {},
): string {
  const chat = available.filter((m) => !NON_CHAT_MODEL.test(m));
  const pool = chat.length > 0 ? chat : [...available];
  if (preferred && pool.includes(preferred)) return preferred;
  if (preferPattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(preferPattern, "i");
    } catch {
      re = null;
    }
    const matches = re ? pool.filter((m) => re!.test(m)) : [];
    if (matches.length > 0) {
      return [...matches].sort((a, b) => b.localeCompare(a, "en", { numeric: true }))[0];
    }
  }
  return pool[0] ?? "";
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
