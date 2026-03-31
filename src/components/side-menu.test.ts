// collectHeadingScope() のユニットテスト

import { describe, it, expect } from "vitest";
import { collectHeadingScope } from "./side-menu";

// テスト用ヘルパー: ブロックを簡易生成する
function makeHeading(id: string, level: number, text = "") {
  return {
    id,
    type: "heading",
    props: { level },
    content: [{ type: "text", text }],
  };
}

function makeParagraph(id: string, text = "") {
  return {
    id,
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

describe("collectHeadingScope", () => {
  // 見出しブロック + 次の同レベル見出しまでの全ブロックを返す
  it("見出し以降、次の同レベル見出しまでのブロックを返す", () => {
    const doc = [
      makeHeading("h1", 2, "セクション1"),
      makeParagraph("p1", "段落1"),
      makeParagraph("p2", "段落2"),
      makeHeading("h2", 2, "セクション2"),
      makeParagraph("p3", "段落3"),
    ];

    const result = collectHeadingScope(doc, doc[0]);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("h1");
    expect(result[1].id).toBe("p1");
    expect(result[2].id).toBe("p2");
  });

  // 同レベル or より上位レベルの見出しで停止する
  it("より上位レベル（数値が小さい）の見出しで停止する", () => {
    const doc = [
      makeHeading("h3", 3, "サブセクション"),
      makeParagraph("p1", "内容A"),
      makeHeading("h2", 2, "上位セクション"),
      makeParagraph("p2", "内容B"),
    ];

    const result = collectHeadingScope(doc, doc[0]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("h3");
    expect(result[1].id).toBe("p1");
  });

  // 下位レベルの見出しは含む（スコープ内に留まる）
  it("下位レベルの見出しはスコープに含む", () => {
    const doc = [
      makeHeading("h2", 2, "セクション"),
      makeParagraph("p1", "内容"),
      makeHeading("h3", 3, "サブセクション"),
      makeParagraph("p2", "サブ内容"),
      makeHeading("h2-next", 2, "次セクション"),
    ];

    const result = collectHeadingScope(doc, doc[0]);
    expect(result).toHaveLength(4);
    expect(result.map((b: any) => b.id)).toEqual(["h2", "p1", "h3", "p2"]);
  });

  // 最後のブロックが見出しなら、その見出しだけを返す
  it("ドキュメント末尾の見出しはその見出しだけを返す", () => {
    const doc = [
      makeHeading("h1", 2, "最初のセクション"),
      makeParagraph("p1", "内容"),
      makeHeading("h2", 2, "末尾セクション"),
    ];

    const result = collectHeadingScope(doc, doc[2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("h2");
  });

  // 見出しの後に後続ブロックがすべてある場合（末尾まで収集）
  it("後続に同レベル見出しがなければ末尾まで収集する", () => {
    const doc = [
      makeHeading("h1", 2, "唯一のセクション"),
      makeParagraph("p1", "段落1"),
      makeParagraph("p2", "段落2"),
      makeParagraph("p3", "段落3"),
    ];

    const result = collectHeadingScope(doc, doc[0]);
    expect(result).toHaveLength(4);
  });

  // ブロックが doc に見つからない場合は [headingBlock] を返す
  it("ブロックが doc に見つからない場合は [headingBlock] を返す", () => {
    const doc = [
      makeHeading("h1", 2, "セクション1"),
      makeParagraph("p1", "内容"),
    ];
    const orphanBlock = makeHeading("not-in-doc", 2, "孤立した見出し");

    const result = collectHeadingScope(doc, orphanBlock);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("not-in-doc");
  });

  // 空の doc 配列を渡した場合
  it("空のドキュメントでは [headingBlock] を返す", () => {
    const heading = makeHeading("h1", 2, "見出し");
    const result = collectHeadingScope([], heading);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("h1");
  });
});
