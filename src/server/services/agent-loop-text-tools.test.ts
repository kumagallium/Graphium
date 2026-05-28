import { describe, it, expect } from "vitest";
import { extractToolCalls, stripToolCallBlocks } from "./agent-loop-text-tools";

describe("extractToolCalls", () => {
  it("single tool_call block を抽出する", () => {
    const text = `Let me look this up.
<tool_call>
{"name": "search", "arguments": {"q": "foo"}}
</tool_call>`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("search");
    expect(calls[0].arguments).toEqual({ q: "foo" });
  });

  it("複数の tool_call をすべて抽出する", () => {
    const text = `
<tool_call>{"name":"a","arguments":{"x":1}}</tool_call>
<tool_call>{"name":"b","arguments":{"y":2}}</tool_call>
`;
    const calls = extractToolCalls(text);
    expect(calls.map((c) => c.name)).toEqual(["a", "b"]);
    expect(calls[0].arguments).toEqual({ x: 1 });
    expect(calls[1].arguments).toEqual({ y: 2 });
  });

  it("arguments の代わりに args を使ったペイロードも受け付ける", () => {
    const text = `<tool_call>{"name":"a","args":{"x":1}}</tool_call>`;
    const calls = extractToolCalls(text);
    expect(calls[0].arguments).toEqual({ x: 1 });
  });

  it("```json ... ``` で包まれた中身も剥がしてパースする", () => {
    const text =
      "<tool_call>\n```json\n{\"name\":\"a\",\"arguments\":{\"x\":1}}\n```\n</tool_call>";
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("a");
    expect(calls[0].arguments).toEqual({ x: 1 });
  });

  it("name が無いペイロードは無視する", () => {
    const text = `<tool_call>{"arguments":{"x":1}}</tool_call>`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it("壊れた JSON は無視する", () => {
    const text = `<tool_call>{not json}</tool_call>`;
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it("tool_call ブロックが無ければ空配列を返す", () => {
    expect(extractToolCalls("just a normal answer")).toEqual([]);
  });
});

describe("stripToolCallBlocks", () => {
  it("tool_call ブロックを取り除いた残りのテキストを返す", () => {
    const text = `Hello.
<tool_call>{"name":"a","arguments":{}}</tool_call>
Done.`;
    expect(stripToolCallBlocks(text)).toBe("Hello.\n\nDone.");
  });

  it("ブロックが無ければそのまま返す", () => {
    expect(stripToolCallBlocks("plain text")).toBe("plain text");
  });
});
