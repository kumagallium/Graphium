import { describe, expect, it } from "vitest";
import { chatReadPageIds, chatUsedPageWeights, citedTitles, contextTitles, EARLIER_WEIGHT, latestWebSourceCount, outOfScopePageIds, usedPagesSignature } from "./used-pages";

const nodes = [
  { id: "w1", title: "発酵の温度" },
  { id: "n1", title: "パン生地の記録" },
  { id: "media:f1", title: "論文.pdf" },
  { id: "w2", title: "塩の役割" },
];

const msg = (role: "user" | "assistant", content: string) => ({ role, content });

describe("citedTitles", () => {
  it("本文の引用を出てきた順に重複なく拾う", () => {
    expect(citedTitles('A [Source: "x"] B [Source: "y"]\n- [Source: "x"]')).toEqual(["x", "y"]);
  });
  it("引用が無ければ空", () => {
    expect(citedTitles("ふつうの答え")).toEqual([]);
  });
});

describe("chatUsedPageWeights", () => {
  it("いちばん新しい答えのページは 1、前の答えのページは薄く、新しい方が先に並ぶ", () => {
    const w = chatUsedPageWeights(
      [
        msg("user", "q1"),
        msg("assistant", '[Source: "塩の役割"] [Source: "発酵の温度"]'),
        msg("user", "q2"),
        msg("assistant", '[Source: "パン生地の記録"] [Source: "発酵の温度"]'),
      ],
      nodes,
    );
    expect([...w]).toEqual([
      ["n1", 1],
      ["w1", 1],
      ["w2", EARLIER_WEIGHT],
    ]);
  });

  it("retriever の参照で引く（Wiki は id そのまま、素材は media:）", () => {
    const titleToRef = new Map([
      ["別名の知見", "w2"],
      ["その PDF", "asset:f1"],
    ]);
    const w = chatUsedPageWeights([msg("assistant", '[Source: "別名の知見"] [Source: "その PDF"]')], nodes, titleToRef);
    expect([...w.keys()]).toEqual(["w2", "media:f1"]);
  });

  it("グラフに無いページ・共有ライブラリ・引けない題名は落とす", () => {
    const titleToRef = new Map([["共有の知見", "shared:s1"]]);
    const w = chatUsedPageWeights(
      [msg("assistant", '[Source: "共有の知見"] [Source: "どこにも無い"]')],
      nodes,
      titleToRef,
    );
    expect(w.size).toBe(0);
  });

  it("答えがまだ無い会話は空", () => {
    expect(chatUsedPageWeights([msg("user", "q")], nodes).size).toBe(0);
  });
});

describe("usedPagesSignature", () => {
  it("中身が同じなら同じ署名", () => {
    expect(usedPagesSignature(new Map([["a", 1]]))).toBe(usedPagesSignature(new Map([["a", 1]])));
    expect(usedPagesSignature(new Map([["a", 1]]))).not.toBe(usedPagesSignature(new Map([["a", 0.3]])));
  });
});

describe("latestWebSourceCount", () => {
  it("いちばん新しい答えの Web の出典を重複なく数える", () => {
    expect(
      latestWebSourceCount([
        msg("assistant", "[a](https://old.example)"),
        msg("user", "q"),
        msg("assistant", "x\n**🌐 Web の出典**\n  - [A](https://a.example/p)\n  - [B](https://b.example)\n  - [A again](https://a.example/p)"),
      ]),
    ).toBe(2);
  });
  it("答えが無ければ 0", () => {
    expect(latestWebSourceCount([msg("user", "q")])).toBe(0);
  });
});

describe("contextTitles / chatReadPageIds", () => {
  it("文脈の番号付き見出しから題名を拾う（種別ラベルの有無どちらも）", () => {
    expect(contextTitles('[#1 | "A"] text [#2 | Topic | "B"] [#3 | "A"] (note)')).toEqual(["A", "B"]);
  });
  it("答えの readRefs と読んでいる途中のページを合わせ、グラフに無いものは落とす", () => {
    const ids = chatReadPageIds(
      [
        { role: "assistant", readRefs: ["wiki:w1", "note:n1", "shared:s1"] },
        { role: "user" },
      ],
      new Set(["w1", "n1", "media:f1"]),
      ["asset:f1", "note:zz"],
    );
    expect([...ids].sort()).toEqual(["media:f1", "n1", "w1"]);
  });
});

describe("outOfScopePageIds", () => {
  const folder = new Set(["a", "b"]);
  it("前の答えの根拠は、その答えを出したときの範囲（すべて）で見て、読んでいる途中のページだけをいまの範囲で見る", () => {
    // 「すべて」で答えた根拠 x・y が、いまのフォルダの外でも数えない
    const ids = outOfScopePageIds({
      weights: new Map([["x", 1], ["y", 1]]),
      readIds: new Set(["a", "z"]),
      usedScope: null,
      readScope: folder,
    });
    expect([...ids]).toEqual(["z"]);
  });
  it("答えのあとは、根拠も読んだページも答えたときの範囲で見る。@ で渡したページは数えない", () => {
    const ids = outOfScopePageIds({
      weights: new Map([["a", 1], ["x", 1], ["q", 0.5]]),
      readIds: new Set(["b", "y", "p"]),
      usedScope: folder,
      readScope: folder,
      attached: new Set(["p"]),
    });
    expect([...ids].sort()).toEqual(["x", "y"]);
  });
});
