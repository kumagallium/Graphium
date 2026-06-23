import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractReaderFromHtml,
  sanitizeReaderHtml,
  extractLeadImage,
  getCachedReaderArticle,
  setCachedReaderArticle,
  clearReaderCache,
  fetchAsReaderArticle,
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

describe("fetchAsReaderArticle (bot protection)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(status: number, headers: Record<string, string>) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status, headers }) as Response,
    );
  }

  it("Cloudflare の cf-mitigated: challenge を「ボット保護」と説明する", async () => {
    stubFetch(403, { "cf-mitigated": "challenge", server: "cloudflare" });
    await expect(fetchAsReaderArticle("https://blocked.example.com/a")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("bot protection"),
    });
  });

  it("server: cloudflare + 403 でもボット保護として扱う（cf-mitigated 無し）", async () => {
    stubFetch(403, { server: "cloudflare" });
    await expect(fetchAsReaderArticle("https://blocked.example.com/b")).rejects.toMatchObject({
      message: expect.stringContaining("bot protection"),
    });
  });

  it("ボット保護でない通常の 403 は従来どおり Fetch failed メッセージ", async () => {
    stubFetch(403, { server: "nginx" });
    await expect(fetchAsReaderArticle("https://plain.example.com/c")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Fetch failed: 403"),
    });
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

describe("extractLeadImage", () => {
  const base = "https://example.com/article";

  it("先頭の意味ある img を絶対 URL で返す", () => {
    const html = '<p>intro</p><img src="/hero.jpg" alt="hero"><p>body</p>';
    expect(extractLeadImage(html, base)).toBe("https://example.com/hero.jpg");
  });

  it("width=1 / height=1 の tracker pixel をスキップ", () => {
    const html =
      '<img src="https://t.example.net/pixel.gif" width="1" height="1">' +
      '<img src="https://cdn.example.com/photo.jpg">';
    expect(extractLeadImage(html, base)).toBe("https://cdn.example.com/photo.jpg");
  });

  it("data: URI をスキップ", () => {
    const html =
      '<img src="data:image/gif;base64,R0lGODlh">' +
      '<img src="https://cdn.example.com/photo.jpg">';
    expect(extractLeadImage(html, base)).toBe("https://cdn.example.com/photo.jpg");
  });

  it("blank.gif / spacer.gif / pixel.gif をスキップ", () => {
    const html =
      '<img src="/img/spacer.gif">' +
      '<img src="/img/blank.png">' +
      '<img src="/img/real.jpg">';
    expect(extractLeadImage(html, base)).toBe("https://example.com/img/real.jpg");
  });

  it("data-src / data-original の lazy-load 形式も拾う", () => {
    const html = '<img data-src="/lazy.jpg" alt="lazy">';
    expect(extractLeadImage(html, base)).toBe("https://example.com/lazy.jpg");
  });

  it("img が無ければ null", () => {
    expect(extractLeadImage("<p>no images here</p>", base)).toBeNull();
  });

  it("不正な src（javascript: 等）はスキップ", () => {
    const html =
      '<img src="javascript:alert(1)">' + '<img src="https://cdn.example.com/photo.jpg">';
    expect(extractLeadImage(html, base)).toBe("https://cdn.example.com/photo.jpg");
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
