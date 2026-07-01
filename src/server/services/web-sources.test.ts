import { describe, it, expect } from "vitest";
import { extractWebSources, isWebSearchTool } from "./web-sources";
import type { ToolCallRecord } from "./agent-loop";

function tc(tool_name: string, output: Record<string, unknown>): ToolCallRecord {
  return { tool_name, input: {}, output, duration_ms: 0 };
}

describe("isWebSearchTool", () => {
  it("検索系ツール名を判定する", () => {
    expect(isWebSearchTool("tavily-search")).toBe(true);
    expect(isWebSearchTool("brave_web_search")).toBe(true);
    expect(isWebSearchTool("exa_search")).toBe(true);
  });

  it("ノート検索などの非 web 系は除外する", () => {
    expect(isWebSearchTool("notion-search")).toBe(false);
    expect(isWebSearchTool("read_note")).toBe(false);
  });
});

describe("extractWebSources", () => {
  it("Tavily 風の構造化結果から title+url を拾う", () => {
    const out = extractWebSources([
      tc("tavily-search", {
        result: {
          results: [
            { title: "Loop Engineering Guide", url: "https://example.com/a", content: "long body https://ignored.com/x" },
            { title: "What Is Loop Engineering", url: "https://example.com/b" },
          ],
        },
      }),
    ]);
    expect(out).toEqual([
      { title: "Loop Engineering Guide", url: "https://example.com/a" },
      { title: "What Is Loop Engineering", url: "https://example.com/b" },
    ]);
  });

  it("テキスト塊しか無い結果でも URL を拾う（フォールバック）", () => {
    const out = extractWebSources([
      tc("brave_web_search", { result: "See https://example.com/a and https://example.com/b." }),
    ]);
    expect(out).toEqual([{ url: "https://example.com/a" }, { url: "https://example.com/b" }]);
  });

  it("検索系でないツールの出力は無視する", () => {
    const out = extractWebSources([
      tc("notion-search", { result: { results: [{ title: "Page", url: "https://notion.so/p" }] } }),
    ]);
    expect(out).toEqual([]);
  });

  it("重複 URL を除去する", () => {
    const out = extractWebSources([
      tc("tavily-search", {
        result: { results: [{ url: "https://dup.com" }, { url: "https://dup.com" }] },
      }),
    ]);
    expect(out).toEqual([{ url: "https://dup.com" }]);
  });
});
