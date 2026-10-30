// メモ挿入ブロック生成のユニットテスト
// 出典の有無にかかわらず quote 1 ブロック。本文の改行は "\n" のまま残す。

import { describe, it, expect } from "vitest";
import { buildMemoInsertBlock, splitMemoBodyAndSource } from "./memo-insert";
import type { CaptureEntry } from "./capture-store";

function makeMemo(text: string): CaptureEntry {
  return { id: "cap_1", text, createdAt: "2026-05-22T10:00:00.000Z" };
}

describe("splitMemoBodyAndSource", () => {
  it("セパレータがあれば body / source に分割する", () => {
    expect(splitMemoBodyAndSource("本文\n\n— paper.pdf · p.3")).toEqual({
      body: "本文",
      source: "paper.pdf · p.3",
    });
  });

  it("セパレータがなければ body のみ、source は null", () => {
    expect(splitMemoBodyAndSource("ただのメモ")).toEqual({
      body: "ただのメモ",
      source: null,
    });
  });

  it("本文中にセパレータが複数回現れる場合は最後を採用する", () => {
    // ユーザーが本文内に偶然 `\n\n— ` を書いた場合の保険
    const text = "本文\n\n— ノイズ\n\n— paper.pdf";
    expect(splitMemoBodyAndSource(text)).toEqual({
      body: "本文\n\n— ノイズ",
      source: "paper.pdf",
    });
  });
});

describe("buildMemoInsertBlock", () => {
  it("出典付きメモは quote ブロック 1 個になる", () => {
    const block = buildMemoInsertBlock(makeMemo("本文\n\n— paper.pdf · p.3"));
    expect(block?.type).toBe("quote");
    expect(block?.content).toEqual([
      { type: "text", text: "本文", styles: {} },
      {
        type: "text",
        text: " — paper.pdf · p.3",
        styles: { italic: true, textColor: "gray" },
      },
    ]);
  });

  it("出典なしメモも quote ブロック 1 個になる", () => {
    const block = buildMemoInsertBlock(makeMemo("ただのメモ"));
    expect(block).toEqual({
      type: "quote",
      content: [{ type: "text", text: "ただのメモ", styles: {} }],
    });
  });

  it("本文の段落区切りと改行は \\n のまま残す", () => {
    const block = buildMemoInsertBlock(
      makeMemo("段落1\n\n段落2\n\n— paper.pdf"),
    );
    expect(block?.type).toBe("quote");
    expect(block?.content?.[0]).toEqual({
      type: "text",
      text: "段落1\n\n段落2",
      styles: {},
    });
  });

  it("本文の単一改行も残し、出典は最後の行に置く", () => {
    const block = buildMemoInsertBlock(makeMemo("行1\n行2\n\n— paper.pdf"));
    expect(block?.content).toEqual([
      { type: "text", text: "行1\n行2", styles: {} },
      { type: "text", text: "\n— paper.pdf", styles: { italic: true, textColor: "gray" } },
    ]);
  });

  it("CRLF は \\n にそろえ、前後の空白は落とす", () => {
    const block = buildMemoInsertBlock(makeMemo("  行1\r\n行2  "));
    expect(block?.content).toEqual([{ type: "text", text: "行1\n行2", styles: {} }]);
  });

  it("空メモは null を返す", () => {
    expect(buildMemoInsertBlock(makeMemo(""))).toBeNull();
    expect(buildMemoInsertBlock(makeMemo("   "))).toBeNull();
  });

  it("本文が空で出典だけある場合は quote ブロックに出典のみ入れる", () => {
    // 通常は起きないが安全弁
    const block = buildMemoInsertBlock(makeMemo("\n\n— paper.pdf"));
    expect(block?.type).toBe("quote");
    expect(block?.content).toEqual([
      {
        type: "text",
        text: "— paper.pdf",
        styles: { italic: true, textColor: "gray" },
      },
    ]);
  });
});
