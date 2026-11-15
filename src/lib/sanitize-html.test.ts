// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeHtmlFragment } from "./sanitize-html";

describe("sanitizeHtmlFragment（.docx プレビュー・監査 #36）", () => {
  it("Word のハイパーリンクの javascript: を外す", () => {
    const out = sanitizeHtmlFragment(`<p><a href="javascript:alert(document.domain)">See Table 1</a></p>`);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("See Table 1");
  });

  it("script / style / on* / iframe を落とす", () => {
    const out = sanitizeHtmlFragment(
      `<p onclick="x()">a</p><script>alert(1)</script><style>p{}</style><iframe src="https://e.example"></iframe><img src="x" onerror="alert(1)">`,
    );
    expect(out).not.toMatch(/script|style|iframe|onclick|onerror|<img/i);
    expect(out).toContain("<p>a</p>");
  });

  it("本文の構造（見出し・表・リスト・強調・画像 data:）は残す", () => {
    const out = sanitizeHtmlFragment(
      `<h1>T</h1><ul><li><strong>x</strong></li></ul><table><tbody><tr><td colspan="2">c</td></tr></tbody></table><img src="data:image/png;base64,AAAA" alt="a">`,
    );
    expect(out).toContain("<h1>T</h1>");
    expect(out).toContain("<strong>x</strong>");
    expect(out).toContain('colspan="2"');
    expect(out).toContain("data:image/png;base64,AAAA");
  });

  it("画像は data: / blob: だけ。http と javascript: の src は外す", () => {
    expect(sanitizeHtmlFragment(`<img src="https://t.example/x.png">`)).not.toContain("img");
    expect(sanitizeHtmlFragment(`<img src="javascript:alert(1)">`)).not.toContain("img");
    expect(sanitizeHtmlFragment(`<img src="blob:http://localhost/abc">`)).toContain("blob:");
  });

  it("http(s) と mailto と文書内アンカーは通す", () => {
    const out = sanitizeHtmlFragment(
      `<a href="https://example.com">a</a><a href="mailto:x@example.com">b</a><a href="#doc-1">c</a><a href="data:text/html,x">d</a>`,
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("mailto:x@example.com");
    expect(out).toContain('href="#doc-1"');
    expect(out).not.toContain("data:text/html");
  });

  it("SVG / math の mXSS 風入力", () => {
    const out = sanitizeHtmlFragment(`<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg><math><mi xlink:href="javascript:1">x</mi></math>`);
    expect(out).not.toMatch(/javascript:|svg|math/i);
  });
});

describe("sanitizeHtmlFragment の id（DOM クロバリング）", () => {
  it("__TAURI_INTERNALS__ などの id は落とし、脚注の id は残す", () => {
    const out = sanitizeHtmlFragment(`<a id="__TAURI_INTERNALS__">t</a><a id="process">u</a><a id="fn1">1</a>`);
    expect(out).not.toContain("__TAURI_INTERNALS__");
    expect(out).not.toContain('id="process"');
    expect(out).toContain('id="fn1"');
  });
});

describe("sanitizeHtmlFragment の脚注（mammoth の出力形）", () => {
  it("li の id と戻りリンクが残り、# リンクの飛び先が消えない", () => {
    const out = sanitizeHtmlFragment(
      `<p>本文<sup><a href="#doc-1-footnote-1" id="doc-1-footnote-ref-1">[1]</a></sup></p><ol><li id="doc-1-footnote-1"><p>注<a href="#doc-1-footnote-ref-1">↑</a></p></li></ol><dl><dt id="doc-1-comment-1">c</dt><dd>x</dd></dl>`,
    );
    expect(out).toContain('<li id="doc-1-footnote-1">');
    expect(out).toContain('href="#doc-1-footnote-1"');
    expect(out).toContain('id="doc-1-comment-1"');
  });
  it("li の id でも DOM クロバリングする名前は落とす", () => {
    const out = sanitizeHtmlFragment(`<ul><li id="process">x</li></ul>`);
    expect(out).not.toContain('id="process"');
  });
});
