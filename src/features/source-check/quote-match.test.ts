import { describe, expect, it } from "vitest";
import { findBlockIdForQuote, locateQuoteRanges, resolveQuoteLocation } from "./quote-match";

const blocks = [
  { id: "b1", text: "融点は 800℃ である。" },
  { id: "b2", text: "この物質は水に溶けやすい。" },
];

describe("findBlockIdForQuote", () => {
  it("quote を含む唯一のブロックの id を返す", () => {
    expect(findBlockIdForQuote(blocks, "水に溶けやすい")).toBe("b2");
  });

  it("空白ゆれ（全角空白 vs 半角空白）でも一致する", () => {
    const withSpace = [{ id: "b1", text: "融点は　800℃　である。" }]; // 全角空白
    expect(findBlockIdForQuote(withSpace, "融点は 800℃ である")).toBe("b1");
  });

  it("どのブロックにも見つからなければ undefined", () => {
    expect(findBlockIdForQuote(blocks, "存在しない引用")).toBeUndefined();
  });

  it("quote / blocks が無ければ undefined", () => {
    expect(findBlockIdForQuote(undefined, "x")).toBeUndefined();
    expect(findBlockIdForQuote(blocks, undefined)).toBeUndefined();
    expect(findBlockIdForQuote(blocks, "")).toBeUndefined();
  });

  it("複数ブロックに一致する quote は一意に決まらないため undefined", () => {
    const dup = [
      { id: "b1", text: "共通の一文。" },
      { id: "b2", text: "共通の一文。" },
    ];
    expect(findBlockIdForQuote(dup, "共通の一文")).toBeUndefined();
  });
});

// サーバー側 quoteAppearsInSource（src/server/services/source-check.ts）と同じ正規化基準
// （NFKC + 連続空白圧縮 + trim）をテスト側にも複製する。「サーバーが true と判定する組み合わせ
// なら locateQuoteRanges も範囲を返す」ことを保証するための比較対象。
function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}
function quoteAppearsInSource(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  return normalizeForMatch(sourceText).includes(q);
}

describe("locateQuoteRanges", () => {
  const cases: Array<{ label: string; quote: string; sourceText: string }> = [
    { label: "全角英数", quote: "800", sourceText: "融点は８００℃である。" },
    { label: "改行・連続空白", quote: "融点は 800℃ である", sourceText: "融点は\n\n800℃　　である。" },
    { label: "合字 ﬁ", quote: "file", sourceText: "このﬁleを開く。" },
    { label: "半角カナ濁点", quote: "ガス発生", sourceText: "反応でｶﾞｽ発生が見られた。" },
    { label: "結合濁点", quote: "が発生", sourceText: "反応でが発生が見られた。" },
    { label: "康熙部首", quote: "水に溶ける", sourceText: "この物質は⽔に溶ける。" },
    {
      // 原文が分解形ハングル字母（初声+中声）で、quote は一般的な合成済み表記。
      // NFKC の正準合成は文字列全体を一度に正規化したときにしか起きないため、
      // クラスタ単位で個別に NFKC する実装だと合成が起きず見失う罠がある。
      label: "分解形ハングル",
      quote: "가나다",
      sourceText: `前置き。가나다が書かれている。`,
    },
  ];

  for (const { label, quote, sourceText } of cases) {
    it(`${label}: サーバー判定が true な組み合わせは範囲を返し、切り出しに quote を含む`, () => {
      expect(quoteAppearsInSource(quote, sourceText)).toBe(true);
      const ranges = locateQuoteRanges(sourceText, quote);
      expect(ranges.length).toBeGreaterThan(0);
      for (const r of ranges) {
        const slice = sourceText.slice(r.start, r.end);
        expect(normalizeForMatch(slice).includes(normalizeForMatch(quote))).toBe(true);
      }
    });
  }

  it("見つからなければ空配列", () => {
    expect(locateQuoteRanges("何もない文章です。", "存在しない引用")).toEqual([]);
  });

  it("quote が空 / undefined なら空配列", () => {
    expect(locateQuoteRanges("本文", "")).toEqual([]);
    expect(locateQuoteRanges("本文", undefined)).toEqual([]);
  });

  it("重なりは数えない（連続する同じ文字列）", () => {
    // "aa" を "aaaa" から探すと非重複で 2 件
    expect(locateQuoteRanges("aaaa", "aa").length).toBe(2);
  });

  it("出典テキストが入れ替わっても、前の出典の正規化結果を使い回さない", () => {
    expect(locateQuoteRanges("前置き。熱伝導率が下がった。", "熱伝導率が下がった")).toEqual([{ start: 4, end: 13 }]);
    expect(locateQuoteRanges("熱伝導率が下がった。", "熱伝導率が下がった")).toEqual([{ start: 0, end: 9 }]);
    expect(locateQuoteRanges("前置き。熱伝導率が下がった。", "熱伝導率が下がった")).toEqual([{ start: 4, end: 13 }]);
  });
});

