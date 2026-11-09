// チャットの agentic search セッション
// LLM が呼ぶ道具をブラウザ側で実行する。
//   段 1: search_my_knowledge / read_my_page（語と意味で探す・読む）
//   段 2: find_notes_using / get_note_steps / trace_lineage / list_entities（来歴グラフを辿る。prov-graph-tools.ts）
// サーバーの代理ツールからの tool_request を runAgent が受け、ここの execute に渡す。
// 番号 [#N] は最初に貼った文脈（initialContext）から続けて振り、
// 道具が返した本文は collectedContext に貯めて引用の正規化に使えるようにする。
// 呼んだ道具は steps に記録し、チャットの経過表示（考え中の行と、回答の「調べた手順」）に使う。

import { searchKnowledgeForTool, readSourceForTool, rememberCitedSource, getWikiTitleToIdMap } from "../wiki/retriever";
import type { AgentToolStep } from "../../lib/document-types";
import { PROV_TOOL_NAMES, runProvTool, noteTitleSuffix } from "./prov-graph-tools";

export const SEARCH_TOOL_NAME = "search_my_knowledge";
export const READ_TOOL_NAME = "read_my_page";

export type AgenticSearchSession = {
  toolNames: string[];
  execute(name: string, input: Record<string, unknown>): Promise<string>;
  /** 道具の結果を連結した文脈（引用正規化で initialContext + これ を渡す） */
  collectedContext(): string;
  /** 呼んだ道具の記録（呼んだ順） */
  steps(): AgentToolStep[];
  /** 来歴の道具が実際にたどった線（手前 → 先。たどった順・重複なし。ID はノート・出典の ID） */
  walkedEdges(): { from: string; to: string }[];
};

/** citation-normalize と同じ番号付き見出しの正規表現（Kind は省略可） */
const NUMBERED_PATTERN = /\[#(\d+)\s*\|\s*(?:[^|"]+\|\s*)?"([^"]+)"\]/g;

/** 経過表示に出す、道具の入力の一言（検索語・対象など）。`#N` は分かっていれば題名にする */
export function describeToolInput(input: Record<string, unknown>, known?: Map<number, string>): string {
  for (const key of ["query", "text", "ref"] as const) {
    const v = input[key];
    if (typeof v !== "string" || !v.trim()) continue;
    const num = key === "ref" ? v.trim().match(/^\[?#?(\d+)\]?$/) : null;
    const title = num ? known?.get(parseInt(num[1], 10)) : undefined;
    return (title ?? v.trim()).slice(0, 80);
  }
  return "";
}

/** 件数を数える道具（探す系）。読む系（1 ページを読む・辿る）は件数を出さない */
const COUNTED_TOOLS = new Set([SEARCH_TOOL_NAME, "find_notes_using", "list_entities"]);

/** 結果のうち引用番号が振られた件数（経過表示の「n 件」） */
function countNumbered(text: string): number {
  return new Set(Array.from(text.matchAll(NUMBERED_PATTERN), (m) => m[1])).size;
}

export function createAgenticSearchSession(opts: {
  initialContext?: string;
  excludeIds?: Set<string>;
  /** フォルダで範囲を絞った会話では、道具の検索・読み取りも同じ範囲に閉じる */
  onlyIds?: ReadonlySet<string>;
  /** 道具を 1 つ呼び終えるたびに呼ぶ（考え中の行に経過を出すため） */
  onStep?: (steps: AgentToolStep[]) => void;
}): AgenticSearchSession {
  const scope = { onlyIds: opts.onlyIds };
  const known = new Map<number, string>();
  let last = 0;
  const collected: string[] = [];
  const steps: AgentToolStep[] = [];
  const walked: { from: string; to: string }[] = [];
  const walkedKeys = new Set<string>();
  const onWalk = (from: string, to: string) => {
    // 向きは問わず同じ線は 1 本に数える
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    if (from === to || walkedKeys.has(key)) return;
    walkedKeys.add(key);
    walked.push({ from, to });
  };

  /** テキスト中の番号付き見出しを拾って採番を進める */
  const absorb = (text: string) => {
    for (const m of text.matchAll(NUMBERED_PATTERN)) {
      const num = parseInt(m[1], 10);
      known.set(num, m[2]);
      if (num > last) last = num;
    }
  };
  if (opts.initialContext) absorb(opts.initialContext);

  /** 来歴の道具が番号を振ったノート（番号 → ノート ID） */
  const citedIds = new Map<number, string>();

  /**
   * 来歴の道具が出したノートに番号を振る（同じノートは同じ番号）。
   * 引用リンクは題名で解決され、同名のナレッジ（要約ページはもとのノートと同じ題名を持つ）が
   * 優先されるので、ノートの題名が既存のナレッジと重なるときは「（ノート）」（英語は " (note)"）を添えて区別する。
   */
  const cite = (noteId: string, title: string, isWiki: boolean): string => {
    for (const [n, id] of citedIds) {
      if (id === noteId) return header(n, known.get(n) ?? title, isWiki);
    }
    let shown = title || noteId;
    if (!isWiki && getWikiTitleToIdMap().has(shown)) shown = `${shown}${noteTitleSuffix()}`;
    last += 1;
    const num = last;
    known.set(num, shown);
    citedIds.set(num, noteId);
    if (!isWiki) rememberCitedSource(shown, `note:${noteId}`);
    return header(num, shown, isWiki);
  };
  const header = (num: number, shown: string, isWiki: boolean) =>
    isWiki ? `[#${num} | "${shown}"]` : `[#${num} | "${shown}"] (note)`;

  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    if (name === SEARCH_TOOL_NAME) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return "Error: query is required.";
      const r = await searchKnowledgeForTool(query.slice(0, 200), last, opts.excludeIds, scope);
      if (r.lastNumber > last) last = r.lastNumber;
      absorb(r.text);
      return r.text;
    }
    if (name === READ_TOOL_NAME) {
      const ref = typeof input.ref === "string" ? input.ref.trim() : "";
      if (!ref) return "Error: ref is required.";
      const text = readSourceForTool(
        ref,
        known,
        () => {
          last += 1;
          return last;
        },
        scope,
      );
      absorb(text);
      return text;
    }
    const prov = await runProvTool(name, input, {
      cite,
      titleOfNumber: (n) => known.get(n),
      idOfNumber: (n) => citedIds.get(n),
      onlyIds: opts.onlyIds,
      onWalk,
    });
    if (prov !== null) return prov;
    return `Error: unknown tool ${name}.`;
  };

  return {
    toolNames: [SEARCH_TOOL_NAME, READ_TOOL_NAME, ...PROV_TOOL_NAMES],
    async execute(name, input) {
      let out: string;
      let failed = false;
      try {
        out = await run(name, input);
      } catch (err) {
        out = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (/^(Error:|Not found:|No )/.test(out)) failed = true;
      collected.push(out);
      steps.push({
        tool: name,
        // 題名の解決は実行の後に行う（道具が新しく振った番号も引けるように）
        input: describeToolInput(input, known),
        hits: failed || !COUNTED_TOOLS.has(name) ? 0 : countNumbered(out),
        ...(failed ? { empty: true } : {}),
      });
      opts.onStep?.([...steps]);
      return out;
    },
    collectedContext() {
      return collected.join("\n\n");
    },
    steps() {
      return [...steps];
    },
    walkedEdges() {
      return walked.map((w) => ({ ...w }));
    },
  };
}
