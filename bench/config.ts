// Phase μ-1: bench 用のモデル設定
//
// production の default LLM は gpt-oss-120b (Sakura AI Engine)。
// benchmark も production と同じモデルで回すことで、数値 = ユーザー体験予測の崩れを防ぐ。
// 環境変数で上書き可能。API キー未設定なら自動的に dry-run に落ちる。

export type BenchModelConfig = {
  provider: "openai-compatible" | "openai" | "anthropic" | "google";
  name: string;
  modelId: string;
  apiBase: string | null;
  apiKey: string;
};

// production default: Sakura AI Engine の gpt-oss-120b
// https://platform.sakura.ad.jp/ai-engine
const SAKURA_AI_BASE = "https://api.ai.sakura.ad.jp/v1";

export function getBenchModelConfig(): BenchModelConfig {
  const provider = (process.env.BENCH_PROVIDER ?? "openai-compatible") as BenchModelConfig["provider"];
  const modelId = process.env.BENCH_MODEL_ID ?? "gpt-oss-120b";
  const apiBase = process.env.BENCH_API_BASE ?? SAKURA_AI_BASE;
  const apiKey = process.env.BENCH_API_KEY ?? process.env.SAKURA_AI_API_KEY ?? "";
  const name = process.env.BENCH_MODEL_NAME ?? "gpt-oss-120b (Sakura AI)";

  return { provider, name, modelId, apiBase, apiKey };
}

// LLM-as-judge 用のモデル設定。コスト抑制のため separate にする。
// デフォルトは production と同じモデル（gpt-oss-120b で兼用）。
// Phase μ-3 で Haiku 等の安価モデルに差し替えを検討。
export function getBenchJudgeConfig(): BenchModelConfig {
  const baseConfig = getBenchModelConfig();
  return {
    provider: (process.env.BENCH_JUDGE_PROVIDER ?? baseConfig.provider) as BenchModelConfig["provider"],
    name: process.env.BENCH_JUDGE_MODEL_NAME ?? baseConfig.name,
    modelId: process.env.BENCH_JUDGE_MODEL_ID ?? baseConfig.modelId,
    apiBase: process.env.BENCH_JUDGE_API_BASE ?? baseConfig.apiBase,
    apiKey: process.env.BENCH_JUDGE_API_KEY ?? baseConfig.apiKey,
  };
}

export function hasLiveApiKey(): boolean {
  const cfg = getBenchModelConfig();
  return cfg.apiKey.trim().length > 0;
}

export function resolveMode(): "live" | "dry-run" {
  const explicit = (process.env.BENCH_MODE ?? "").toLowerCase();
  if (explicit === "live") return "live";
  if (explicit === "dry-run" || explicit === "dry") return "dry-run";
  return hasLiveApiKey() ? "live" : "dry-run";
}
