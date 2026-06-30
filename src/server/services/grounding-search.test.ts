import { describe, expect, it, vi } from "vitest";

import {
  findSearchTool,
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

describe("findSearchTool", () => {
  it("web 検索とわかる名前を最優先する", () => {
    const tools = {
      read_file: fakeTool(),
      web_search: fakeTool(),
      some_search_helper: fakeTool(),
    };
    expect(findSearchTool(tools)?.name).toBe("web_search");
  });

  it("tavily / exa / brave なども検索ツールとして拾う", () => {
    expect(findSearchTool({ tavily_search: fakeTool() })?.name).toBe("tavily_search");
    expect(findSearchTool({ exa_search: fakeTool() })?.name).toBe("exa_search");
  });

  it("一般的な search 名にフォールバックする", () => {
    expect(findSearchTool({ search: fakeTool() })?.name).toBe("search");
    expect(findSearchTool({ knowledge_search: fakeTool() })?.name).toBe("knowledge_search");
  });

  it("検索ツールが無ければ null", () => {
    expect(findSearchTool({ read_file: fakeTool(), write_file: fakeTool() })).toBeNull();
  });

  it("execute を持たないエントリは除外する", () => {
    expect(findSearchTool({ web_search: { description: "x" } as unknown })).toBeNull();
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
