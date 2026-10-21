// ブラウザ実行ツールの代理（bridge）
// 検索索引はブラウザの IndexedDB にあるため、道具の実体はクライアントで動く。
// サーバーには「tool_request をストリームに書き出して結果を待つ」代理ツールだけを置く。
// runAgentLoop の 3 経路はどれも tool.execute を呼ぶので、ループ側は変更不要。

import { tool, jsonSchema } from "ai";

/** クライアントが実行できる道具の固定定義（名前で opt-in。未知の名前は無視） */
export const CLIENT_TOOL_DEFS: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {
  search_my_knowledge: {
    description:
      "Search the user's own Graphium (topics, insights, note bodies, and materials) by keyword and meaning. " +
      "Use it when the context already provided is not enough, to re-query with a rephrased or different angle. " +
      "Each result item is numbered like [#N]; cite them in your answer in the same [#N] form.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 200, description: "Search query" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  read_my_page: {
    description:
      "Read the full text of a page (note, topic, etc.) that appeared in search results or the provided context. " +
      "Use it when a snippet lacks the conditions, numbers, or steps you need.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", minLength: 1, description: "A `#N` number from the results, or the exact page title" },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
};

/** 既知の道具名だけを残す（重複も除く） */
export function normalizeClientTools(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  for (const n of names) {
    if (typeof n === "string" && n in CLIENT_TOOL_DEFS && !out.includes(n)) out.push(n);
  }
  return out;
}

/** system prompt に足す道具の使い方の節 */
export const CLIENT_TOOLS_PROMPT = [
  "## Searching the user's Graphium",
  "You have tools that search and read the user's own Graphium (`search_my_knowledge`, `read_my_page`).",
  "- First consider whether the context already provided is enough to answer.",
  "- Use the tools when it is not enough, when a rephrased query is needed, or for two-step questions (e.g. find notes that used A, then read their conditions).",
  "- Call them only as much as needed (about 3 calls per question at most).",
  "- Cite results from the tools with [#N] just like the provided context.",
].join("\n");

/** tool_result の output の上限（サーバー側の保険） */
export const MAX_TOOL_OUTPUT_CHARS = 20_000;
/** ブラウザからの結果待ちの上限 */
export const TOOL_TIMEOUT_MS = 30_000;

export const TIMEOUT_RESULT = "Error: the tool did not respond in time.";

type Pending = { resolve: (value: string) => void; timer: ReturnType<typeof setTimeout> };

// run_id -> call_id -> pending
const pendingByRun = new Map<string, Map<string, Pending>>();

export type ToolRequestEvent = {
  type: "tool_request";
  run_id: string;
  call_id: string;
  name: string;
  input: unknown;
};

/**
 * tool-result の到着を待っている呼び出しを解決する。
 * 待っている呼び出しが無ければ false（呼び出し側が 404 を返す）。
 */
export function resolveToolResult(
  runId: string,
  callId: string,
  result: { output?: string; error?: string },
): boolean {
  const calls = pendingByRun.get(runId);
  const pending = calls?.get(callId);
  if (!calls || !pending) return false;
  clearTimeout(pending.timer);
  calls.delete(callId);
  if (calls.size === 0) pendingByRun.delete(runId);
  if (typeof result.error === "string" && result.error) {
    pending.resolve(`Error: ${result.error}`);
  } else {
    pending.resolve(String(result.output ?? "").slice(0, MAX_TOOL_OUTPUT_CHARS));
  }
  return true;
}

/** テスト用: 待ち合わせ中の run 数 */
export function pendingRunCountForTest(): number {
  return pendingByRun.size;
}

export type ClientToolBridge = {
  /** runAgentLoop の tools に混ぜる代理ツール */
  tools: Record<string, unknown>;
  /** 待ちを全部捨てて Map から消す（run 終了時・切断時） */
  dispose: () => void;
};

export function createClientToolBridge(params: {
  runId: string;
  names: string[];
  /** tool_request を NDJSON に書き出す */
  emit: (event: ToolRequestEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}): ClientToolBridge {
  const { runId, names, emit, signal, timeoutMs = TOOL_TIMEOUT_MS } = params;
  let disposed = false;

  const dispose = () => {
    disposed = true;
    const calls = pendingByRun.get(runId);
    if (calls) {
      for (const p of calls.values()) {
        clearTimeout(p.timer);
        p.resolve("Error: the run was cancelled.");
      }
      pendingByRun.delete(runId);
    }
  };
  // クライアント切断: 待ちを捨てる（ループ自体は abortSignal で止まる）
  if (signal) {
    if (signal.aborted) dispose();
    else signal.addEventListener("abort", dispose, { once: true });
  }

  const tools: Record<string, unknown> = {};
  for (const name of names) {
    const def = CLIENT_TOOL_DEFS[name];
    if (!def) continue;
    tools[name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as never),
      execute: async (input: unknown) => {
        if (disposed) return "Error: the run was cancelled.";
        const callId = crypto.randomUUID();
        return new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            const calls = pendingByRun.get(runId);
            calls?.delete(callId);
            if (calls && calls.size === 0) pendingByRun.delete(runId);
            resolve(TIMEOUT_RESULT);
          }, timeoutMs);
          let calls = pendingByRun.get(runId);
          if (!calls) {
            calls = new Map();
            pendingByRun.set(runId, calls);
          }
          calls.set(callId, { resolve, timer });
          emit({ type: "tool_request", run_id: runId, call_id: callId, name, input });
        });
      },
    } as never);
  }

  return { tools, dispose };
}
