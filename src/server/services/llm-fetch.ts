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

/** 応答ヘッダーをこの時間待っても返らなければ、記録に「まだ待っている」と 1 行残す（5 分） */
export const LLM_HTTP_SLOW_NOTICE_MS = 5 * 60_000;

export type LlmFetchOptions = {
  /** 記録の出力先（テスト用。既定は console） */
  log?: (line: string) => void;
  /** 「まだ待っている」を残すまでの時間（テスト用） */
  slowNoticeMs?: number;
};

/** 宛先のホスト名だけを取り出す（パス・クエリ・キーは記録に残さない） */
function hostOf(input: unknown): string {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? "";
    return new URL(raw).host;
  } catch {
    return "unknown";
  }
}

/**
 * 上限を指定して LLM 用 fetch を作る（テストで短い上限を渡すために分けている）。
 *
 * 呼び出し 1 回ごとに、応答ヘッダーが返るまでの時間を 1 行で記録する。非ストリーミングの
 * 生成ではヘッダーが返る＝生成が終わった時点なので、これが呼び出しの所要時間になる。
 * （ストリーミングの応答では最初の 1 バイトまでの時間で、本文の途中で止まった場合は残らない）
 * 手入れが長時間進まないとき、応答が止まっているのか、遅いだけなのか、失敗してやり直して
 * いるのかを sidecar の記録から区別できるようにするため（以前は成功した呼び出しが記録に
 * 何も残らず、待ちの原因を後から追えなかった）。
 */
export function createLlmFetch(timeoutMs: number, options: LlmFetchOptions = {}): typeof globalThis.fetch {
  const agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  const log = options.log ?? ((line: string) => console.log(line));
  const slowNoticeMs = options.slowNoticeMs ?? LLM_HTTP_SLOW_NOTICE_MS;
  return (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const host = hostOf(input);
    const startedAt = Date.now();
    const seconds = () => ((Date.now() - startedAt) / 1000).toFixed(1);
    const slowTimer = setInterval(() => {
      log(`[llm-http] still waiting ${seconds()}s host=${host}`);
    }, slowNoticeMs);
    slowTimer.unref?.();
    try {
      // undici の fetch と Node 標準の fetch は型の出どころが違うだけで、実体は同じ WHATWG fetch
      const res = (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: agent,
      })) as unknown as Response;
      log(`[llm-http] ${res.status} headers after ${seconds()}s host=${host}`);
      return res;
    } catch (err) {
      const aborted = init?.signal?.aborted === true;
      const cause = (err as { cause?: { name?: string; code?: string } })?.cause;
      const reason = aborted ? "aborted" : cause?.code ?? cause?.name ?? (err as Error)?.name ?? "error";
      log(`[llm-http] ${aborted ? "aborted" : "failed"} after ${seconds()}s host=${host} reason=${reason}`);
      throw err;
    } finally {
      clearInterval(slowTimer);
    }
  }) as typeof globalThis.fetch;
}

/** AI SDK のプロバイダに渡す fetch */
export const llmFetch = createLlmFetch(LLM_HTTP_TIMEOUT_MS);
