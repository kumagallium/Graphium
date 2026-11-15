import { describe, expect, it } from "vitest";
import { detectPastedTable } from "./paste";

describe("detectPastedTable（エンティティ）", () => {
  it("&amp;lt; を二重デコードせず &lt; のまま残す", () => {
    const html = "<table><tr><td>a</td><td>b</td></tr><tr><td>&amp;lt;</td><td>&lt;</td></tr></table>";
    expect(detectPastedTable({ html })?.tsv).toBe("a\tb\n&lt;\t<");
  });
});

describe("detectPastedTable", () => {
  it("HTML の <table> を行・列に読み、タグと実体参照を剥がして TSV にする", () => {
    const html =
      "<meta charset='utf-8'><table><tr><th>2θ</th><th>強度&nbsp;(cps)</th></tr>" +
      "<tr><td>20.1</td><td><b>4,100</b></td></tr><tr><td>20.2</td><td>3&amp;900</td></tr></table>";
    const t = detectPastedTable({ html, text: "ignored" });
    expect(t).toEqual({ rows: 3, cols: 2, tsv: "2θ\t強度 (cps)\n20.1\t4,100\n20.2\t3&900" });
  });

  it("タブ区切りのテキストは表とみなす（CRLF も可）", () => {
    const t = detectPastedTable({ text: "a\tb\r\n1\t2\r\n3\t4\r\n" });
    expect(t?.rows).toBe(3);
    expect(t?.cols).toBe(2);
    expect(t?.tsv).toBe("a\tb\n1\t2\n3\t4");
  });

  it("カンマ区切りや普通の文章は表とみなさない", () => {
    expect(detectPastedTable({ text: "a,b\n1,2\n3,4" })).toBeNull();
    expect(detectPastedTable({ text: "こんにちは。\n今日は晴れです。" })).toBeNull();
    expect(detectPastedTable({ text: "1 行だけ\tタブ" })).toBeNull();
  });

  it("<table> が壊れていて行が取れなければ text/plain に落ちる", () => {
    const t = detectPastedTable({ html: "<table></table>", text: "x\ty\n1\t2" });
    expect(t?.rows).toBe(2);
  });
});

describe("detectPastedTable（細工入力）", () => {
  it("閉じない <tr> の繰り返しでも短時間で返る", () => {
    const html = "<table>" + "<tr><td>".repeat(60_000);
    const t = Date.now();
    detectPastedTable({ html });
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("閉じない `<` の繰り返しのセルでも短時間で返る", () => {
    const html = "<table><tr><td>" + "<".repeat(300_000) + "</td></tr><tr><td>b</td></tr></table>";
    const t = Date.now();
    detectPastedTable({ html });
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("上限を超える巨大 HTML は表として読まず null（テキストが無ければ）", () => {
    const html = "<table>" + "<tr><td>a</td></tr>".repeat(100_000) + "</table>";
    expect(detectPastedTable({ html })).toBeNull();
  });
});

describe("detectPastedTable（長い属性・正常系）", () => {
  const longStyle = 'style="overflow:hidden;' + "x".repeat(500) + '"';

  it("開きタグが 300 字を超える td（Google スプレッドシート）でも中身が混ざらない", () => {
    const td = (v: string) => `<td ${longStyle} data-sheets-value="${"y".repeat(400)}">${v}</td>`;
    const html = `<table><tr>${td("A")}${td("B")}</tr><tr>${td("1")}${td("2")}</tr></table>`;
    expect(detectPastedTable({ html })?.tsv).toBe("A\tB\n1\t2");
  });

  it("長い href の a タグがセルに残らない", () => {
    const a = `<a href="https://example.com/${"p".repeat(600)}">link</a>`;
    const html = `<table><tr><td>${a}</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>`;
    expect(detectPastedTable({ html })?.tsv).toBe("link\tB\n1\t2");
  });

  it("上限を超える行数は切った表を返さない", () => {
    const html = "<table>" + "<tr><td>a</td></tr>".repeat(20_001) + "</table>";
    expect(detectPastedTable({ html })).toBeNull();
  });

  it("閉じない `<` が並び最後にだけ `>` がある入力でも短時間で返る", () => {
    const html = "<table><tr><td>" + "<".repeat(300_000) + "></td></tr><tr><td>b</td></tr></table>";
    const t = Date.now();
    detectPastedTable({ html });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
