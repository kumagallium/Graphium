// @vitest-environment jsdom
// pdf-search のテキストインデックス生成・マッチ検出のテスト。
// pdf.js の text-layer を模した DOM（span 単位で行が切れている）を組んで、
// 「行またぎで語が繋がらない」「マッチ位置が元の Text ノードに戻せる」を確認する。

import { describe, expect, it } from "vitest";
import {
  buildPageTextIndex,
  MAX_MATCHES,
  findMatchOffsets,
  normalizeQuery,
  rangeForOffsets,
  searchPages,
} from "./pdf-search";

/** span の配列から text-layer 付きのページ要素を作る。 */
function makePage(lines: string[]): HTMLElement {
  const page = document.createElement("div");
  const layer = document.createElement("div");
  layer.className = "textLayer";
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    layer.appendChild(span);
  }
  page.appendChild(layer);
  return page;
}

describe("buildPageTextIndex", () => {
  it("span 境界を空白として扱い、行末と次行が繋がらない", () => {
    const index = buildPageTextIndex(makePage(["end of", "line here"]));
    expect(index.text).toBe("end of line here");
    expect(index.sources).toHaveLength(index.text.length);
  });

  it("連続空白・改行を 1 つに畳む", () => {
    const index = buildPageTextIndex(makePage(["a  \n b", "\tc"]));
    expect(index.text).toBe("a b c");
  });

  it("先頭の空白は落とす", () => {
    const index = buildPageTextIndex(makePage(["   lead"]));
    expect(index.text).toBe("lead");
  });

  it("textLayer が無ければ要素そのものを走査する", () => {
    const el = document.createElement("div");
    el.textContent = "bare text";
    expect(buildPageTextIndex(el).text).toBe("bare text");
  });
});

describe("buildPageTextIndex (CJK)", () => {
  it("CJK の span 境界には空白を補わない（1〜2 文字ずつ割れた text-layer を繋ぐ）", () => {
    const index = buildPageTextIndex(makePage(["サ", "ワー", "ド", "ウ・", "ス", "ター", "ター"]));
    expect(index.text).toBe("サワードウ・スターター");
    expect(findMatchOffsets(index, "スターター", false)).toEqual([6]);
  });

  it("欧文と CJK が隣り合う境界にも空白は補わない", () => {
    const index = buildPageTextIndex(makePage(["24", "時間で"]));
    expect(index.text).toBe("24時間で");
  });

  it("欧文どうしの境界には引き続き空白を補う", () => {
    const index = buildPageTextIndex(makePage(["end of", "line"]));
    expect(index.text).toBe("end of line");
  });
});

describe("findMatchOffsets (互換文字)", () => {
  it("康熙部首で書かれた本文を通常の漢字で探せる", () => {
    const index = buildPageTextIndex(makePage(["⽔に住みついた"]));
    expect(findMatchOffsets(index, "水", false)).toEqual([0]);
    expect(rangeForOffsets(index, 0, 1)?.toString()).toBe("⽔");
  });

  it("全角英数を半角で探せる", () => {
    const index = buildPageTextIndex(makePage(["ＰＤＦ ｖ１"]));
    expect(findMatchOffsets(index, "pdf", false)).toEqual([0]);
  });
});

describe("findMatchOffsets", () => {
  const index = buildPageTextIndex(makePage(["Cu2O thin film", "grown on Cu2O seed"]));

  it("大文字小文字を無視して全ヒットを返す", () => {
    expect(findMatchOffsets(index, "cu2o", false)).toEqual([0, 24]);
  });

  it("caseSensitive では表記どおりにだけ当たる", () => {
    expect(findMatchOffsets(index, "cu2o", true)).toEqual([]);
    expect(findMatchOffsets(index, "Cu2O", true)).toEqual([0, 24]);
  });

  it("空クエリ・空白のみは 0 件", () => {
    expect(findMatchOffsets(index, "", false)).toEqual([]);
    expect(findMatchOffsets(index, "   ", false)).toEqual([]);
  });

  it("行をまたぐ語はクエリ側の空白も畳んで当たる", () => {
    expect(findMatchOffsets(index, "film  grown", false)).toEqual([10]);
  });

  it("重なりは数えない", () => {
    const aaa = buildPageTextIndex(makePage(["aaa"]));
    expect(findMatchOffsets(aaa, "aa", false)).toEqual([0]);
  });
});

describe("rangeForOffsets", () => {
  it("マッチ位置を元の Text ノード上の Range に戻す", () => {
    const page = makePage(["alpha beta", "gamma"]);
    const index = buildPageTextIndex(page);
    // "beta" は 1 つ目の span の中
    const start = index.text.indexOf("beta");
    const range = rangeForOffsets(index, start, start + 4);
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe("beta");
  });

  it("span をまたぐマッチも Range になる", () => {
    const page = makePage(["alpha beta", "gamma"]);
    const index = buildPageTextIndex(page);
    const start = index.text.indexOf("beta gamma");
    const range = rangeForOffsets(index, start, start + "beta gamma".length);
    // 途中に span 境界（＝実 DOM には無い空白）が入るので文字列は一致しないが、
    // 両端は beta の先頭と gamma の末尾を指す。
    expect(range?.toString()).toBe("betagamma");
  });

  it("空範囲・範囲外は null", () => {
    const index = buildPageTextIndex(makePage(["abc"]));
    expect(rangeForOffsets(index, 1, 1)).toBeNull();
    expect(rangeForOffsets(index, 0, 99)).toBeNull();
  });
});

describe("searchPages", () => {
  it("ページ順・ページ内出現順に並ぶ", () => {
    const p1 = makePage(["hit one", "hit two"]);
    const p2 = makePage(["hit three"]);
    // 入力の順序が逆でもページ番号順に整列する
    const matches = searchPages(
      [
        [2, p2],
        [1, p1],
      ],
      "hit",
      false,
    );
    expect(matches.map((m) => [m.pageNumber, m.start])).toEqual([
      [1, 0],
      [1, 8],
      [2, 0],
    ]);
  });

  it("空クエリは 0 件", () => {
    expect(searchPages([[1, makePage(["x"])]], "  ", false)).toEqual([]);
  });
});

describe("normalizeQuery", () => {
  it("連続空白を 1 つに畳む", () => {
    expect(normalizeQuery("a \n b")).toBe("a b");
  });
});

describe("MAX_MATCHES", () => {
  it("上限に達したら打ち切る（大量ヒットで UI を固めない）", () => {
    // "a" だけのページを大量に作り、1 文字クエリで上限を超えさせる
    const lines = Array.from({ length: 300 }, () => "a a a a a a a a a a");
    const pages: Array<[number, Element]> = [
      [1, makePage(lines)],
      [2, makePage(lines)],
    ];
    const matches = searchPages(pages, "a", false);
    expect(matches).toHaveLength(MAX_MATCHES);
  });
});
