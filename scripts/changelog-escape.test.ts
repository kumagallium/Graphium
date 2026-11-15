import { describe, expect, it } from "vitest";
// @ts-expect-error 型宣言の無い .mjs（マニュアルのビルドと共用）
import { escapeChangelogHtml, inlineEscapedChangelog } from "./changelog-escape.mjs";

const INCLUDE_RE = /<!--\s*@include:\s*(.*?)\s*-->/;

/** エスケープ → include 展開と同じ経路 → markdown-it で描画する */
async function render(changelog: string): Promise<string> {
  const { createMarkdownRenderer } = await import("vitepress");
  const md = await createMarkdownRenderer(process.cwd(), { html: true } as never);
  const src = inlineEscapedChangelog("<!--@include: ../CHANGELOG.md{1,}-->", () => changelog);
  return md.render(src);
}

/** タグを除き、文字参照を戻した表示テキスト */
function textOf(html: string): string {
  const dec = (t: string) =>
    t
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&");
  return dec(html.replace(/<[^>]*>/g, ""));
}

describe("changelog-escape", () => {
  it("コードの外の生 HTML を無害化する", () => {
    const out = escapeChangelogHtml(`- <img src=x onerror="alert(1)"> by @u`);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("コードスパンは <code v-pre> にし、中身を文字参照にする", () => {
    expect(escapeChangelogHtml("- fix `<sup>` {a} <b>x</b>")).toBe(
      "- fix <code v-pre>&lt;sup&gt;</code> &#123;a&#125; &lt;b>x&lt;/b>",
    );
    expect(escapeChangelogHtml("- ``a ` <b>`` <i>")).toBe(
      "- <code v-pre>a &#96; &lt;b&gt;</code> &lt;i>",
    );
  });

  it("閉じないバッククォートは \\` にする", () => {
    expect(escapeChangelogHtml("- a ` b")).toBe("- a \\` b");
    expect(escapeChangelogHtml("- `` a ``` <b> `` <i>")).toBe(
      "- <code v-pre>a &#96;&#96;&#96; &lt;b&gt;</code> &lt;i>",
    );
  });

  it("\\< は &lt; にする（バックスラッシュは落とす）", () => {
    expect(escapeChangelogHtml("- a \\<b> c")).toBe("- a &lt;b> c");
  });

  it("行頭のフェンス記号は \\ でエスケープする", () => {
    expect(escapeChangelogHtml("```<b>\n<i>\n```")).toBe(
      "\\`\\`\\`&lt;b>\n&lt;i>\n\\`\\`\\`",
    );
    expect(escapeChangelogHtml("- ~~~ x")).toBe("- \\~~~ x");
  });

  it("include の記法が VitePress の正規表現に合う形で残らない", async () => {
    const lines = [
      "* fix `<!--@include: ../../../../../../etc/hosts-->` by @x",
      "* <!--@include: /etc/hosts-->",
      "* \\<!--  @include:  x -->",
      "* `` `<!--@include: a-->` ``",
      "* ``<!--@include: a-->",
    ];
    for (const line of lines) {
      expect(escapeChangelogHtml(line)).not.toMatch(INCLUDE_RE);
    }
    const html = await render(lines[0]);
    expect(textOf(html)).toContain("<!--@include: ../../../../../../etc/hosts-->");
    expect(html).not.toMatch(INCLUDE_RE);
  });

  it("属性の差し込み記法で属性が付かない", async () => {
    const srcs = [
      "* **bold**{onclick=alert(1)} by @x",
      "* [a](http://x){onclick=alert(1)}",
      "* `a`{onclick=alert(1)}",
      "## [v1] title {onclick=alert(1)}",
      "* title\n{onclick=alert(1)}",
      "* a {.x onclick=alert(1)} b",
    ];
    for (const s of srcs) {
      expect(await render(s)).not.toMatch(/<[^>]*\sonclick\s*=/i);
    }
  });

  it("フェンスにさせず、要素が出ない", async () => {
    const srcs = [
      "- ~~~`<img\tsrc\ta=1\tonerror=alert(1)>",
      "- ```\\<img\tsrc\ta=1\tonerror=alert(1)>",
      "  1. > ```<img\tsrc\ta=1\tonerror=alert(1)>",
      "```<img\tsrc\ta=1\tonerror=alert(1)>\nx\n```",
      "para\n\n``` a`b\n<img src=x onerror=alert(1)>",
      "para line\n    ```\n<img src=x onerror=alert(1)>",
    ];
    for (const s of srcs) {
      expect(await render(s)).not.toContain("<img");
    }
  });

  it("コードスパンの外の生 HTML は要素にならない（長さ違いの攻撃も）", async () => {
    const html = await render(
      "- `` <img src=x onerror=alert(1)> ```\n- ` <img src=x onerror=alert(2)> ``\n- <b>y</b>",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });

  it("Vue の補間が評価されない", async () => {
    const html = await render("- {{ constructor.constructor('alert(1)')() }} `{{ x }}`");
    expect(html).not.toContain("{{");
    expect(html).toContain("v-pre");
  });

  it("見出しとリンクは描画される", async () => {
    const html = await render(
      "## [1.2.3](https://github.com/o/r/compare/v1...v2) (2026-01-01)\n\n- fix ([#12](https://github.com/o/r/pull/12)) by @user",
    );
    expect(html).toContain("<h2");
    expect(html).toContain('href="https://github.com/o/r/pull/12"');
  });

  it("画像構文（インライン・参照形式）は <img を出さない", async () => {
    const html = await render(
      "- ![a](https://evil.example/x.png) と ![b][r] と [#1](https://github.com/o/r/pull/1)\n\n[r]: https://evil.example/y.png",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://github.com/o/r/pull/1"');
  });

  it("コードスパン内の ![ はそのまま表示される", async () => {
    const html = await render("- `![a](x)`");
    expect(html).not.toContain("<img");
    expect(textOf(html)).toContain("![a](x)");
  });

  it("include を、指定行からのエスケープ済み本文に置き換える", () => {
    const src = "intro\n<!--@include: ../../CHANGELOG.md{3,}-->\n";
    const out = inlineEscapedChangelog(src, () => "# Changelog\n\n- <script>x</script> a");
    expect(out).toBe("intro\n::: v-pre\n- &lt;script>x&lt;/script> a\n:::\n");
  });
});
