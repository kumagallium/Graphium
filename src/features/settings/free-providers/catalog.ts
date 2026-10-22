// 無料で始められる AI 接続先の一覧（事実だけを持つ。表示は FreeProviderCardView）
//
// 方針:
// - 各社を同じ物差し（Graphium で回せる量・学習への利用・登録に要るもの）で並べる。
//   おすすめ・初期選択・並びによる優先はしない（並びは名前の順）
// - 数字はマニュアル「AI の使用量と無料枠の目安」（manual/ja/ai-usage-limits.md）と同じもの。
//   ここを変えたらマニュアルの表も同じ PR で直す
// - Copilot はワンクリック接続（CopilotOneClick）で別に出すので、ここには入れない

/** 無料枠の入力・出力が AI の学習に使われるか */
export type TrainingPolicy =
  /** 使わない（規約・約款に明記） */
  | "no"
  /** 既定で使う（設定で止められる場合を含む） */
  | "yes"
  /** モデルの提供元ごとに違う */
  | "depends";

export type FreeProvider = {
  id: string;
  /** 固有名詞なので訳さない */
  name: string;
  /** OpenAI 互換のベース URL。{accountId} は利用者が入れる */
  apiBase: string;
  /** 無料枠で使うモデル ID（接続フォームの初期値） */
  model: string;
  training: TrainingPolicy;
  /** API キーを発行するページ */
  signupUrl: string;
  /** 文言キーの接頭辞（.amount / .training / .signup） */
  i18nKey: string;
  /** 数字を確認した日 */
  checkedAt: string;
};

const PROVIDERS: FreeProvider[] = [
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    apiBase: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
    model: "@cf/openai/gpt-oss-120b",
    training: "no",
    signupUrl: "https://dash.cloudflare.com/profile/api-tokens",
    i18nKey: "settings.freeProviders.cloudflare",
    checkedAt: "2026-10-22",
  },
  {
    id: "google-gemini",
    name: "Google Gemini API",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "",
    training: "yes",
    signupUrl: "https://aistudio.google.com/apikey",
    i18nKey: "settings.freeProviders.gemini",
    checkedAt: "2026-10-22",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    apiBase: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    training: "yes",
    signupUrl: "https://console.mistral.ai/api-keys",
    i18nKey: "settings.freeProviders.mistral",
    checkedAt: "2026-10-22",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1",
    model: "openai/gpt-oss-120b:free",
    training: "depends",
    signupUrl: "https://openrouter.ai/settings/keys",
    i18nKey: "settings.freeProviders.openrouter",
    checkedAt: "2026-10-22",
  },
  {
    id: "sakura-ai-engine",
    name: "さくらのAI Engine",
    apiBase: "https://api.ai.sakura.ad.jp/v1",
    model: "gpt-oss-120b",
    training: "no",
    signupUrl: "https://ai.sakura.ad.jp/sakura-ai/ai-engine/",
    i18nKey: "settings.freeProviders.sakura",
    checkedAt: "2026-10-22",
  },
];

/** 名前の順（言語に依らず同じ並び）。手で並べ替えて優先を作らないよう、並びはここで決める */
export const FREE_PROVIDERS: readonly FreeProvider[] = [...PROVIDERS].sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);
