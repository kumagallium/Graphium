// tokenizer のテスト
// - 日本語が語に割れる（Intl.Segmenter）
// - 3 文字以上の CJK 語は bigram も出る（分割揺れに耐える）
// - NFKC + 小文字で全角英数・大文字が揃う。化学式は 1 語のまま
// - Segmenter が無い環境では CJK bigram に退化し、それでも索引とクエリで一致する

import { afterEach, describe, expect, it } from "vitest";
import { __setSegmenterForTest, cjkBigrams, normalizeText, queryTerms, tokenize } from "./tokenizer";

afterEach(() => {
  __setSegmenterForTest(undefined);
});

describe("tokenize (Intl.Segmenter)", () => {
  it("日本語の文を語に割る", () => {
    const toks = tokenize("湿度60%以上で試薬Xが劣化する。");
    expect(toks).toContain("湿度");
    expect(toks).toContain("劣化");
    expect(toks).toContain("60");
    // 記号は落ちる
    expect(toks).not.toContain("%");
    expect(toks).not.toContain("。");
  });

  it("英語・化学式は 1 語のまま小文字化される", () => {
    const toks = tokenize("Bi2Te3 Thermoelectric PPMS");
    expect(toks).toEqual(["bi2te3", "thermoelectric", "ppms"]);
  });

  it("NFKC で全角英数が半角に揃う", () => {
    expect(normalizeText("ＰＰＭＳ　１２３")).toBe("ppms 123");
    expect(tokenize("ＰＰＭＳ")).toEqual(["ppms"]);
  });

  it("3 文字以上の CJK 語は自身 + bigram を出す", () => {
    const toks = tokenize("熱電変換材料");
    // 分割の仕方（熱電|変換|材料 か 熱電変換|材料 か）に依らず、bigram が拾える
    expect(toks).toContain("熱電");
    expect(toks).toContain("変換");
    expect(toks).toContain("材料");
  });

  it("空文字・記号のみは空", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("!!! ... 、、")).toEqual([]);
  });

  it("queryTerms は重複を除く", () => {
    expect(queryTerms("PPMS ppms ＰＰＭＳ")).toEqual(["ppms"]);
  });
});

describe("tokenize (fallback without Intl.Segmenter)", () => {
  it("CJK は bigram、英数は語のまま。索引側とクエリ側で同じ結果になる", () => {
    __setSegmenterForTest(null);
    const doc = tokenize("熱電変換材料の Bi2Te3");
    const q = tokenize("熱電変換");
    expect(doc).toContain("bi2te3");
    expect(cjkBigrams("熱電変換")).toEqual(["熱電", "電変", "変換"]);
    for (const t of q) expect(doc).toContain(t);
  });

  it("1〜2 文字の CJK はそのまま", () => {
    __setSegmenterForTest(null);
    expect(tokenize("水")).toEqual(["水"]);
    expect(tokenize("湿度")).toEqual(["湿度"]);
  });
});
