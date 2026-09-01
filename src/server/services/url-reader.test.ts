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

  it("content-type が application/pdf なら code:'pdf' を付けて投げる（ルートが PdfViewer 表示へ回すシグナル）", async () => {
    stubFetch(200, { "content-type": "application/pdf" });
    await expect(fetchAsReaderArticle("https://example.com/paper.pdf")).rejects.toMatchObject({
      status: 400,
      code: "pdf",
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

  it("閉じタグの無い <iframe> / <object> も除去する（文字列置換だけだと素通りする形）", () => {
    const out = sanitizeReaderHtml(
      '<p>keep</p><iframe src="https://track.example.net/i.html">' +
        '<object data="https://track.example.net/o.svg">',
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("track.example.net");
    expect(out).toContain("<p>keep</p>");
  });
});

// 本文画像の扱い。WebView が本文の <img> をそのまま読むと、その都度そのホストの
// Cookie / Referer / 実 UA が乗った外部リクエストになる。ここで潰すのはその識別性と
// 明らかな計測ピクセルであって、リクエスト自体や送信元 IP ではない。
describe("sanitizeReaderHtml（本文メディア）", () => {
  const base = "https://example.com/article";
  const proxied = (u: string) => `/api/url/image-proxy?url=${encodeURIComponent(u)}`;

  it("https の img src を image-proxy 経由に書き換える", () => {
    const out = sanitizeReaderHtml('<img src="https://cdn.example.com/photo.jpg">', base);
    expect(out).toContain(`src="${proxied("https://cdn.example.com/photo.jpg")}"`);
    expect(out).not.toContain('src="https://cdn.example.com/photo.jpg"');
  });

  it("相対 src は baseUrl で絶対化してから書き換える", () => {
    const out = sanitizeReaderHtml('<img src="/hero.jpg">', base);
    expect(out).toContain(`src="${proxied("https://example.com/hero.jpg")}"`);
  });

  it("生き残った img に referrerpolicy=no-referrer と loading=lazy を付ける", () => {
    const out = sanitizeReaderHtml('<img src="https://cdn.example.com/photo.jpg">', base);
    expect(out).toContain('referrerpolicy="no-referrer"');
    expect(out).toContain('loading="lazy"');
  });

  it("width=1 / height=1 / width=0 の計測ピクセルを本文から削除する", () => {
    const out = sanitizeReaderHtml(
      '<p>a</p><img src="https://t.example.net/track.gif" width="1" height="1">' +
        '<img src="https://t.example.net/beacon.png" height="1">' +
        '<img src="https://t.example.net/zero.png" width="0" height="0">',
      base,
    );
    expect(out).not.toContain("track.gif");
    expect(out).not.toContain("beacon.png");
    expect(out).not.toContain("zero.png");
    expect(out).toContain("<p>a</p>");
  });

  it("spacer.gif / blank.png 等の汎用空画像を本文から削除する", () => {
    const out = sanitizeReaderHtml(
      '<img src="https://cdn.example.com/img/spacer.gif">' +
        '<img src="https://cdn.example.com/img/blank.png">' +
        '<img src="https://cdn.example.com/img/pixel.gif?id=42">' +
        '<img src="https://cdn.example.com/img/real.jpg">',
      base,
    );
    expect(out).not.toContain("spacer.gif");
    expect(out).not.toContain("blank.png");
    expect(out).not.toContain("pixel.gif");
    expect(out).toContain(proxied("https://cdn.example.com/img/real.jpg"));
  });

  it("srcset / sizes を削除する（ブラウザは srcset を src より優先するため）", () => {
    const out = sanitizeReaderHtml(
      '<img src="https://cdn.example.com/a.jpg" ' +
        'srcset="https://cdn.example.com/a.jpg 1x, https://cdn.example.com/a@2x.jpg 2x" sizes="100vw">',
      base,
    );
    expect(out).not.toContain("srcset");
    expect(out).not.toContain("sizes");
    expect(out).not.toContain("a@2x.jpg");
    expect(out).toContain(proxied("https://cdn.example.com/a.jpg"));
  });

  it("src が無く srcset だけの img は先頭候補を src に昇格させる", () => {
    const out = sanitizeReaderHtml(
      '<img srcset="https://cdn.example.com/w400.jpg 400w, https://cdn.example.com/w800.jpg 800w">',
      base,
    );
    expect(out).toContain(proxied("https://cdn.example.com/w400.jpg"));
    expect(out).not.toContain("srcset");
  });

  it("URL にカンマを含む srcset（imgix / Cloudinary 系）でも先頭候補を切り出せる", () => {
    const wide = "https://cdn.example.com/t_w_400,h_300,c_fill/photo.jpg";
    const out = sanitizeReaderHtml(
      `<img srcset="${wide} 400w, https://cdn.example.com/t_w_800,h_600,c_fill/photo.jpg 800w">`,
      base,
    );
    expect(out).toContain(proxied(wide));
  });

  it("<picture> の <source> を削除して <img> をフォールバックに残す", () => {
    const out = sanitizeReaderHtml(
      '<picture><source srcset="https://cdn.example.com/b.webp" type="image/webp">' +
        '<img src="https://cdn.example.com/b.jpg"></picture>',
      base,
    );
    expect(out).not.toContain("<source");
    expect(out).not.toContain("b.webp");
    expect(out).toContain(proxied("https://cdn.example.com/b.jpg"));
  });

  it("plain http の img は削除する（image-proxy を LAN 到達の踏み台にさせない）", () => {
    const out = sanitizeReaderHtml(
      '<p>keep</p><img src="http://192.168.1.1/admin?action=reboot">' +
        '<img src="http://cdn.example.com/legacy.jpg">',
      base,
    );
    expect(out).not.toContain("192.168.1.1");
    expect(out).not.toContain("legacy.jpg");
    expect(out).not.toContain("image-proxy");
    expect(out).toContain("<p>keep</p>");
  });

  it("data: URI のインライン画像はプロキシせずそのまま残す", () => {
    const out = sanitizeReaderHtml('<img src="data:image/gif;base64,R0lGODlh">', base);
    expect(out).toContain('src="data:image/gif;base64,R0lGODlh"');
    expect(out).not.toContain("image-proxy");
  });

  it("lazy-load の data-src を src に昇格させる（placeholder より実体を優先）", () => {
    const out = sanitizeReaderHtml(
      '<img src="https://cdn.example.com/img/spacer.gif" data-src="https://cdn.example.com/real.jpg">',
      base,
    );
    expect(out).toContain(proxied("https://cdn.example.com/real.jpg"));
    expect(out).not.toContain("spacer.gif");
  });

  it("src を持たない img は削除する（JS が走らないので永久に空のまま）", () => {
    const out = sanitizeReaderHtml('<p>text</p><img alt="nothing">', base);
    expect(out).not.toContain("<img");
    expect(out).toContain("<p>text</p>");
  });

  it("<video> / <audio> を削除する（poster が img-src の計測経路になるため）", () => {
    const out = sanitizeReaderHtml(
      '<p>body</p><video poster="https://tracker.example.net/p.jpg" src="https://cdn.example.com/v.mp4"></video>' +
        '<audio src="https://cdn.example.com/a.mp3"></audio>',
      base,
    );
    expect(out).not.toContain("<video");
    expect(out).not.toContain("<audio");
    expect(out).not.toContain("tracker.example.net");
    expect(out).toContain("<p>body</p>");
  });

  it("baseUrl 無しでも絶対 URL の img は書き換わり、相対 URL は落ちる", () => {
    const out = sanitizeReaderHtml('<img src="https://cdn.example.com/x.jpg"><img src="/rel.jpg">');
    expect(out).toContain(proxied("https://cdn.example.com/x.jpg"));
    expect(out).not.toContain("rel.jpg");
  });

  it("linkedom の往復で見出し・段落・日本語テキストが壊れない", () => {
    const out = sanitizeReaderHtml(
      "<h2>見出し</h2><p>本文の段落です。&amp; 記号も含む。</p><ul><li>項目</li></ul>",
      base,
    );
    expect(out).toContain("<h2>見出し</h2>");
    expect(out).toContain("本文の段落です。");
    expect(out).toContain("&amp; 記号も含む。");
    expect(out).toContain("<li>項目</li>");
  });

  it("<track> / <meta> を削除する（孤児 track と http-equiv=refresh を残さない）", () => {
    const out = sanitizeReaderHtml(
      '<p>body</p><track src="https://track.example.net/t.vtt" kind="captions">' +
        '<meta http-equiv="refresh" content="0;url=https://track.example.net/r">',
      base,
    );
    expect(out).not.toContain("<track");
    expect(out).not.toContain("<meta");
    expect(out).not.toContain("track.example.net");
    expect(out).toContain("<p>body</p>");
  });

  it("extractReaderFromHtml 経由でも本文画像がプロキシ経由になる", () => {
    const html = ARTICLE_HTML.replace(
      "<h1>How Provenance Shapes Knowledge</h1>",
      '<h1>How Provenance Shapes Knowledge</h1><img src="https://cdn.example.com/hero.jpg" alt="hero">' +
        '<img src="https://t.example.net/px.gif" width="1" height="1">',
    );
    const article = extractReaderFromHtml(html, "https://example.com/article");
    expect(article.content).toContain(proxied("https://cdn.example.com/hero.jpg"));
    expect(article.content).not.toContain("px.gif");
    // leadImage は sanitize 前の生 content から取るので元の URL のまま
    expect(article.leadImage).toBe("https://cdn.example.com/hero.jpg");
  });
});

// インライン SVG の外部参照。Readability は svg サブツリーをほぼ素通しする
// （_cleanStyles が svg で早期 return するので style 属性も残る）ため、
// <img> だけを見ていた頃はここが丸ごと抜け道になっていた。
describe("sanitizeReaderHtml（インライン SVG）", () => {
  const base = "https://example.com/article";
  const proxied = (u: string) => `/api/url/image-proxy?url=${encodeURIComponent(u)}`;

  it("SVG <image href> を image-proxy 経由に書き換える（src ではなく href に書く）", () => {
    const out = sanitizeReaderHtml(
      '<svg width="600" height="300"><image href="https://cdn.example.com/figure.png" width="600" height="300"/></svg>',
      base,
    );
    expect(out).toContain(`href="${proxied("https://cdn.example.com/figure.png")}"`);
    expect(out).not.toContain('href="https://cdn.example.com/figure.png"');
    expect(out).toContain("<svg");
  });

  it("SVG <image xlink:href>（SVG 1.1 形式）も書き換える", () => {
    const out = sanitizeReaderHtml(
      '<svg width="600" height="300"><image xlink:href="https://cdn.example.com/legacy.png" width="600" height="300"/></svg>',
      base,
    );
    expect(out).toContain(`href="${proxied("https://cdn.example.com/legacy.png")}"`);
    expect(out).not.toContain("xlink:href");
  });

  it("href と xlink:href が両方あるとき xlink 側を残さない（古い実装の迂回を塞ぐ）", () => {
    const out = sanitizeReaderHtml(
      '<svg width="600" height="300"><image href="https://cdn.example.com/ok.png" ' +
        'xlink:href="https://track.example.net/legacy.png" width="600" height="300"/></svg>',
      base,
    );
    expect(out).toContain(`href="${proxied("https://cdn.example.com/ok.png")}"`);
    expect(out).not.toContain("track.example.net");
  });

  it("SVG <image> にも計測ピクセル判定と https 限定を適用する", () => {
    const out = sanitizeReaderHtml(
      '<p>keep</p><svg><image href="https://track.example.net/px.png" width="1" height="1"/></svg>' +
        '<svg><image href="https://cdn.example.com/img/spacer.gif" width="600" height="300"/></svg>' +
        '<svg><image href="http://192.168.1.1/admin" width="600" height="300"/></svg>',
      base,
    );
    expect(out).not.toContain("px.png");
    expect(out).not.toContain("spacer.gif");
    expect(out).not.toContain("192.168.1.1");
    expect(out).not.toContain("<image");
    expect(out).toContain("<p>keep</p>");
  });

  it("SVG <image> の相対 href は baseUrl で絶対化し、data: はそのまま残す", () => {
    const out = sanitizeReaderHtml(
      '<svg><image href="/figure.png" width="600" height="300"/></svg>' +
        '<svg><image href="data:image/gif;base64,R0lGODlh" width="600" height="300"/></svg>',
      base,
    );
    expect(out).toContain(`href="${proxied("https://example.com/figure.png")}"`);
    expect(out).toContain('href="data:image/gif;base64,R0lGODlh"');
  });

  it("<use> / <feImage> の外部参照は属性ごと落とし、同一文書内の #id 参照は残す", () => {
    const out = sanitizeReaderHtml(
      '<svg><use href="https://track.example.net/sprite.svg#i"/>' +
        '<use xlink:href="https://track.example.net/old.svg#i"/>' +
        '<filter id="f"><feImage href="https://track.example.net/fe.png"/></filter>' +
        '<use href="#local"/></svg>',
      base,
    );
    expect(out).not.toContain("track.example.net");
    expect(out).toContain('href="#local"');
  });

  it("svg 内の url(...) 属性は外部参照だけ落とす（Readability は svg の style を消さない）", () => {
    const out = sanitizeReaderHtml(
      '<svg><rect style="fill:url(https://track.example.net/paint.svg#p)" mask="url(https://track.example.net/m.svg#m)" fill="url(#local)"/>' +
        '<foreignObject><div style="background-image:url(https://track.example.net/bg.png)">x</div></foreignObject></svg>',
      base,
    );
    expect(out).not.toContain("track.example.net");
    expect(out).toContain('fill="url(#local)"');
  });

  // image-set() / image() は引数をベア文字列で書けるので、`url(` だけを見ていると
  // 素通りする。svg の中は Readability の _cleanStyles が早期 return するため
  // style 属性が生き残り、foreignObject 配下なら実際に描画されて取得が走る。
  it("svg 内の image-set() / image() のベア文字列も落とす", () => {
    const out = sanitizeReaderHtml(
      "<svg><foreignObject>" +
        '<span style="background-image:image-set(&quot;https://track.example.net/a.png&quot; 1x)">a</span>' +
        '<span style="background-image:-webkit-image-set(&quot;https://track.example.net/b.png&quot; 2x)">b</span>' +
        '<span style="background-image:image(&quot;https://track.example.net/c.png&quot;)">c</span>' +
        "</foreignObject></svg>",
      base,
    );
    expect(out).not.toContain("track.example.net");
  });

  // svg の外は Readability の _cleanStyles が style / background を落とすが、
  // それは実装依存なので sanitizeReaderHtml 単体でも落ちることを固定しておく。
  it("svg の外でも style の外部 url(...) と background 属性を落とす", () => {
    const out = sanitizeReaderHtml(
      '<div style="background-image:url(https://track.example.net/bg.png)">styled</div>' +
        '<table background="https://track.example.net/tb.png"><tr><td>cell</td></tr></table>',
      base,
    );
    expect(out).not.toContain("track.example.net");
    expect(out).toContain("styled");
    expect(out).toContain("<td>cell</td>");
  });

  it("svg 内の <a href> はクリック起点なので残す（本文の HTML リンクと同じ扱い）", () => {
    const out = sanitizeReaderHtml(
      '<svg><a href="https://example.org/source"><rect width="10" height="10"/></a></svg>',
      base,
    );
    expect(out).toContain('href="https://example.org/source"');
  });

  it("svg の外の <image> は src を見る（HTML パーサが <img> に読み替えるため）", () => {
    const out = sanitizeReaderHtml('<image src="https://cdn.example.com/legacy-spelling.png">', base);
    expect(out).toContain(`src="${proxied("https://cdn.example.com/legacy-spelling.png")}"`);
    expect(out).not.toContain('src="https://cdn.example.com/legacy-spelling.png"');
  });

  it("foreignObject の中の HTML <img> は従来どおり src をプロキシ経由にする", () => {
    const out = sanitizeReaderHtml(
      '<svg><foreignObject><img src="https://cdn.example.com/inner.png"></foreignObject></svg>',
      base,
    );
    expect(out).toContain(`src="${proxied("https://cdn.example.com/inner.png")}"`);
  });

  it("外部参照を持たないインライン SVG（アイコン・図版）はそのまま残る", () => {
    const out = sanitizeReaderHtml(
      '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#333"/></svg>',
      base,
    );
    expect(out).toContain('d="M0 0h10v10z"');
    expect(out).toContain('fill="#333"');
  });

  // 再現ケースそのもの: 実物の extractReaderFromHtml() を通して、記事本文に紛れた
  // <svg><image href="https://track…"> が Readability + sanitize を素通りしないことを固定する。
  it("記事全体を通しても SVG <image> の外部 URL は content に残らない", () => {
    const html = ARTICLE_HTML.replace(
      "<h1>How Provenance Shapes Knowledge</h1>",
      "<h1>How Provenance Shapes Knowledge</h1>" +
        '<svg width="600" height="300"><image href="https://track.example.com/s.png" width="600" height="300"/></svg>',
    );
    const article = extractReaderFromHtml(html, "https://example.com/article");
    expect(article.content).not.toContain("https://track.example.com/s.png");
    expect(article.content).toContain(proxied("https://track.example.com/s.png"));
    // 本文テキストは壊れていない
    expect(article.textContent).toContain("Provenance is not metadata");
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
