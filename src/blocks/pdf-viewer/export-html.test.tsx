import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PdfExportHtml } from "./export-html";

const render = (url: string, name?: string) =>
  renderToStaticMarkup(<PdfExportHtml url={url} name={name} />);

describe("PdfExportHtml（toExternalHTML の描画）", () => {
  it("javascript: の url では <a> を出さず文字だけ出す", () => {
    const html = render("javascript:alert(1)", "危険");
    expect(html).not.toContain("<a");
    expect(html).toContain("危険");
  });
  it("http(s) と内部参照は <a href> になる", () => {
    expect(render("https://example.com/a.pdf", "論文")).toContain('<a href="https://example.com/a.pdf">論文</a>');
    expect(render("local-media://abc", "手元")).toContain('<a href="local-media://abc">手元</a>');
  });
  it("url が空なら空の段落", () => {
    expect(render("")).toBe("<p></p>");
  });
});
