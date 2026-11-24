import { describe, expect, it } from "vitest";
import { codeBlockOptions } from "@blocknote/code-block";
import { CODE_LANGUAGES, normalizeCodeLanguage } from "./code-language";

describe("normalizeCodeLanguage", () => {
  it("描けるキーはそのまま返す", () => {
    expect(normalizeCodeLanguage("text")).toBe("text");
    expect(normalizeCodeLanguage("shellscript")).toBe("shellscript");
    expect(normalizeCodeLanguage("json")).toBe("json");
  });

  it("別名をキーに寄せる", () => {
    expect(normalizeCodeLanguage("bash")).toBe("shellscript");
    expect(normalizeCodeLanguage("sh")).toBe("shellscript");
    expect(normalizeCodeLanguage("zsh")).toBe("shellscript");
    expect(normalizeCodeLanguage("js")).toBe("javascript");
    expect(normalizeCodeLanguage("ts")).toBe("typescript");
    expect(normalizeCodeLanguage("yml")).toBe("yaml");
    expect(normalizeCodeLanguage("py")).toBe("python");
    expect(normalizeCodeLanguage("console")).toBe("shellscript");
  });

  it("当てはまらない名前は text にする", () => {
    expect(normalizeCodeLanguage("env")).toBe("text");
    expect(normalizeCodeLanguage("dockerfile")).toBe("text");
    expect(normalizeCodeLanguage("no-such-language")).toBe("text");
  });

  it("大文字小文字・空白・空・文字列でない値を受ける", () => {
    expect(normalizeCodeLanguage(" Bash ")).toBe("shellscript");
    expect(normalizeCodeLanguage("JSON")).toBe("json");
    expect(normalizeCodeLanguage("")).toBe("text");
    expect(normalizeCodeLanguage(undefined)).toBe("text");
    expect(normalizeCodeLanguage(null)).toBe("text");
    expect(normalizeCodeLanguage(3)).toBe("text");
  });

  it("返す値は必ずエディタが描けるキー（BlockNote が throw しない）", () => {
    const supported = codeBlockOptions.supportedLanguages ?? {};
    for (const input of ["bash", "sh", "env", "js", "golang", "tex", "svg", "x", ""]) {
      expect(normalizeCodeLanguage(input) in supported).toBe(true);
    }
  });
});

describe("CODE_LANGUAGES は BlockNote の表と同じ", () => {
  // BlockNote を上げて言語が増減したら、ここが落ちる。code-language.ts の表を合わせる
  it("キーと別名が一致する", () => {
    const supported = codeBlockOptions.supportedLanguages ?? {};
    const theirs = Object.fromEntries(
      Object.entries(supported).map(([k, v]) => [k, [...((v as { aliases?: string[] }).aliases ?? [])]]),
    );
    const ours = Object.fromEntries(Object.entries(CODE_LANGUAGES).map(([k, v]) => [k, [...v]]));
    expect(ours).toEqual(theirs);
  });
});
