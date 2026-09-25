// rehypeSupSub のテスト。
//
// チャット画面と同じ組み合わせ（remark-gfm + このプラグイン）で ReactMarkdown に通し、
// 出てきた HTML を見る。raw ノードを文字に戻すのは react-markdown 自身なので、
// 「要素にならなかったタグが文字として残る」ところまで実物で確かめる。
//
// 対象の不変条件:
// - 属性の無い <sup>…</sup> / <sub>…</sub> の対だけが要素になる（中の Markdown はそのまま効く）
// - コード（インライン・ブロック）の中は文字のまま
// - 対にならないタグ・別の親に分かれたタグ・属性付きのタグ・ほかの HTML は文字のまま

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeSupSub, wrapSupSub } from "./rehype-sup-sub";

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSupSub]}>
      {markdown}
    </ReactMarkdown>,
  );
}

describe("rehypeSupSub", () => {
  it("<sup> と <sub> の対を上付き・下付きの要素にする", () => {
    expect(render("10<sup>5</sup> Pa")).toBe("<p>10<sup>5</sup> Pa</p>");
    expect(render("H<sub>2</sub>O")).toBe("<p>H<sub>2</sub>O</p>");
  });

  it("1 つの段落にある複数の対をそれぞれ包む", () => {
    expect(render("E = mc<sup>2</sup>、x<sub>i</sub> と 10<sup>-5</sup>")).toBe(
      "<p>E = mc<sup>2</sup>、x<sub>i</sub> と 10<sup>-5</sup></p>",
    );
  });

  it("タグの中の Markdown（強調・リンク）はそのまま効く", () => {
    expect(render("10<sup>**5**</sup>")).toBe("<p>10<sup><strong>5</strong></sup></p>");
    expect(render("本文<sup>[1](https://example.com)</sup>")).toBe(
      '<p>本文<sup><a href="https://example.com">1</a></sup></p>',
    );
  });

  it("入れ子の対も包む", () => {
    expect(render("x<sup>y<sub>2</sub></sup>")).toBe("<p>x<sup>y<sub>2</sub></sup></p>");
  });

  it("大文字や > の前の空白も同じタグとして扱う", () => {
    expect(render("10<SUP>5</SUP> と H<sub >2</sub >O")).toBe(
      "<p>10<sup>5</sup> と H<sub>2</sub>O</p>",
    );
  });

  it("表のセルの中で閉じていれば包み、セルをまたぐタグは文字のまま残す", () => {
    const html = render(
      ["| 圧力 | 式 | 備考 |", "| --- | --- | --- |", "| 10<sup>5</sup> Pa | a<sup>b | c</sup> |"].join("\n"),
    );
    expect(html).toContain("<td>10<sup>5</sup> Pa</td>");
    expect(html).toContain("<td>a&lt;sup&gt;b</td><td>c&lt;/sup&gt;</td>");
  });

  describe("コードの中は変換しない", () => {
    it("インラインコード", () => {
      expect(render("`10<sup>5</sup>` と書く")).toBe(
        "<p><code>10&lt;sup&gt;5&lt;/sup&gt;</code> と書く</p>",
      );
    });

    it("コードブロック", () => {
      expect(render("```html\nH<sub>2</sub>O\n```")).toBe(
        '<pre><code class="language-html">H&lt;sub&gt;2&lt;/sub&gt;O\n</code></pre>',
      );
    });

    it("コード要素の中に raw があっても触れない", () => {
      // Markdown のコードは中身を text で持つので raw は現れない。別経路で入っても書き換えないこと
      const code = {
        type: "element",
        tagName: "code",
        properties: {},
        children: [
          { type: "raw", value: "<sup>" },
          { type: "text", value: "5" },
          { type: "raw", value: "</sup>" },
        ],
      };
      const tree = { type: "root", children: [{ type: "element", tagName: "pre", properties: {}, children: [code] }] };
      const before = JSON.stringify(tree);
      wrapSupSub(tree);
      expect(JSON.stringify(tree)).toBe(before);
    });
  });

  describe("対にならないタグは文字のまま残す", () => {
    it("開きだけ・閉じだけ・名前の違う対", () => {
      expect(render("a<sup>b")).toBe("<p>a&lt;sup&gt;b</p>");
      expect(render("a</sub>b")).toBe("<p>a&lt;/sub&gt;b</p>");
      expect(render("a<sup>b</sub>c")).toBe("<p>a&lt;sup&gt;b&lt;/sub&gt;c</p>");
    });

    it("閉じていない開きタグは、外側の対の中身に文字として入る", () => {
      expect(render("<sup>a<sub>b</sup>")).toBe("<p><sup>a&lt;sub&gt;b</sup></p>");
    });

    it("交差したタグは先に閉じた側だけを包み、あとの閉じタグは文字のまま残す", () => {
      expect(render("a<sup>b<sub>c</sup>d</sub>e")).toBe(
        "<p>a<sup>b&lt;sub&gt;c</sup>d&lt;/sub&gt;e</p>",
      );
    });

    it("強調の内と外に分かれたタグは対にしない", () => {
      expect(render("**10<sup>5**</sup>")).toBe(
        "<p><strong>10&lt;sup&gt;5</strong>&lt;/sup&gt;</p>",
      );
    });
  });

  describe("sup / sub 以外は従来どおり文字のまま", () => {
    it("属性付きの <sup> / <sub> は要素にしない", () => {
      expect(render('10<sup class="x">5</sup>')).toBe(
        "<p>10&lt;sup class=&quot;x&quot;&gt;5&lt;/sup&gt;</p>",
      );
      expect(render('H<sub onclick="alert(1)">2</sub>O')).toBe(
        "<p>H&lt;sub onclick=&quot;alert(1)&quot;&gt;2&lt;/sub&gt;O</p>",
      );
    });

    it("ほかの HTML タグ", () => {
      expect(render("<b>太字</b> と <script>alert(1)</script>")).toBe(
        "<p>&lt;b&gt;太字&lt;/b&gt; と &lt;script&gt;alert(1)&lt;/script&gt;</p>",
      );
    });
  });

  it("作る要素は属性を持たない", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "raw", value: "<sup>" },
            { type: "text", value: "5" },
            { type: "raw", value: "</sup>" },
          ],
        },
      ],
    };
    wrapSupSub(tree);
    expect(tree.children[0].children).toEqual([
      { type: "element", tagName: "sup", properties: {}, children: [{ type: "text", value: "5" }] },
    ]);
  });
});
