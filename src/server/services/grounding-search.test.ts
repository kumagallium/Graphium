import { describe, expect, it, vi } from "vitest";

import {
  findSearchTool, isTrustedGroundingTool,
  pickQueryParam,
  extractUrls,
  normalizeUrlForMatch,
  renderToolResultText,
  runGroundingSearch,
  type GroundingSearchTool,
} from "./grounding-search.js";

function fakeTool(over: Partial<GroundingSearchTool> = {}): GroundingSearchTool {
  return { execute: vi.fn(async () => ""), ...over };
}

describe("findSearchTool（選べる道具を絞る）", () => {
  it("信頼できない道具は名前が検索らしくても選ばない", () => {
    const tools = { create_saved_search: fakeTool(), tavily_search: fakeTool() };
    expect(findSearchTool(tools, (n) => n === "tavily_search")?.name).toBe("tavily_search");
    expect(findSearchTool({ create_saved_search: fakeTool() }, () => false)).toBeNull();
  });
  it("exa は単語として当たるときだけ（example / exact は当たらない）", () => {
    expect(findSearchTool({ create_example_page: fakeTool() }, () => true)).toBeNull();
    expect(findSearchTool({ exact_lookup: fakeTool() }, () => true)).toBeNull();
    expect(findSearchTool({ exa_search: fakeTool() }, () => true)?.name).toBe("exa_search");
  });
  it("exa のキャメルケース（exaSearch / ExaSearch）も当たる。hexagon は当たらない", () => {
    expect(findSearchTool({ exaSearch: fakeTool() }, () => true)?.name).toBe("exaSearch");
    expect(findSearchTool({ ExaSearch: fakeTool() }, () => true)?.name).toBe("ExaSearch");
    expect(findSearchTool({ hexagon_tool: fakeTool() }, () => true)).toBeNull();
    expect(findSearchTool({ example: fakeTool() }, () => true)).toBeNull();
  });
});

describe("findSearchTool", () => {
  it("web 検索とわかる名前を最優先する", () => {
    const tools = {
      read_file: fakeTool(),
      web_search: fakeTool(),
      some_search_helper: fakeTool(),
    };
    expect(findSearchTool(tools, () => true)?.name).toBe("web_search");
  });

  it("tavily / exa / brave なども検索ツールとして拾う", () => {
    expect(findSearchTool({ tavily_search: fakeTool() }, () => true)?.name).toBe("tavily_search");
    expect(findSearchTool({ exa_search: fakeTool() }, () => true)?.name).toBe("exa_search");
  });

  it("一般的な search 名にフォールバックする", () => {
    expect(findSearchTool({ search: fakeTool() }, () => true)?.name).toBe("search");
    expect(findSearchTool({ knowledge_search: fakeTool() }, () => true)?.name).toBe("knowledge_search");
  });

  it("検索ツールが無ければ null", () => {
    expect(findSearchTool({ read_file: fakeTool(), write_file: fakeTool() }, () => true)).toBeNull();
  });

  it("execute を持たないエントリは除外する", () => {
    expect(findSearchTool({ web_search: { description: "x" } as unknown }, () => true)).toBeNull();
  });
});

describe("pickQueryParam", () => {
  it("inputSchema.jsonSchema.properties から query 系の名前を選ぶ", () => {
    const tool = {
      execute: vi.fn(),
      inputSchema: { jsonSchema: { properties: { query: { type: "string" } } } },
    } as unknown as GroundingSearchTool;
    expect(pickQueryParam(tool)).toBe("query");
  });

  it("query が無ければ q を選ぶ", () => {
    const tool = {
      execute: vi.fn(),
      inputSchema: { jsonSchema: { properties: { q: { type: "string" }, count: { type: "number" } } } },
    } as unknown as GroundingSearchTool;
    expect(pickQueryParam(tool)).toBe("q");
  });

  it("既知の名前が無ければ最初の string プロパティを選ぶ", () => {
    const tool = {
      execute: vi.fn(),
      inputSchema: { jsonSchema: { properties: { limit: { type: "number" }, needle: { type: "string" } } } },
    } as unknown as GroundingSearchTool;
    expect(pickQueryParam(tool)).toBe("needle");
  });

  it("スキーマが読めなければ query にフォールバック", () => {
    expect(pickQueryParam(fakeTool())).toBe("query");
  });
});

