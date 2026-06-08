// findMatches のテスト。
// 実 ProseMirror doc の代わりに descendants だけを持つ最小モックで、
// run 連結（マーク跨ぎ）と block 境界での区切りを検証する。

import { describe, expect, it } from "vitest";
import { findMatches } from "./search-plugin";

/**
 * テキストノード列から descendants 互換のモック doc を作る。
 * - 各 entry が ProseMirror のテキストノード（isText: true）を表す。
 * - pos は呼び出し側で指定。間に block 境界を挟むときは `null` を渡すと
 *   非テキストノード（run を切る）を 1 つ挟む。
 */
function mockDoc(entries: Array<{ text: string; pos: number } | null>) {
  return {
    descendants(f: (node: any, pos: number) => void) {
      for (const e of entries) {
        if (e === null) {
          // 非テキストノード（block 境界相当）。pos は使わないので 0。
          f({ isText: false }, 0);
        } else {
          f({ isText: true, text: e.text }, e.pos);
        }
      }
    },
  };
}

describe("findMatches", () => {
  it("空クエリは 0 件", () => {
    const doc = mockDoc([{ text: "hello world", pos: 1 }]);
    expect(findMatches(doc, "", false)).toEqual([]);
  });

  it("単一テキストノード内のヒット位置を返す", () => {
    const doc = mockDoc([{ text: "hello world hello", pos: 1 }]);
    const m = findMatches(doc, "hello", false);
    expect(m).toEqual([
      { from: 1, to: 6 },
      { from: 13, to: 18 },
    ]);
  });

  it("大文字小文字を無視（デフォルト）", () => {
    const doc = mockDoc([{ text: "Hello HELLO hello", pos: 1 }]);
    expect(findMatches(doc, "hello", false)).toHaveLength(3);
  });

  it("caseSensitive=true は厳密一致のみ", () => {
    const doc = mockDoc([{ text: "Hello HELLO hello", pos: 1 }]);
    const m = findMatches(doc, "hello", true);
    expect(m).toEqual([{ from: 13, to: 18 }]);
  });

  it("同一ブロック内の隣接ノード（マーク跨ぎ）を 1 run として連結しヒットさせる", () => {
    // "he" + "ll"(bold) + "o" が位置連続。"hello" は跨いでヒットするはず。
    const doc = mockDoc([
      { text: "he", pos: 1 },
      { text: "ll", pos: 3 },
      { text: "o", pos: 5 },
    ]);
    expect(findMatches(doc, "hello", false)).toEqual([{ from: 1, to: 6 }]);
  });

  it("block 境界を跨いだ誤マッチはしない", () => {
    // "wor"(block A 末尾) | block 境界 | "ld"(block B 先頭)
    const doc = mockDoc([
      { text: "wor", pos: 1 },
      null,
      { text: "ld", pos: 8 },
    ]);
    expect(findMatches(doc, "world", false)).toEqual([]);
  });

  it("位置が不連続な隣接テキストノードは別 run として扱う", () => {
    // pos が連続しない（間にウィジェット等）場合は連結しない。
    const doc = mockDoc([
      { text: "ab", pos: 1 },
      { text: "cd", pos: 10 },
    ]);
    expect(findMatches(doc, "abcd", false)).toEqual([]);
    expect(findMatches(doc, "ab", false)).toEqual([{ from: 1, to: 3 }]);
  });
});
