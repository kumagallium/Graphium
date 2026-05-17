// さくら AI engine（OpenAI 互換 API）に prompt を投げて raw response を返すクライアント。
//
// Phase 5a の benchmark 第一実行ランナー。.env から下記を読む:
//   SAKURA_AI_ENDPOINT  ベース URL（例: https://api.ai.sakura.ad.jp/v1）
//   SAKURA_AI_API_KEY   API key
//   SAKURA_AI_MODEL     model id（例: gpt-oss-120b）
//
// API は OpenAI 互換の `POST {endpoint}/chat/completions` を仮定する。
// 互換でない場合は SAKURA_AI_CHAT_PATH（任意）でパス上書き可能。

export type SakuraRunnerOptions = {
  endpoint: string;
  apiKey: string;
  model: string;
  /** chat completion path（デフォルト: /chat/completions） */
  chatPath?: string;
  /** temperature（デフォルト: 0） */
  temperature?: number;
  /** max_tokens（デフォルト: 8192） */
  maxTokens?: number;
  /** 失敗時のリトライ回数（デフォルト: 1） */
  retries?: number;
};

export type SakuraRunnerResult = {
  /** assistant メッセージの content（生 string） */
  message: string;
  /** model 側が返した model 名 */
  model: string;
  /** token usage（API が返した場合のみ） */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** リクエスト所要時間 (ms) */
  durationMs: number;
};

export function readSakuraOptionsFromEnv(): SakuraRunnerOptions | null {
  const endpoint = process.env.SAKURA_AI_ENDPOINT?.trim();
  const apiKey = process.env.SAKURA_AI_API_KEY?.trim();
  const model = process.env.SAKURA_AI_MODEL?.trim();
  if (!endpoint || !apiKey || !model) return null;
  return {
    endpoint,
    apiKey,
    model,
    chatPath: process.env.SAKURA_AI_CHAT_PATH?.trim() || undefined,
    temperature: process.env.SAKURA_AI_TEMPERATURE
      ? Number(process.env.SAKURA_AI_TEMPERATURE)
      : undefined,
    maxTokens: process.env.SAKURA_AI_MAX_TOKENS
      ? Number(process.env.SAKURA_AI_MAX_TOKENS)
      : undefined,
  };
}

export async function runSakuraChat(
  opts: SakuraRunnerOptions,
  systemPrompt: string,
  userMessage: string,
): Promise<SakuraRunnerResult> {
  const url = `${opts.endpoint.replace(/\/+$/, "")}${opts.chatPath ?? "/chat/completions"}`;
  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 8192,
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
  };

  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`sakura HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: SakuraRunnerResult["usage"];
      };
      const message = json.choices?.[0]?.message?.content ?? "";
      return {
        message,
        model: json.model ?? opts.model,
        usage: json.usage,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("sakura runner failed");
}
