// LLM プロバイダ呼び出し専用の fetch。
//
// Node 標準の fetch（undici）は、応答ヘッダーを既定で 300 秒しか待たない（headersTimeout）。
// AI SDK の generateText は非ストリーミングなので、生成が終わるまでヘッダーが返らず、
// 遅いモデル（端末内モデル・思考の長いモデル）や長い入力では 5 分で切れる。
// しかも SDK が 3 回まで再試行するため、ユーザーは約 15 分待たされた末に
// 「Headers Timeout Error」を見ることになっていた。
//
// 待ち時間の上限だけを延ばした Agent をこの fetch に閉じ込め、AI SDK の各プロバイダに
// `fetch` として渡す。グローバルの dispatcher は変えないので、URL 取り込みや MCP など
// 他の通信の挙動には影響しない。中断はこれまでどおり呼び出し側の abortSignal で効く。

import { Agent, fetch as undiciFetch } from "undici";

/** LLM 呼び出しで応答ヘッダー・本文の間隔を待つ上限（30 分） */
export const LLM_HTTP_TIMEOUT_MS = 30 * 60_000;

/** 上限を指定して LLM 用 fetch を作る（テストで短い上限を渡すために分けている） */
export function createLlmFetch(timeoutMs: number): typeof globalThis.fetch {
  const agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  return ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    // undici の fetch と Node 標準の fetch は型の出どころが違うだけで、実体は同じ WHATWG fetch
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: agent,
    }) as unknown as Promise<Response>) as typeof globalThis.fetch;
}

/** AI SDK のプロバイダに渡す fetch */
export const llmFetch = createLlmFetch(LLM_HTTP_TIMEOUT_MS);
