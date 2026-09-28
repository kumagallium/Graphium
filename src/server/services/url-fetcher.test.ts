import { describe, it, expect } from "vitest";
import { extractFromHtml } from "./url-fetcher";

describe("extractFromHtml", () => {
  it("<title> からタイトルを抽出する", () => {
    const html = "<html><head><title>Page Title</title></head><body><p>body</p></body></html>";
    const { title } = extractFromHtml(html);
    expect(title).toBe("Page Title");
  });

  it("OGP タイトルが存在すれば <title> より優先する", () => {
    const html = `
      <html><head>
        <title>Page Title</title>
        <meta property="og:title" content="OG Title" />
      </head><body><p>body</p></body></html>
    `;
    const { title } = extractFromHtml(html);
    expect(title).toBe("OG Title");
  });

  it("og:description / meta description を拾う", () => {
    const html = `
      <html><head>
        <meta property="og:description" content="OG desc" />
        <meta name="description" content="meta desc" />
      </head></html>
    `;
    const { description } = extractFromHtml(html);
    expect(description).toBe("OG desc");
  });

  it("空白だけの description は trim して空文字にする（title と同じ扱いに揃える）", () => {
    const html = `
      <html><head>
        <meta property="og:description" content="   " />
      </head></html>
    `;
    const { description } = extractFromHtml(html);
    expect(description).toBe("");
  });

  it("script / style / nav / header / footer を除去する", () => {
    const html = `
      <html><head><title>T</title></head>
      <body>
        <nav>NAV CONTENT</nav>
        <header>HEADER CONTENT</header>
        <script>var x = 1;</script>
        <style>.a{color:red}</style>
        <main>Main Text</main>
        <footer>FOOTER CONTENT</footer>
      </body></html>
    `;
    const { text } = extractFromHtml(html);
    expect(text).not.toContain("NAV CONTENT");
    expect(text).not.toContain("HEADER CONTENT");
    expect(text).not.toContain("FOOTER CONTENT");
    expect(text).not.toContain("var x");
    expect(text).not.toContain(".a{color");
    expect(text).toContain("Main Text");
  });

  it("HTML エンティティをデコードする", () => {
    const html = "<html><body><p>Tom &amp; Jerry &lt;3</p></body></html>";
    const { text } = extractFromHtml(html);
    expect(text).toContain("Tom & Jerry <3");
  });

  it("本文が maxTextChars を超えたら truncate マーカー付きで切り詰める", () => {
    const body = "x".repeat(200);
    const html = `<html><body><p>${body}</p></body></html>`;
    const { text } = extractFromHtml(html, 50);
    expect(text.length).toBeLessThanOrEqual(100); // 50 chars + marker
    expect(text).toContain("[... truncated]");
  });
});
