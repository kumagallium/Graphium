// スニペット切り出しのテスト
// - 最初に当たった語の周辺を窓にし、窓内の全ての語を強調する
// - 大文字小文字・全角半角の差を吸収する
// - どの語も無ければ先頭を返す

import { describe, expect, it } from "vitest";
import { buildSnippet } from "./snippet";

describe("buildSnippet", () => {
  it("当たった語の周辺を切り出し、範囲を返す", () => {
    const text = `${"前".repeat(50)}湿度が高いと試薬が劣化する${"後".repeat(100)}`;
    const s = buildSnippet(text, ["劣化", "湿度"], { before: 10, after: 30 });
    expect(s.text.startsWith("…")).toBe(true);
    expect(s.text.endsWith("…")).toBe(true);
    const marked = s.ranges.map((r) => s.text.slice(r.start, r.end));
    expect(marked).toContain("湿度");
    expect(marked).toContain("劣化");
  });

  it("大文字小文字・全角半角の差を吸収して強調する", () => {
    const s = buildSnippet("The PPMS system with ＴＴＯ option", ["ppms", "tto"]);
    const marked = s.ranges.map((r) => s.text.slice(r.start, r.end));
    expect(marked).toContain("PPMS");
    expect(marked).toContain("ＴＴＯ");
  });

  it("どの語も無ければ先頭を切り詰めて返す", () => {
    const s = buildSnippet("x".repeat(300), ["zzz"], { before: 10, after: 20 });
    expect(s.text).toBe(`${"x".repeat(30)}…`);
    expect(s.ranges).toEqual([]);
  });

  it("空テキストは空", () => {
    expect(buildSnippet("", ["a"])).toEqual({ text: "", ranges: [] });
  });
});

describe("buildSnippet — 窓の位置", () => {
  it("短い語が手前にあっても、最も長い語の最初の出現を窓の中心にする", () => {
    const text = `${"あ".repeat(60)}凝固装置を使った。${"い".repeat(60)}焼結装置（SPS）で焼結した。${"う".repeat(60)}`;
    const s = buildSnippet(text, ["焼結装置", "装置", "焼結"], { before: 10, after: 30 });
    expect(s.text).toContain("焼結装置");
    const marked = s.ranges.map((r) => s.text.slice(r.start, r.end));
    expect(marked).toContain("焼結装置");
  });
});
