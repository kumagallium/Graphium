// 既知 LLM モデルの参考価格表
//
// プロバイダー API (Anthropic /v1/models, OpenAI /v1/models, ...) はモデル一覧を返すが、
// 価格情報は含まない（公式 API として提供されていない）。
// このため Settings → AI のモデル登録時に「自動取得」はできず、人手でレート入力するか、
// 既知モデルなら内蔵テーブルから引いて placeholder / ワンクリック入力で補助する。
//
// 単位: USD / 1M tokens。執筆時点（2026-05）の公開価格を参考に記載。
// 価格は変動するので、表示時には「執筆時点の参考値」であることを明示する。
//
// 追加・更新の方針:
//   - 厳密なバージョン文字列ではなく、ファミリー単位の正規表現でマッチさせる
//     (例: /^claude-sonnet-4/ は claude-sonnet-4-20250514 も将来の dot リリースもカバー)
//   - 同じファミリーで input/output レートが異なる派生がある場合は別行を追加
//   - キャッシュ単価（cacheRead / cacheWrite）は最初は省略して input 同単価扱いにする
//   - 不確実なら登録しない。間違った既定値はユーザーを誤誘導する

export type PricingEntry = {
  /** USD / 1M input tokens */
  input: number;
  /** USD / 1M output tokens（embedding は 0） */
  output: number;
  /** prompt caching の読み出し単価。未設定なら input と同じ扱い */
  cacheRead?: number;
  /** prompt caching の書き込み単価。未設定なら input と同じ扱い */
  cacheWrite?: number;
  /** 内蔵テーブルは USD 固定（プロバイダー公表価格はドル建てが多いため）。
   *  円建てモデル（さくら AI 等）はテーブルに含めず、ユーザーが直接 JPY 値を入力する。
   *  読み出し側は currency が省略されていれば "usd" として扱う。 */
  currency?: "usd";
};

type Rule = {
  /** モデル ID にマッチする正規表現 */
  pattern: RegExp;
  /** プロバイダー識別子の追加フィルタ（任意） */
  provider?: string;
  rate: PricingEntry;
};

// 順序は「より具体的なものを上に」。最初にマッチしたものを採用する。
const RULES: Rule[] = [
  // ── Anthropic ──
  // Opus 4 family
  { pattern: /^claude-opus-4/, provider: "anthropic", rate: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  // Sonnet 4 family
  { pattern: /^claude-sonnet-4/, provider: "anthropic", rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  // Claude 3.7 Sonnet
  { pattern: /^claude-3-7-sonnet/, provider: "anthropic", rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  // Claude 3.5 Sonnet
  { pattern: /^claude-3-5-sonnet/, provider: "anthropic", rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  // Claude 3.5 Haiku
  { pattern: /^claude-3-5-haiku/, provider: "anthropic", rate: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  // Claude 3 Opus
  { pattern: /^claude-3-opus/, provider: "anthropic", rate: { input: 15, output: 75 } },
  // Claude 3 Haiku
  { pattern: /^claude-3-haiku/, provider: "anthropic", rate: { input: 0.25, output: 1.25 } },

  // ── OpenAI ──
  // o1 family
  { pattern: /^o1-mini/, provider: "openai", rate: { input: 3, output: 12 } },
  { pattern: /^o1\b|^o1-/, provider: "openai", rate: { input: 15, output: 60 } },
  // o3 family
  { pattern: /^o3-mini/, provider: "openai", rate: { input: 1.1, output: 4.4 } },
  // GPT-4o family
  { pattern: /^gpt-4o-mini/, provider: "openai", rate: { input: 0.15, output: 0.6 } },
  { pattern: /^gpt-4o/, provider: "openai", rate: { input: 2.5, output: 10 } },
  // GPT-4 turbo / GPT-4
  { pattern: /^gpt-4-turbo/, provider: "openai", rate: { input: 10, output: 30 } },
  { pattern: /^gpt-4/, provider: "openai", rate: { input: 30, output: 60 } },
  // GPT-3.5
  { pattern: /^gpt-3\.5-turbo/, provider: "openai", rate: { input: 0.5, output: 1.5 } },
  // Embedding
  { pattern: /^text-embedding-3-small/, provider: "openai", rate: { input: 0.02, output: 0 } },
  { pattern: /^text-embedding-3-large/, provider: "openai", rate: { input: 0.13, output: 0 } },
  { pattern: /^text-embedding-ada-002/, provider: "openai", rate: { input: 0.1, output: 0 } },

  // ── Google ──
  // Gemini 2.5 Pro
  { pattern: /^gemini-2\.5-pro/, provider: "google", rate: { input: 1.25, output: 10 } },
  // Gemini 2.0 Flash
  { pattern: /^gemini-2\.0-flash/, provider: "google", rate: { input: 0.1, output: 0.4 } },
  // Gemini 1.5 Pro
  { pattern: /^gemini-1\.5-pro/, provider: "google", rate: { input: 1.25, output: 5 } },
  // Gemini 1.5 Flash
  { pattern: /^gemini-1\.5-flash/, provider: "google", rate: { input: 0.075, output: 0.3 } },

  // ── Groq (OpenAI 互換) ──
  { pattern: /^llama-3\.3-70b-versatile/, rate: { input: 0.59, output: 0.79 } },
  { pattern: /^llama-3\.1-8b-instant/, rate: { input: 0.05, output: 0.08 } },
  { pattern: /^llama-3\.1-70b/, rate: { input: 0.59, output: 0.79 } },
  { pattern: /^mixtral-8x7b/, rate: { input: 0.24, output: 0.24 } },

  // ── Local / OSS（参考: 自前ホスト時はゼロ円扱い） ──
  // 一致時に rate {input:0, output:0} を返すと UI 側で「無料」と見せにくいので
  // ここでは登録しない。ユーザー判断で個別に入力してもらう。
];

/**
 * provider / modelId から既知の参考価格を引く。
 * 一致しなければ null を返す（ユーザーに手入力してもらう）。
 */
export function lookupModelPrice(provider: string, modelId: string): PricingEntry | null {
  if (!modelId) return null;
  for (const rule of RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (rule.pattern.test(modelId)) return rule.rate;
  }
  return null;
}
