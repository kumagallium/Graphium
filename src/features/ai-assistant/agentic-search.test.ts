// agentic search セッションのテスト（採番の継続・collectedContext・エラーの文字列化）

import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn());
vi.mock("../wiki/retriever", () => ({
  searchKnowledgeForTool: searchMock,
  readSourceForTool: readMock,
}));

import { createAgenticSearchSession } from "./agentic-search";

const INITIAL = `<knowledge>
[#1 | Claim | "焼結条件"]
本文
[#2 | Topic | "熱伝導"]
本文
</knowledge>
<notes>
[#3 | "実験ノート"] (note)
本文
</notes>`;

beforeEach(() => {
  searchMock.mockReset();
  readMock.mockReset();
});

describe("createAgenticSearchSession", () => {
  it("初期文脈の最大番号から採番を続ける", async () => {
    searchMock.mockResolvedValue({ text: 'Results for "q":\n\n[#4 | "新規"] (note)\nx', lastNumber: 4 });
    const s = createAgenticSearchSession({ initialContext: INITIAL });
    expect(s.toolNames).toEqual(["search_my_knowledge", "read_my_page"]);
    await s.execute("search_my_knowledge", { query: "q" });
    expect(searchMock).toHaveBeenCalledWith("q", 3, undefined);
  });

  it("検索結果の番号も続く。read は既知の番号表と採番器を渡す", async () => {
    searchMock.mockResolvedValue({ text: '[#4 | "新規"] (note)\nx', lastNumber: 4 });
    readMock.mockImplementation((_ref: string, known: Map<number, string>, next: () => number) => {
      expect(known.get(4)).toBe("新規");
      expect(known.get(1)).toBe("焼結条件");
      return `[#${next()} | "別"]\n本文`;
    });
    const s = createAgenticSearchSession({ initialContext: INITIAL });
    await s.execute("search_my_knowledge", { query: "q" });
    const out = await s.execute("read_my_page", { ref: "別" });
    expect(out).toBe('[#5 | "別"]\n本文');
  });

  it("結果を collectedContext に貯める", async () => {
    searchMock.mockResolvedValue({ text: "R1", lastNumber: 0 });
    const s = createAgenticSearchSession({});
    expect(s.collectedContext()).toBe("");
    await s.execute("search_my_knowledge", { query: "a" });
    await s.execute("search_my_knowledge", { query: "b" });
    expect(s.collectedContext()).toBe("R1\n\nR1");
  });

  it("例外は Error 文字列にし、未知の道具・空入力も文字列で返す", async () => {
    searchMock.mockRejectedValue(new Error("boom"));
    const s = createAgenticSearchSession({});
    expect(await s.execute("search_my_knowledge", { query: "a" })).toBe("Error: boom");
    expect(await s.execute("search_my_knowledge", {})).toMatch(/^Error:/);
    expect(await s.execute("nope", {})).toMatch(/^Error:/);
  });

  it("excludeIds を検索へ渡す", async () => {
    searchMock.mockResolvedValue({ text: "R", lastNumber: 0 });
    const ex = new Set(["w1"]);
    await createAgenticSearchSession({ excludeIds: ex }).execute("search_my_knowledge", { query: "a" });
    expect(searchMock).toHaveBeenCalledWith("a", 0, ex);
  });
});
