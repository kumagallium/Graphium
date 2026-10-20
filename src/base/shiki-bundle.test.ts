// shiki-bundle.ts の言語表が @blocknote/code-block の codeBlockOptions と揃っていることの検査。
// BlockNote を上げて supportedLanguages に言語が増えると、ここで漏れが分かる
// （漏れた言語はハイライトされず、黙って素のテキストになる）。
import { describe, it, expect } from "vitest";
import { codeBlockOptions } from "@blocknote/code-block";
import { SHIKI_LANGS } from "./shiki-bundle";

describe("shiki-bundle の言語表", () => {
  it("codeBlockOptions.supportedLanguages の言語とエイリアスを全て持つ（text 系を除く）", () => {
    // ハイライトしない語（core の SyntaxHighlighting が素通しにする）
    const plain = new Set(["text", "txt", "plain", "plaintext", "none"]);
    const missing: string[] = [];
    for (const [id, def] of Object.entries(codeBlockOptions.supportedLanguages)) {
      const names = [id, ...((def as { aliases?: string[] }).aliases ?? [])];
      for (const name of names) {
        if (plain.has(name)) continue;
        if (!(name in SHIKI_LANGS)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("言語表の読み込み関数は langs-precompiled を指す", () => {
    for (const [name, load] of Object.entries(SHIKI_LANGS)) {
      expect(typeof load, name).toBe("function");
    }
    expect(Object.keys(SHIKI_LANGS).length).toBeGreaterThan(50);
  });
});
