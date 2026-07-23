// resolveMemoBlockLabel の挙動を担保する。
// テキスト系は本文抜粋、メディア系は caption → name の順、どちらも無ければ空文字。

import { describe, it, expect } from "vitest";
import { resolveMemoBlockLabel } from "./block-label";

describe("resolveMemoBlockLabel", () => {
  it("null / undefined は空文字", () => {
    expect(resolveMemoBlockLabel(null)).toBe("");
    expect(resolveMemoBlockLabel(undefined)).toBe("");
  });

  it("テキスト系ブロックは本文抜粋を返す", () => {
    const block = {
      type: "paragraph",
      content: [{ type: "text", text: "焼成温度を 900°C に上げると導電率が向上した", styles: {} }],
    };
    expect(resolveMemoBlockLabel(block)).toBe("焼成温度を 900°C に上げると導電率が向上した");
  });

  it("80 文字に切り詰める", () => {
    const block = {
      type: "paragraph",
      content: [{ type: "text", text: "あ".repeat(120), styles: {} }],
    };
    expect(resolveMemoBlockLabel(block)).toHaveLength(80);
  });

  it("画像ブロックは caption を優先する", () => {
    const block = {
      type: "image",
      content: undefined,
      props: { url: "https://example.com/x.png", name: "x.png", caption: "SEM 像 900°C" },
    };
    expect(resolveMemoBlockLabel(block)).toBe("SEM 像 900°C");
  });

  it("caption が無ければ name（ファイル名）を使う", () => {
    const block = {
      type: "image",
      content: undefined,
      props: { url: "https://example.com/x.png", name: "sem-900c.png", caption: "" },
    };
    expect(resolveMemoBlockLabel(block)).toBe("sem-900c.png");
  });

  it("テキストも caption も name も無ければ空文字", () => {
    const block = { type: "image", content: undefined, props: { url: "https://example.com/x.png" } };
    expect(resolveMemoBlockLabel(block)).toBe("");
  });
});
