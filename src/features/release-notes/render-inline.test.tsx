// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderInline } from "./index";

describe("リリースノートの本文リンク（監査 #107）", () => {
  it("javascript: はリンクにせず文字として出す", () => {
    const html = renderToStaticMarkup(<p>{renderInline("[詳細](javascript:alert(1))", "k")}</p>);
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("詳細");
  });

  it("https はリンクになる", () => {
    const html = renderToStaticMarkup(<p>{renderInline("[詳細](https://example.com/x)", "k")}</p>);
    expect(html).toContain('href="https://example.com/x"');
  });
});
