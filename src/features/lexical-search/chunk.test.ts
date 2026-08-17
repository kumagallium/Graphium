// チャンク分割のテスト
// - ブロック列を目安幅で畳み、先頭ブロック id を chunkId にする
// - H2 見出しで区切る（ただし直前が小さすぎるときは続ける）
// - children / カラム / 表 / メディアのキャプションも拾う
// - 長い段落は文境界で割る
// - プレーンテキストは段落境界で畳み、連番 id になる

import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { chunkNoteDocument, chunkPlainText, splitLongText } from "./chunk";

function doc(blocks: any[]): GraphiumDocument {
  return { title: "t", pages: [{ blocks }] } as unknown as GraphiumDocument;
}
const para = (id: string, text: string) => ({ id, type: "paragraph", content: [{ type: "text", text }] });
const heading = (id: string, text: string, level = 2) => ({
  id,
  type: "heading",
  props: { level },
  content: [{ type: "text", text }],
});

describe("chunkNoteDocument", () => {
  it("短いノートは 1 チャンク。chunkId は先頭ブロック id、見出しは文脈になる", () => {
    const chunks = chunkNoteDocument(doc([heading("h1", "背景"), para("p1", "湿度で劣化する"), para("p2", "対策を考える")]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkId).toBe("h1");
    expect(chunks[0].heading).toBe("背景");
    expect(chunks[0].text).toBe("## 背景\n湿度で劣化する\n対策を考える");
  });

  it("目安幅を超えたら次のチャンクへ。先頭ブロック id が引き継がれる", () => {
    const long = "あ".repeat(400);
    const chunks = chunkNoteDocument(doc([para("p1", long), para("p2", long), para("p3", "末尾")]), { targetChars: 600 });
    expect(chunks.map((c) => c.chunkId)).toEqual(["p1", "p2"]);
    expect(chunks[1].text).toBe(`${long}\n末尾`);
  });

  it("H2 見出しで区切る。直前が小さいときは区切らない", () => {
    const body = "い".repeat(250);
    const chunks = chunkNoteDocument(
      doc([heading("h1", "一"), para("p1", body), heading("h2", "二"), para("p2", "短い"), heading("h3", "三"), para("p3", body)]),
      { targetChars: 600, minCharsBeforeHeadingBreak: 200 },
    );
    // h1+p1（250 文字）→ h2 で区切る / h2+p2 は小さい → h3 で区切らず続ける
    expect(chunks.map((c) => c.chunkId)).toEqual(["h1", "h2"]);
    expect(chunks[1].text).toContain("## 二");
    expect(chunks[1].text).toContain("## 三");
    expect(chunks[1].heading).toBe("二");
  });

  it("children / カラム / 表 / キャプションを拾う", () => {
    const chunks = chunkNoteDocument(
      doc([
        {
          id: "cl",
          type: "columnList",
          children: [
            { id: "c1", type: "column", children: [para("cp1", "左カラムの本文")] },
            { id: "c2", type: "column", children: [para("cp2", "右カラムの本文")] },
          ],
        },
        {
          id: "tb",
          type: "table",
          content: {
            type: "tableContent",
            rows: [
              { cells: [[{ type: "text", text: "温度" }], [{ type: "text", text: "300 K" }]] },
              { cells: [{ type: "tableCell", content: [{ type: "text", text: "圧力" }] }, [{ type: "text", text: "1 atm" }]] },
            ],
          },
        },
        { id: "img", type: "image", props: { name: "sem.png", caption: "SEM 像" } },
        { id: "st", type: "step", children: [para("sp1", "step の中の手順")] },
      ]),
    );
    const all = chunks.map((c) => c.text).join("\n");
    expect(all).toContain("左カラムの本文");
    expect(all).toContain("右カラムの本文");
    expect(all).toContain("温度 | 300 K");
    expect(all).toContain("圧力 | 1 atm");
    expect(all).toContain("SEM 像");
    expect(all).toContain("step の中の手順");
    // 先頭に本文を持つ最初のブロックの id が chunkId（columnList 自体は本文を持たない）
    expect(chunks[0].chunkId).toBe("cp1");
  });

  it("空ドキュメントは空", () => {
    expect(chunkNoteDocument(doc([]))).toEqual([]);
    expect(chunkNoteDocument({ title: "t", pages: [] } as unknown as GraphiumDocument)).toEqual([]);
  });
});

describe("splitLongText", () => {
  it("上限以下ならそのまま", () => {
    expect(splitLongText("短い。", 100)).toEqual(["短い。"]);
  });
  it("文境界で割る。1 文が上限を超えるときは固定長で割る", () => {
    const s = "一文目です。二文目です。三文目です。";
    const parts = splitLongText(s, 8);
    expect(parts.join("")).toBe(s);
    expect(parts.every((p) => p.length <= 8)).toBe(true);
    const long = "x".repeat(25);
    expect(splitLongText(long, 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});

describe("chunkPlainText", () => {
  it("段落境界で畳み、連番 id になる", () => {
    const text = `${"a".repeat(350)}\n\n${"b".repeat(350)}\n\n${"c".repeat(100)}`;
    const chunks = chunkPlainText(text, { targetChars: 600 });
    expect(chunks.map((c) => c.chunkId)).toEqual(["c0", "c1"]);
    expect(chunks[0].text).toBe("a".repeat(350));
    expect(chunks[1].text).toBe(`${"b".repeat(350)}\n${"c".repeat(100)}`);
  });
  it("OCR のような 1 行ごとの改行も畳む。空白は正規化", () => {
    const chunks = chunkPlainText("温度   300K\n圧力 1atm\n\n\n備考");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("温度 300K\n圧力 1atm\n備考");
  });
  it("空は空", () => {
    expect(chunkPlainText("")).toEqual([]);
    expect(chunkPlainText("  \n \n")).toEqual([]);
  });
});
