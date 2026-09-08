import { describe, expect, it } from "vitest";
import { detectPastedTable } from "./paste";

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
