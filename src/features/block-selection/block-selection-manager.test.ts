import { describe, it, expect } from "vitest";
import { buildSelectionHighlightCss } from "./block-selection-manager";

describe("buildSelectionHighlightCss", () => {
  it("2 ブロック未満では何も出さない", () => {
    expect(buildSelectionHighlightCss([], new Set())).toBe("");
    expect(buildSelectionHighlightCss(["a"], new Set())).toBe("");
  });

  it("画像・動画には中身の上に色を重ね、枠を付ける", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set());
    expect(css).toContain(
      `[data-id="b"][data-node-type="blockOuter"] > .bn-block > .bn-block-content .bn-visual-media-wrapper::after`,
    );
    expect(css).toContain(
      `[data-id="a"][data-node-type="blockOuter"] > .bn-block > .bn-block-content .bn-visual-media-wrapper,`,
    );
  });

  it("文字を持たないブロックは React 描画（.react-renderer）の 3 段構造でも枠を付ける", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set());
    expect(css).toContain(
      `[data-id="a"][data-node-type="blockOuter"] > .bn-block > .react-renderer > .bn-block-content:not(:has(.bn-inline-content)):not(:has(.bn-visual-media-wrapper)) > *`,
    );
  });

  it("子ブロックの中身は巻き込まない（自分の中身は直下の子結合子で指す）", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set());
    expect(css).not.toMatch(/blockOuter"\] \.bn-block-content/);
  });

  it("名前付きの表だけキャプション行まで塗る", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set(["b"]));
    expect(css).toContain(`[data-id="b"][data-node-type="blockOuter"]::before`);
    expect(css).not.toContain(`[data-id="a"][data-node-type="blockOuter"]::before`);
  });
});

describe("buildSelectionHighlightCss のブロック選択（矩形選択）", () => {
  it("文字の上をドラッグした選択では文字の選択色を残し、塗りは薄いまま", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set());
    expect(css).not.toContain("::selection");
    expect(css).toContain("rgba(75, 122, 82, 0.05)");
  });

  it("ブロック選択では選んだブロックの文字の選択色を消し、ブロック全体を濃く塗る", () => {
    const css = buildSelectionHighlightCss(["a", "b"], new Set(), true);
    expect(css).toContain(`[data-id="a"][data-node-type="blockOuter"] *::selection`);
    expect(css).toContain(`[data-id="b"][data-node-type="blockOuter"] *::selection`);
    expect(css).toContain("var(--color-primary) 12%");
    expect(css).not.toContain("rgba(75, 122, 82, 0.05)");
  });
});