// PDF ページ番号解決用のヘルパー: extractPdfText と同じ「ページ配列 → join("\n\n") → 開始
// オフセット計算」の手順をテスト側でも踏む（本番の pageStarts 計算をそのまま模倣する）。
function buildPdfPages(pages: string[]): { text: string; pageStarts: number[] } {
  const pageStarts: number[] = [];
  let offset = 0;
  for (let i = 0; i < pages.length; i++) {
    pageStarts.push(offset);
    offset += pages[i].length + (i < pages.length - 1 ? 2 : 0);
  }
  return { text: pages.join("\n\n"), pageStarts };
}

describe("resolveQuoteLocation - PDF", () => {
  it("1 ページ内なら page のみ", () => {
    const { text, pageStarts } = buildPdfPages(["第1段落のテキスト。重要な発見があった。"]);
    const loc = resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "重要な発見があった");
    expect(loc).toEqual({ page: 1 });
  });

  it("ページをまたぐ quote は page と pageEnd を返す", () => {
    const page1 = "ページ1の内容がここまで続く";
    const page2 = "ページ2の内容がここから始まる";
    const { text, pageStarts } = buildPdfPages([page1, page2]);
    // 元テキストの改行 "\n\n" は正規化で 1 つの半角空白に畳まれるため、quote 側も空白 1 つで表す
    const loc = resolveQuoteLocation(
      { kind: "pdf", text, pageStarts },
      "ここまで続く ページ2の内容",
    );
    expect(loc).toEqual({ page: 1, pageEnd: 2 });
  });

  it("同じ文言が別ページにもある場合は一意に決まらないので undefined", () => {
    const { text, pageStarts } = buildPdfPages(["共通の記述がある。", "共通の記述がある。"]);
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "共通の記述")).toBeUndefined();
  });

  it("同じページに 2 回出現しても、そのページを返す", () => {
    const { text, pageStarts } = buildPdfPages(["繰り返し。繰り返し。"]);
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "繰り返し")).toEqual({ page: 1 });
  });

  it("先頭に空ページがあり trim される場合でも正しいページに解決する", () => {
    const raw = buildPdfPages(["", "本文開始。実測データがある。"]);
    const joined = raw.text; // "\n\n本文開始。..."
    const text = joined.trim();
    const leadingTrimmed = joined.length - joined.trimStart().length;
    const pageStarts = raw.pageStarts.map((s) => Math.max(0, s - leadingTrimmed));
    const loc = resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "実測データがある");
    expect(loc).toEqual({ page: 2 });
  });

  it("80,000 字打ち切りの注記内の文字列は位置にならない", () => {
    const body = "実測データが多数含まれる本文。".repeat(3000); // 十分長い本文
    const marker = "\n\n[... truncated: read 1 of 3 pages]";
    const text = body + marker;
    const pageStarts = [0]; // 打ち切りで 1 ページ分しか本文に残っていない
    // 本文中の quote は解決できる
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "実測データが多数含まれる本文")).toEqual({
      page: 1,
    });
    // 注記内の文字列は位置なし（quote 自体は原文に実在するが、ページの外）
    expect(
      resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "truncated: read 1 of 3 pages"),
    ).toBeUndefined();
  });

  it("pageStarts が無ければ undefined", () => {
    expect(resolveQuoteLocation({ kind: "pdf", text: "本文" }, "本文")).toBeUndefined();
  });

  it("ページ先頭が結合文字（半角濁点）でも、区切りの改行を巻き込まず本来のページだけを返す", () => {
    // ページ2の先頭が半角濁点。直前の文字はページ区切りの "\n"（半角カタカナではない）
    // なので合成は起きないはずだが、クラスタ化のとき無条件で結合してしまうと、区切りの
    // 改行までクラスタ範囲に取り込まれ、quote が存在しないページ1側にまで
    // 一致範囲が“出血”してしまう（ページ判定が {page:1, pageEnd:2} と誤って広がる）。
    const page1 = "第1ページの本文がここまで続く";
    const page2 = "ﾞ第2ページの重要な発見がここに書かれている";
    const { text, pageStarts } = buildPdfPages([page1, page2]);
    const quote = "ﾞ第2ページの重要な発見";
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, quote)).toEqual({ page: 2 });
  });

  it("ページ先頭が NFKC で分解される結合文字（互換分解で文字数が増える Mn）でも、区切りの改行を巻き込まず本来のページだけを返す", () => {
    // U+0F73（チベット文字の母音記号 II）は NFKC で U+0F71 + U+0F72 の2文字に分解される。
    // ページ2の先頭がこの文字だと、区切りの "\n\n" の2本目の改行がクラスタの基底文字になり、
    // 「合成でコードポイント数が減る」判定（旧実装）をすり抜けて else 分岐に落ち、
    // 区切りの改行までクラスタ範囲に巻き込んでページ1側へ一致範囲が“出血”してしまう罠がある。
    const page1 = "第1ページの本文がここまで続く";
    const page2 = "ཱི第2ページの重要な発見がここに書かれている";
    const { text, pageStarts } = buildPdfPages([page1, page2]);
    const quote = "ཱི第2ページの重要な発見";
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, quote)).toEqual({ page: 2 });
  });

  it("半角カナ+濁点の正当な合成は、合成後の1文字としてページ判定に影響しない", () => {
    const page1 = "第1ページの本文がここまで続く";
    const page2 = "ｶﾞ第2ページの重要な発見がここに書かれている";
    const { text, pageStarts } = buildPdfPages([page1, page2]);
    expect(resolveQuoteLocation({ kind: "pdf", text, pageStarts }, "ガ第2ページの重要な発見")).toEqual({
      page: 2,
    });
  });
});

describe("resolveQuoteLocation - Word", () => {
  it("段落番号を返す", () => {
    const text = "第1段落の文章です。\n\n第2段落には重要な結論が書かれている。\n\n第3段落。";
    expect(resolveQuoteLocation({ kind: "document", text }, "重要な結論")).toEqual({ paragraph: 2 });
    expect(resolveQuoteLocation({ kind: "document", text }, "第1段落の文章")).toEqual({ paragraph: 1 });
    expect(resolveQuoteLocation({ kind: "document", text }, "第3段落")).toEqual({ paragraph: 3 });
  });

  it("同じ文言が 2 段落にある場合は undefined", () => {
    const text = "共通の一文がある。\n\n別の話題。\n\n共通の一文がある。";
    expect(resolveQuoteLocation({ kind: "document", text }, "共通の一文")).toBeUndefined();
  });
});

describe("resolveQuoteLocation - それ以外の出典種別", () => {
  it("note / url / memo / claim / chat / unknown は常に undefined", () => {
    const kinds = ["note", "url", "memo", "claim", "chat", "unknown"] as const;
    for (const kind of kinds) {
      expect(resolveQuoteLocation({ kind, text: "重要な記述がある。" }, "重要な記述")).toBeUndefined();
    }
  });
});
