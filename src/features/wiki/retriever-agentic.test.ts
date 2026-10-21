// agentic search 用の retriever 関数（searchKnowledgeForTool / readSourceForTool）のテスト
// 語彙索引は search / listChunks だけ差し替え、埋め込みは fetch 失敗で空にする（語彙側だけを見る）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexicalHit } from "../lexical-search";

const searchMock = vi.hoisted(() => vi.fn());
const listChunksMock = vi.hoisted(() => vi.fn());
vi.mock("../lexical-search", async (importActual) => {
  const actual = await importActual<typeof import("../lexical-search")>();
  return { ...actual, lexicalSearch: { ...actual.lexicalSearch, search: searchMock, listChunks: listChunksMock } };
});

import {
  readSourceForTool,
  searchKnowledgeForTool,
  setNoteTitleMap,
  setWikiIndexForRetriever,
  setWikiTitleMap,
} from "./retriever";

const lex = (kind: LexicalHit["kind"], sourceId: string, title: string, text: string): LexicalHit => ({
  id: `${kind}:${sourceId}:c1`, kind, sourceId, chunkId: "c1", title, text, score: 1, terms: [],
});

beforeEach(() => {
  searchMock.mockReset();
  listChunksMock.mockReset();
  // 埋め込み API は落ちる想定（空配列になり語彙側だけが効く）
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  setWikiTitleMap(new Map());
  setNoteTitleMap(new Map());
  setWikiIndexForRetriever("");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchKnowledgeForTool", () => {
  it("番号を startAt+1 から振り、Wiki と断片を連番で返す", async () => {
    setWikiTitleMap(new Map([["w1", "焼結条件"]]));
    searchMock.mockImplementation((_q: string, opts: { kinds: string[] }) =>
      opts.kinds.includes("wiki")
        ? [lex("wiki", "w1", "焼結条件", "1200 度で 2 時間")]
        : [lex("note", "n1", "実験ノート", "昇温は 5 K/min")],
    );
    const r = await searchKnowledgeForTool("焼結", 3);
    expect(r.lastNumber).toBe(5);
    expect(r.text).toContain('[#4 | Claim | "焼結条件"]');
    expect(r.text).toContain('[#5 | "実験ノート"] (note)');
    expect(r.text).not.toContain("<wiki-index>");
  });

  it("ヒットなしは 1 行で返し、番号は進まない", async () => {
    searchMock.mockReturnValue([]);
    const r = await searchKnowledgeForTool("存在しない", 7);
    expect(r.lastNumber).toBe(7);
    expect(r.text).toBe('No results for "存在しない".');
  });
});

describe("readSourceForTool", () => {
  it("#N を題名に直して全文を返し、heading は ## で前置する", async () => {
    // 断片の注入で題名 → note:n1 の参照を登録しておく
    searchMock.mockImplementation((_q: string, opts: { kinds: string[] }) =>
      opts.kinds.includes("note") ? [lex("note", "n1", "実験ノート", "x")] : []);
    await searchKnowledgeForTool("x", 0);
    listChunksMock.mockReturnValue([
      { chunkId: "a", text: "前半", heading: "手順", terms: [] },
      { chunkId: "b", text: "後半", terms: [] },
    ]);
    const out = readSourceForTool("[#2]", new Map([[2, "実験ノート"]]));
    expect(listChunksMock).toHaveBeenCalledWith("n1");
    expect(out).toBe('[#2 | "実験ノート"]\n## 手順\n前半\n\n後半');
  });

  it("題名指定でノート id の逆引きができ、番号は採番器から受ける", () => {
    setNoteTitleMap(new Map([["n9", "別ノート"]]));
    listChunksMock.mockReturnValue([{ chunkId: "a", text: "本文", terms: [] }]);
    const out = readSourceForTool("別ノート", new Map(), () => 11);
    expect(listChunksMock).toHaveBeenCalledWith("n9");
    expect(out).toBe('[#11 | "別ノート"]\n本文');
  });

  it("6,000 字を超えたら切って印を付ける", () => {
    setNoteTitleMap(new Map([["n9", "長いノート"]]));
    listChunksMock.mockReturnValue([{ chunkId: "a", text: "あ".repeat(7000), terms: [] }]);
    const out = readSourceForTool("長いノート", new Map(), () => 1);
    expect(out.endsWith("…(truncated)")).toBe(true);
    expect(out.length).toBeLessThan(6100);
  });

  it("見つからないものは Not found を返す", () => {
    expect(readSourceForTool("#9", new Map())).toMatch(/^Not found:/);
    expect(readSourceForTool("存在しない題", new Map())).toMatch(/^Not found:/);
  });
});
