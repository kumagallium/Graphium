// PDF 選択テキストの改行正規化テスト
// 散文の選択でよく見るパターンを中心にカバーする。

import { describe, it, expect } from "vitest";
import { normalizePdfSelectionText } from "./pdf-selection-text";

describe("normalizePdfSelectionText", () => {
  it("空文字はそのまま返す", () => {
    expect(normalizePdfSelectionText("")).toBe("");
  });

  it("変換が不要な単一行はそのまま返す（trim 込み）", () => {
    expect(normalizePdfSelectionText("simple line")).toBe("simple line");
    expect(normalizePdfSelectionText("  surrounded by spaces  ")).toBe("surrounded by spaces");
  });

  it("英文の単一改行を半角スペースに置換する", () => {
    const input = "This is a long\nsentence that wraps.";
    expect(normalizePdfSelectionText(input)).toBe("This is a long sentence that wraps.");
  });

  it("CJK の単一改行はスペースを入れず詰める", () => {
    const input = "これは長い\n文章です。";
    expect(normalizePdfSelectionText(input)).toBe("これは長い文章です。");
  });

  it("英字のハイフネーション（行末 -）を結合する", () => {
    const input = "Tran-\nsistor は半導体素子";
    expect(normalizePdfSelectionText(input)).toBe("Transistor は半導体素子");
  });

  it("行頭が大文字のハイフン区切りは結合しない（別単語の可能性）", () => {
    // "X-Ray" のような語が改行で割れているケースは別単語扱い
    const input = "high X-\nRay intensity";
    // 改行は半角スペースになるが、ハイフン自体は残る
    expect(normalizePdfSelectionText(input)).toBe("high X- Ray intensity");
  });

  it("連続改行（段落区切り）は \\n\\n として保持する", () => {
    const input = "First paragraph.\n\nSecond paragraph.";
    expect(normalizePdfSelectionText(input)).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("3 連以上の改行も \\n\\n に正規化する", () => {
    const input = "First.\n\n\n\nSecond.";
    expect(normalizePdfSelectionText(input)).toBe("First.\n\nSecond.");
  });

  it("CJK と英字が混ざる場合は半角スペースを入れる", () => {
    const input = "日本語\nEnglish";
    expect(normalizePdfSelectionText(input)).toBe("日本語 English");
  });

  it("\\r\\n を \\n に統一する", () => {
    const input = "first\r\nsecond";
    expect(normalizePdfSelectionText(input)).toBe("first second");
  });

  it("連続スペース・タブを 1 個にまとめる", () => {
    const input = "lots   of    spaces\tand\ttabs";
    expect(normalizePdfSelectionText(input)).toBe("lots of spaces and tabs");
  });

  it("段落内で複数の改行・ハイフネーションが混在しても処理できる", () => {
    const input =
      "The exper-\niment ran for\ntwelve hours.\n\nResults were\npromising.";
    expect(normalizePdfSelectionText(input)).toBe(
      "The experiment ran for twelve hours.\n\nResults were promising.",
    );
  });

  it("日本語段落でも段落区切りは残る", () => {
    const input = "最初の段落\nです。\n\n次の段落\nです。";
    expect(normalizePdfSelectionText(input)).toBe("最初の段落です。\n\n次の段落です。");
  });
});