describe("normalizeUrlForMatch", () => {
  it("hash 除去・ホスト小文字化・末尾スラッシュ除去", () => {
    expect(normalizeUrlForMatch("HTTPS://Example.com/Path/#frag")).toBe(
      "https://example.com/Path",
    );
  });

  it("query は残す", () => {
    expect(normalizeUrlForMatch("https://example.com/s?q=1")).toBe("https://example.com/s?q=1");
  });

  it("http(s) 以外は null", () => {
    expect(normalizeUrlForMatch("ftp://example.com")).toBeNull();
    expect(normalizeUrlForMatch("not a url")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("テキストから http(s) URL を重複なく抽出する", () => {
    const text = "see https://a.com/x and https://b.org/y, also https://a.com/x again";
    expect(extractUrls(text)).toEqual(["https://a.com/x", "https://b.org/y"]);
  });

  it("Wikipedia の括弧付き記事を壊さない", () => {
    const text = "https://en.wikipedia.org/wiki/Mercury_(planet) is a page";
    expect(extractUrls(text)).toEqual(["https://en.wikipedia.org/wiki/Mercury_(planet)"]);
  });

  it("散文中の末尾 ) は落とす", () => {
    const text = "(refer to https://example.com/doc)";
    expect(extractUrls(text)).toEqual(["https://example.com/doc"]);
  });

  it("末尾の句読点を落とす", () => {
    expect(extractUrls("link: https://example.com/a.")).toEqual(["https://example.com/a"]);
  });
});

describe("renderToolResultText", () => {
  it("文字列はそのまま", () => {
    expect(renderToolResultText("hello")).toBe("hello");
  });

  it("MCP CallToolResult（content[].text）を結合する", () => {
    const raw = { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
    expect(renderToolResultText(raw)).toBe("a\nb");
  });

  it("その他オブジェクトは JSON 化する", () => {
    expect(renderToolResultText({ results: [{ url: "https://x.com" }] })).toContain("https://x.com");
  });

  it("null は空文字", () => {
    expect(renderToolResultText(null)).toBe("");
  });
});

describe("runGroundingSearch", () => {
  it("検索結果のテキストと URL 集合を返す", async () => {
    const tool = fakeTool({
      execute: vi.fn(async () => ({
        content: [{ type: "text", text: "Result A https://a.com/1\nResult B https://b.org/2" }],
      })),
    });
    const out = await runGroundingSearch({ name: "web_search", tool }, "my claim");
    expect(out.urls).toEqual(["https://a.com/1", "https://b.org/2"]);
    expect(out.evidenceText).toContain("Result A");
    // claim はクエリパラメータに流し込まれる
    expect(tool.execute).toHaveBeenCalledWith(
      { query: "my claim" },
      expect.objectContaining({ toolCallId: "world-grounding-search" }),
    );
  });

  it("検出した query パラメータ名を使う", async () => {
    const execute = vi.fn(async () => "https://x.com/r");
    const tool = {
      execute,
      inputSchema: { jsonSchema: { properties: { q: { type: "string" } } } },
    } as unknown as GroundingSearchTool;
    await runGroundingSearch({ name: "search", tool }, "hello");
    expect(execute).toHaveBeenCalledWith({ q: "hello" }, expect.anything());
  });

  it("ツールが throw したら空に倒す（parametric フォールバック）", async () => {
    const tool = fakeTool({
      execute: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const out = await runGroundingSearch({ name: "web_search", tool }, "x");
    expect(out).toEqual({ evidenceText: "", urls: [] });
  });
});

describe("isTrustedGroundingTool（世界照合が使う道具の信頼判定）", () => {
  const exec = { execute: async () => ({}) };
  const tools = { create_saved_search: exec, "tavily-search": exec, "tavily-extract": exec, brave_search: exec };
  const toolInfo = {
    create_saved_search: { server: "evil", readOnly: false },
    "tavily-search": { server: "tavily", readOnly: false },
    "tavily-extract": { server: "tavily", readOnly: true },
    brave_search: { server: "brave", readOnly: true },
  };
  const free = new Map([["tavily", new Set(["tavily-search"])]]);

  it("確認なしの一覧にある検索は選ばれ、名前が検索らしいだけの信頼できない道具は選ばれない", () => {
    const got = findSearchTool(tools, (n) => isTrustedGroundingTool(n, toolInfo, new Set(), free));
    expect(got?.name).toBe("tavily-search");
  });
  it("一覧外の道具・「今後確認しない」でないサーバーの readOnly は使わない", () => {
    expect(isTrustedGroundingTool("tavily-extract", toolInfo, new Set(), free)).toBe(false);
    expect(isTrustedGroundingTool("brave_search", toolInfo, new Set(), free)).toBe(false);
    expect(isTrustedGroundingTool("create_saved_search", toolInfo, new Set(["evil"]), free)).toBe(false);
  });
  it("「今後確認しない」にしたサーバーの readOnly の道具は使える", () => {
    expect(isTrustedGroundingTool("brave_search", toolInfo, new Set(["brave"]), free)).toBe(true);
  });
  it("運用側 Registry のサーバーは注釈が無くても使える（destructiveHint 明示は除く）", () => {
    expect(isTrustedGroundingTool("brave_search", toolInfo, new Set(), free, new Set(["brave"]))).toBe(true);
    expect(isTrustedGroundingTool("create_saved_search", toolInfo, new Set(), free, new Set(["evil"]))).toBe(true);
    const d = { x_search: { server: "op", readOnly: false, destructive: true } };
    expect(isTrustedGroundingTool("x_search", d, new Set(), free, new Set(["op"]))).toBe(false);
    expect(isTrustedGroundingTool("x_search", d, new Set(), free, new Set())).toBe(false);
  });
});
