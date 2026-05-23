import { describe, it, expect } from "vitest";
import { buildTextFragment, buildHashFragment } from "./text-fragment";

describe("buildTextFragment", () => {
  it("短い選択をそのまま textStart として返す", () => {
    const fragment = buildTextFragment(
      "Provenance is the substance",
      "Provenance is the substance of knowledge. Other text follows.",
    );
    expect(fragment).toBe("text=Provenance%20is%20the%20substance");
  });

  it("空文字は undefined を返す", () => {
    expect(buildTextFragment("", "anything")).toBeUndefined();
    expect(buildTextFragment("   ", "anything")).toBeUndefined();
  });

  it("選択が長文の場合は textStart,textEnd で挟む", () => {
    const longSelection =
      "Sintering of copper powders proceeds via three distinct stages: initial neck formation, intermediate densification, and final pore elimination.";
    const fragment = buildTextFragment(longSelection, longSelection);
    expect(fragment).toBeDefined();
    // start と end の 2 値が , で連結される
    expect(fragment).toMatch(/^text=[^,]+,[^,]+$/);
    expect(fragment).toContain(encodeURIComponent("Sintering"));
  });

  it("同じテキストが複数出現する場合は prefix-/-suffix で曖昧性を解消", () => {
    // 最初の出現の前後にコンテキストがあるように padding を付ける
    const fullText =
      "Some intro text Foo bar baz appears here. Then later: Foo bar baz again. And finally Foo bar baz at end.";
    const fragment = buildTextFragment("Foo bar baz", fullText);
    expect(fragment).toBeDefined();
    // 形式: text=<prefix>-,<selection>,-<suffix>
    // 区切り `-,` と `,-` は構文要素なので literal で含まれる
    expect(fragment).toContain("-,");
    expect(fragment).toContain(",-");
    expect(fragment).toContain("Foo%20bar%20baz");
  });

  it("出現が 1 つだけなら prefix/suffix を付けない", () => {
    const fragment = buildTextFragment(
      "unique phrase",
      "Some text containing a unique phrase only once.",
    );
    expect(fragment).toBe("text=unique%20phrase");
  });

  it("選択が fullText に出現しない場合もそのまま返す（normalize ズレ耐性）", () => {
    const fragment = buildTextFragment("selected", "no match here");
    expect(fragment).toBe("text=selected");
  });

  it("空白を正規化する（改行・連続スペースをスペース 1 つに）", () => {
    const fragment = buildTextFragment("foo\n\nbar  baz", "foo bar baz qux");
    expect(fragment).toBe("text=foo%20bar%20baz");
  });

  it("特殊文字 (`,`, `-`, `&`) をエスケープする", () => {
    const fragment = buildTextFragment("a,b-c&d", "a,b-c&d unique");
    // %2C = , / %2D = - / %26 = &
    expect(fragment).toContain("%2C");
    expect(fragment).toContain("%2D");
    expect(fragment).toContain("%26");
  });
});

describe("buildHashFragment", () => {
  it("`#:~:text=...` 形式の完全な hash を返す", () => {
    const hash = buildHashFragment("hello", "hello world");
    expect(hash).toBe("#:~:text=hello");
  });

  it("空文字なら undefined", () => {
    expect(buildHashFragment("", "x")).toBeUndefined();
  });
});
