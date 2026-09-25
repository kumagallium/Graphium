// 上付き・下付きの Markdown 相互変換（純ロジック）のユニットテスト
//
// 実際の BlockNote パーサを通す往復は base/script-styles.test.ts で確認する。
// ここでは目印の置き換え（パース前）と復元（パース後）の規則だけを見る。

import { describe, it, expect } from "vitest";
import {
  markScriptTags,
  oppositeScriptStyle,
  restoreScriptTags,
  scriptStyleToMarkdown,
} from "./script-styles";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (content: any[]) => ({ id: "p1", type: "paragraph", props: {}, content, children: [] });

describe("oppositeScriptStyle", () => {
  it("上付きと下付きが互いに相手を返す", () => {
    expect(oppositeScriptStyle("superscript")).toBe("subscript");
    expect(oppositeScriptStyle("subscript")).toBe("superscript");
  });
});

describe("scriptStyleToMarkdown", () => {
  it("上付き・下付きの無い片はそのまま", () => {
    expect(scriptStyleToMarkdown("abc", { bold: true })).toEqual({ text: "abc", styles: { bold: true } });
    expect(scriptStyleToMarkdown("abc", undefined)).toEqual({ text: "abc", styles: {} });
  });

  it("上付きは <sup>、下付きは <sub> で包み、残りの書式だけを返す", () => {
    expect(scriptStyleToMarkdown("5", { superscript: true, italic: true })).toEqual({
      text: "<sup>5</sup>",
      styles: { italic: true },
    });
    expect(scriptStyleToMarkdown("2", { subscript: true })).toEqual({ text: "<sub>2</sub>", styles: {} });
  });

  it("両方付いた壊れたデータは上付きとして書く", () => {
    expect(scriptStyleToMarkdown("x", { superscript: true, subscript: true }).text).toBe("<sup>x</sup>");
  });
});

describe("markScriptTags", () => {
  it("<sup> / <sub> の対を目印に置き換え、中身は残す", () => {
    expect(markScriptTags("10<sup>5</sup> Pa, H<sub>2</sub>O")).toBe(
      "10{{GWSUP_OPEN}}5{{GWSUP_CLOSE}} Pa, H{{GWSUB_OPEN}}2{{GWSUB_CLOSE}}O",
    );
  });

  it("大文字のタグや属性付きのタグも拾う", () => {
    expect(markScriptTags('x<SUP class="fn">1</SUP>')).toBe("x{{GWSUP_OPEN}}1{{GWSUP_CLOSE}}");
  });

  it("中身の Markdown（リンク・エスケープ）には触れない", () => {
    expect(markScriptTags("<sup>[1](#fn1)</sup> p<sup>\\*</sup>")).toBe(
      "{{GWSUP_OPEN}}[1](#fn1){{GWSUP_CLOSE}} p{{GWSUP_OPEN}}\\*{{GWSUP_CLOSE}}",
    );
  });

  it("コード領域の中は置き換えない", () => {
    const md = "`<sup>1</sup>` と\n\n```\n<sub>2</sub>\n```\n\nx<sup>3</sup>";
    expect(markScriptTags(md)).toBe(
      "`<sup>1</sup>` と\n\n```\n<sub>2</sub>\n```\n\nx{{GWSUP_OPEN}}3{{GWSUP_CLOSE}}",
    );
  });

  it("改行・表の区切りを含むもの、空のもの、閉じていないものは触らない", () => {
    for (const md of ["<sup>a\nb</sup>", "| <sup>a | b</sup> |", "<sup></sup>", "<sup>閉じていない"]) {
      expect(markScriptTags(md)).toBe(md);
    }
  });

  it("入れ子は内側だけを拾う（上付きと下付きは同時に持てないため）", () => {
    expect(markScriptTags("e<sup>x<sub>1</sub></sup>")).toBe(
      "e<sup>x{{GWSUB_OPEN}}1{{GWSUB_CLOSE}}</sup>",
    );
  });
});

describe("restoreScriptTags", () => {
  it("目印に挟まれたテキストに上付き・下付きを付けて目印を消す", () => {
    const [block] = restoreScriptTags([
      para([text("10{{GWSUP_OPEN}}5{{GWSUP_CLOSE}} Pa, H{{GWSUB_OPEN}}2{{GWSUB_CLOSE}}O")]),
    ]);
    expect(block.content).toEqual([
      text("10"),
      text("5", { superscript: true }),
      text(" Pa, H"),
      text("2", { subscript: true }),
      text("O"),
    ]);
  });

  it("元の書式に上付き・下付きを足す", () => {
    const [block] = restoreScriptTags([para([text("{{GWSUP_OPEN}}n{{GWSUP_CLOSE}}", { italic: true })])]);
    expect(block.content).toEqual([text("n", { italic: true, superscript: true })]);
  });

  it("目印が別々の片に分かれていても、間の片すべてに付ける（中身が太字のとき）", () => {
    const [block] = restoreScriptTags([
      para([text("x{{GWSUP_OPEN}}"), text("2", { bold: true }), text("{{GWSUP_CLOSE}}y")]),
    ]);
    expect(block.content).toEqual([
      text("x"),
      text("2", { bold: true, superscript: true }),
      text("y"),
    ]);
  });

  it("リンクの中身にも付ける（脚注リンクの上付き・リンク内の下付き）", () => {
    const [block] = restoreScriptTags([
      para([
        text("本文{{GWSUP_OPEN}}"),
        { type: "link", href: "#fn1", content: [text("1")] },
        text("{{GWSUP_CLOSE}} と "),
        { type: "link", href: "https://e.x", content: [text("CO{{GWSUB_OPEN}}2{{GWSUB_CLOSE}}")] },
      ]),
    ]);
    expect(block.content).toEqual([
      text("本文"),
      { type: "link", href: "#fn1", content: [text("1", { superscript: true })] },
      text(" と "),
      { type: "link", href: "https://e.x", content: [text("CO"), text("2", { subscript: true })] },
    ]);
  });

  it("テーブルのセルと子ブロックも戻す", () => {
    const [table] = restoreScriptTags([
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("m{{GWSUP_OPEN}}2{{GWSUP_CLOSE}}")], { type: "tableCell", content: [text("s{{GWSUP_OPEN}}-1{{GWSUP_CLOSE}}")] }] }],
        },
        children: [para([text("H{{GWSUB_OPEN}}2{{GWSUB_CLOSE}}O")])],
      },
    ]);
    expect(table.content.rows[0].cells[0]).toEqual([text("m"), text("2", { superscript: true })]);
    expect(table.content.rows[0].cells[1].content).toEqual([text("s"), text("-1", { superscript: true })]);
    expect(table.children[0].content).toEqual([text("H"), text("2", { subscript: true }), text("O")]);
  });

  it("対にならない閉じ目印は取り除くだけ", () => {
    const [block] = restoreScriptTags([para([text("a{{GWSUB_CLOSE}}b")])]);
    expect(block.content).toEqual([text("a"), text("b")]);
  });

  it("目印の無いブロックはオブジェクト同一性を保つ（無駄な再構築をしない）", () => {
    const blocks = [para([text("plain")])];
    expect(restoreScriptTags(blocks)[0]).toBe(blocks[0]);
  });
});
