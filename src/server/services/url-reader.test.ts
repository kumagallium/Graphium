import { describe, it, expect, beforeEach } from "vitest";
import {
  extractReaderFromHtml,
  sanitizeReaderHtml,
  getCachedReaderArticle,
  setCachedReaderArticle,
  clearReaderCache,
} from "./url-reader";

const ARTICLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>How Provenance Shapes Knowledge</title>
    <meta property="og:title" content="How Provenance Shapes Knowledge" />
    <meta name="author" content="Jane Doe" />
    <meta property="og:site_name" content="Example Blog" />
  </head>
  <body>
    <nav>Site Navigation</nav>
    <header>Top banner</header>
    <article>
      <h1>How Provenance Shapes Knowledge</h1>
      <p>Provenance is not metadata. It is the substance of how knowledge is built up over time, paragraph by paragraph, decision by decision, from messy lab notes into stable theorems.</p>
      <p>If you cannot trace a claim back to the act that produced it, you do not have knowledge. You have folklore decorated with citations.</p>
      <p>This article argues that progressive disclosure is the only way to make this tractable for human readers, who can hold maybe seven things in working memory at a time.</p>
      <p>The rest of this piece walks through three layers of labels we have settled on after eighteen months of iteration in Graphium.</p>
    </article>
    <footer>Site footer</footer>
  </body>
</html>`;

describe("extractReaderFromHtml", () => {
  it("Readability で本文を抽出してタイトルを返す", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/article");
    expect(article.title).toBe("How Provenance Shapes Knowledge");
    expect(article.textContent).toContain("Provenance is not metadata");
    expect(article.textContent).toContain("progressive disclosure");
  });

  it("nav / header / footer は本文 textContent に含まれない", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/article");
    expect(article.textContent).not.toContain("Site Navigation");
    expect(article.textContent).not.toContain("Top banner");
    expect(article.textContent).not.toContain("Site footer");
  });

  it("siteName と lang を返す", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/article");
    expect(article.siteName).toBe("Example Blog");
    expect(article.lang).toBe("en");
  });

  it("byline を返す（meta[name=author] から）", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/article");
    expect(article.byline).toBe("Jane Doe");
  });

  it("content (HTML) と textContent の両方を返す", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/article");
    expect(article.content.length).toBeGreaterThan(0);
    expect(article.textContent.length).toBeGreaterThan(0);
    expect(article.content).toContain("<p");
    expect(article.textContent).not.toContain("<p");
  });

  it("本文が抽出不能な HTML では 422 を throw する", () => {
    // 本文要素がなく、Readability が null か空 content を返す形
    const empty = "<html><head><title>T</title></head><body></body></html>";
    let caught: unknown = null;
    try {
      extractReaderFromHtml(empty, "https://example.com/x");
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    const err = caught as { status: number; message: string };
    expect(err.status).toBe(422);
  });
});

describe("sanitizeReaderHtml", () => {
  it("<script> を除去する", () => {
    const out = sanitizeReaderHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("on* イベント属性を除去する", () => {
    const out = sanitizeReaderHtml('<a href="x" onclick="alert(1)">link</a>');
    expect(out).not.toContain("onclick");
  });

  it("javascript: URL を # に置換する", () => {
    const out = sanitizeReaderHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).toContain('href="#"');
    expect(out).not.toContain("javascript:");
  });

  it("通常のテキスト・段落構造は保持する", () => {
    const out = sanitizeReaderHtml("<h2>Heading</h2><p>Body paragraph.</p>");
    expect(out).toContain("<h2>Heading</h2>");
    expect(out).toContain("<p>Body paragraph.</p>");
  });

  it("<iframe> / <object> / <embed> / <link> も除去する", () => {
    const out = sanitizeReaderHtml(
      '<iframe src="x"></iframe><object data="y"></object><embed src="z"><link rel="stylesheet" href="w">',
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("<embed");
    expect(out).not.toContain("<link");
  });
});

describe("reader cache (LRU)", () => {
  beforeEach(() => {
    clearReaderCache();
  });

  it("set / get が動く", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/x");
    setCachedReaderArticle("https://example.com/x", article);
    const cached = getCachedReaderArticle("https://example.com/x");
    expect(cached?.title).toBe(article.title);
  });

  it("未登録 URL は null を返す", () => {
    expect(getCachedReaderArticle("https://example.com/missing")).toBeNull();
  });

  it("LRU で 256 件超過時に古いものから捨てる", () => {
    const article = extractReaderFromHtml(ARTICLE_HTML, "https://example.com/seed");
    // 256 件埋める
    for (let i = 0; i < 256; i++) {
      setCachedReaderArticle(`https://example.com/p${i}`, article);
    }
    // 257 件目を追加
    setCachedReaderArticle("https://example.com/new", article);
    // 最古 (p0) は捨てられている
    expect(getCachedReaderArticle("https://example.com/p0")).toBeNull();
    // 新しいものは残っている
    expect(getCachedReaderArticle("https://example.com/new")).not.toBeNull();
  });
});
