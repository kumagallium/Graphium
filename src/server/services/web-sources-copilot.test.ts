import { describe, expect, it } from "vitest";
import type { ToolCallRecord } from "./agent-loop.js";
import { extractWebSources } from "./web-sources.js";

// GitHub Copilot 内蔵 web_search（built-in GitHub MCP、Bing）の結果形。
// 実測（CLI 1.0.98、2026-10-19）: content が JSON 文字列で、parseBuiltinToolResult が
// 構造に戻した後の形を ToolCallRecord.output として受け取る。
const COPILOT_WEB_SEARCH_OUTPUT = {
  annotations: null,
  bing_searches: [
    {
      text: "latest release version of Graphium",
      url: "https://www.bing.com/search?q=latest+release+version+of+Graphium",
    },
  ],
  text: {
    annotations: [
      {
        end_index: 283,
        start_index: 271,
        text: "",
        url_citation: {
          title: "Releases · kumagallium/Graphium - GitHub",
          url: "https://github.com/kumagallium/Graphium/releases",
        },
      },
    ],
    value:
      "The latest release is **v0.89.7**. You can find it here:  \nhttps://github.com/kumagallium/Graphium/releases/tag/v0.89.7【3:0†source】.",
  },
  type: "output_text",
};

describe("extractWebSources: Copilot 内蔵 web_search", () => {
  it("url_citation の title+url を先に拾い、bing_searches（検索クエリの URL）は出典にしない", () => {
    const toolCalls: ToolCallRecord[] = [
      {
        tool_name: "web_search",
        input: { query: "latest release version of Graphium" },
        output: COPILOT_WEB_SEARCH_OUTPUT,
        duration_ms: 1,
      },
    ];
    expect(extractWebSources(toolCalls)).toEqual([
      {
        title: "Releases · kumagallium/Graphium - GitHub",
        url: "https://github.com/kumagallium/Graphium/releases",
      },
      // 本文中の URL は引用マーカー（【3:0†source】）と末尾の句点を切り落として拾う
      { url: "https://github.com/kumagallium/Graphium/releases/tag/v0.89.7" },
    ]);
  });

  it("本文に引用と同じ URL が先に出ていても title 付きの登録が勝つ", () => {
    const toolCalls: ToolCallRecord[] = [
      {
        tool_name: "web_search",
        input: {},
        output: {
          // キー順が value → annotations でも、構造化要素を先に見るので title が残る
          text: {
            value: "See https://example.com/a for details.",
            annotations: [{ url_citation: { title: "A", url: "https://example.com/a" } }],
          },
        },
        duration_ms: 1,
      },
    ];
    expect(extractWebSources(toolCalls)).toEqual([{ title: "A", url: "https://example.com/a" }]);
  });
});
