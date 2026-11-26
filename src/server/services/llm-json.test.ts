import { describe, expect, it } from "vitest";
import { parseJsonLenient, repairJsonStringEscapes } from "./llm-json";
import { parseSourceTopicReviserOutput } from "./wiki-topic-writer";

describe("parseJsonLenient", () => {
  it("正しい JSON はそのまま読む（修復を通さない）", () => {
    expect(parseJsonLenient('{"body":"a\\nb \\"q\\" \\u00e9"}')).toEqual({ body: 'a\nb "q" é' });
  });

  it("JSON に無いエスケープ（数式のバックスラッシュ）をそのまま残して読む", () => {
    const raw = '{"body":"熱伝導率は $\\kappa = \\alpha \\cdot C_p$ で求める \\(x\\)"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseJsonLenient(raw)).toEqual({ body: "熱伝導率は $\\kappa = \\alpha \\cdot C_p$ で求める \\(x\\)" });
  });

  it("\\u の後が 16 進 4 桁でないときはバックスラッシュとして残す", () => {
    const raw = '{"body":"\\underline{x} と \\u00e9"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseJsonLenient(raw)).toEqual({ body: "\\underline{x} と é" });
  });

  it("文字列の中の生の改行・タブを読む", () => {
    const raw = '{"body":"## 要点\n\n- 1 行目\t値\n- 2 行目"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseJsonLenient(raw)).toEqual({ body: "## 要点\n\n- 1 行目\t値\n- 2 行目" });
  });

  it("文字列の外の空白や改行は触らない", () => {
    const raw = '{\n  "a": "x\ny",\n  "b": [1, 2]\n}';
    expect(parseJsonLenient(raw)).toEqual({ a: "x\ny", b: [1, 2] });
  });

  it("途中で切れた JSON は直さず、最初のエラーを投げる", () => {
    const raw = '{"body":"途中で切れた本文 \\alpha';
    expect(() => parseJsonLenient(raw)).toThrow(SyntaxError);
  });

  it("エスケープ済みの引用符で文字列の内外を取り違えない", () => {
    const raw = '{"body":"彼は \\"\\gamma 相\\" と呼ぶ","n":1}';
    expect(parseJsonLenient(raw)).toEqual({ body: '彼は "\\gamma 相" と呼ぶ', n: 1 });
  });

  it("JSON のエスケープに見える数式の命令（\\beta \\frac \\nu \\rho \\times）を制御文字にしない", () => {
    const raw = '{"body":"$\\alpha + \\beta = \\frac{1}{2}$、$\\nu \\times \\rho$、$\\tau_{c}$ と \\text{K}"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseJsonLenient(raw)).toEqual({
      body: "$\\alpha + \\beta = \\frac{1}{2}$、$\\nu \\times \\rho$、$\\tau_{c}$ と \\text{K}",
    });
  });

  it("修復に入っても、改行・タブのエスケープは改行・タブのまま読む", () => {
    const raw = '{"body":"## 要点\\n- $\\alpha$ は大きい\\nAl3V の値\\n\\tnumber of runs\\nnot shown"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseJsonLenient(raw)).toEqual({
      body: "## 要点\n- $\\alpha$ は大きい\nAl3V の値\n\tnumber of runs\nnot shown",
    });
  });

  it("repairJsonStringEscapes は正しい JSON を変えない", () => {
    const ok = '{"a":"x\\\\y\\n\\t\\/","b":"\\u3042"}';
    expect(repairJsonStringEscapes(ok)).toBe(ok);
  });
});

describe("parseSourceTopicReviserOutput（崩れた出力）", () => {
  it("数式のバックスラッシュを含む本文を捨てずに読む", () => {
    const out = '```json\n{"body":"## 要点\n格子熱伝導率は $\\kappa_{lat}$ [[source:pdf:1|κ]]"}\n```';
    expect(parseSourceTopicReviserOutput(out)).toEqual({
      body: "## 要点\n格子熱伝導率は $\\kappa_{lat}$ [[source:pdf:1|κ]]",
    });
  });
});
