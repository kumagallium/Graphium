// チャットの agentic search セッション
// LLM が呼ぶ道具（search_my_knowledge / read_my_page）をブラウザ側で実行する。
// サーバーの代理ツールからの tool_request を runAgent が受け、ここの execute に渡す。
// 番号 [#N] は最初に貼った文脈（initialContext）から続けて振り、
// 道具が返した本文は collectedContext に貯めて引用の正規化に使えるようにする。

import { searchKnowledgeForTool, readSourceForTool } from "../wiki/retriever";

export const SEARCH_TOOL_NAME = "search_my_knowledge";
export const READ_TOOL_NAME = "read_my_page";

export type AgenticSearchSession = {
  toolNames: string[];
  execute(name: string, input: Record<string, unknown>): Promise<string>;
  /** 道具の結果を連結した文脈（引用正規化で initialContext + これ を渡す） */
  collectedContext(): string;
};

/** citation-normalize と同じ番号付き見出しの正規表現（Kind は省略可） */
const NUMBERED_PATTERN = /\[#(\d+)\s*\|\s*(?:[^|"]+\|\s*)?"([^"]+)"\]/g;

export function createAgenticSearchSession(opts: {
  initialContext?: string;
  excludeIds?: Set<string>;
}): AgenticSearchSession {
  const known = new Map<number, string>();
  let last = 0;
  const collected: string[] = [];

  /** テキスト中の番号付き見出しを拾って採番を進める */
  const absorb = (text: string) => {
    for (const m of text.matchAll(NUMBERED_PATTERN)) {
      const num = parseInt(m[1], 10);
      known.set(num, m[2]);
      if (num > last) last = num;
    }
  };
  if (opts.initialContext) absorb(opts.initialContext);

  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    if (name === SEARCH_TOOL_NAME) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return "Error: query is required.";
      const r = await searchKnowledgeForTool(query.slice(0, 200), last, opts.excludeIds);
      if (r.lastNumber > last) last = r.lastNumber;
      absorb(r.text);
      return r.text;
    }
    if (name === READ_TOOL_NAME) {
      const ref = typeof input.ref === "string" ? input.ref.trim() : "";
      if (!ref) return "Error: ref is required.";
      const text = readSourceForTool(ref, known, () => {
        last += 1;
        return last;
      });
      absorb(text);
      return text;
    }
    return `Error: unknown tool ${name}.`;
  };

  return {
    toolNames: [SEARCH_TOOL_NAME, READ_TOOL_NAME],
    async execute(name, input) {
      let out: string;
      try {
        out = await run(name, input);
      } catch (err) {
        out = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      collected.push(out);
      return out;
    },
    collectedContext() {
      return collected.join("\n\n");
    },
  };
}
