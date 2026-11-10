import { describe, expect, it } from "vitest";
import { findSameTitleTopic, groupSameTitleTopics, sameTopicTitle, topicTitleParts } from "./topic-title-key";

describe("topicTitleParts", () => {
  it("末尾の括弧書きを gloss に切り出す（全角・半角どちらも）", () => {
    expect(topicTitleParts("X（別名）").gloss).toBe("別名");
    expect(topicTitleParts("X (Alias)").gloss).toBe("alias");
    expect(topicTitleParts("X (Alias)").base).toBe("x");
  });
  it("括弧が末尾でない・複数あるときは切り出さない", () => {
    expect(topicTitleParts("A (b) c").gloss).toBeNull();
    expect(topicTitleParts("A (b) (c)").gloss).toBeNull();
  });
  it("空文字・括弧だけの題", () => {
    expect(topicTitleParts("")).toEqual({ base: "", gloss: null });
    expect(topicTitleParts("()")).toEqual({ base: "", gloss: null });
    expect(sameTopicTitle("", "")).toBe(false);
    expect(sameTopicTitle("()", "（）")).toBe(false);
  });
  it("「の」はひらがな以外に挟まれたときだけ消す", () => {
    expect(topicTitleParts("生地の一次発酵").base).toBe("生地一次発酵");
    expect(topicTitleParts("もの").base).toBe("もの");
    expect(topicTitleParts("ののしる").base).toBe("ののしる");
  });
});

describe("sameTopicTitle", () => {
  it.each([
    ["生地の一次発酵", "生地一次発酵"],
    ["天然酵母パン焼成条件", "天然酵母パンの焼成条件"],
    ["低温長時間発酵", "低温長時間発酵 (オーバーナイト法)"],
    ["T-65 小麦粉", "T-65小麦粉"],
    ["Pain‑de‑Campagne", "Pain‑de‑Campagne（田舎パン）"],
    ["クープの入れ方", "クープ 入れ方"],
  ])("同じ: %s / %s", (a, b) => {
    expect(sameTopicTitle(a, b)).toBe(true);
  });
  it.each([
    ["BP (Baking Powder)", "BP（ベーカーズパーセント）"],
    ["サーバー", "サーバ"],
    ["加水率", "バゲットの加水率"],
    ["発酵不足", "一次発酵不足"],
  ])("別: %s / %s", (a, b) => {
    expect(sameTopicTitle(a, b)).toBe(false);
  });
});

describe("findSameTitleTopic", () => {
  const ex = [
    { id: "1", title: "BP (Baking Powder)" },
    { id: "2", title: "BP（ベーカーズパーセント）" },
    { id: "3", title: "生地一次発酵" },
  ];
  it("一致する既存を返す", () => {
    expect(findSameTitleTopic("生地の一次発酵", ex)?.id).toBe("3");
    expect(findSameTitleTopic("無関係", ex)).toBeNull();
  });
  it("別の括弧書きが 2 種類あり name に括弧書きが無いときは曖昧なので null", () => {
    expect(findSameTitleTopic("BP", ex)).toBeNull();
  });
  it("name に括弧書きがあれば同じ括弧書きの既存を優先", () => {
    expect(findSameTitleTopic("BP（ベーカーズパーセント）", ex)?.id).toBe("2");
  });
});

describe("groupSameTitleTopics", () => {
  it("同じ題をまとめ、単独は返さない", () => {
    const items = [{ title: "生地の一次発酵" }, { title: "別の話" }, { title: "生地一次発酵" }];
    const g = groupSameTitleTopics(items);
    expect(g).toHaveLength(1);
    expect(g[0].map((i) => i.title)).toEqual(["生地の一次発酵", "生地一次発酵"]);
  });
  it("括弧書き無しは括弧書きが 1 種類ならそこに合流する", () => {
    expect(groupSameTitleTopics([{ title: "DDT" }, { title: "DDT (dough temp)" }])).toHaveLength(1);
  });
  it("括弧書きが 2 種類あれば混ぜない", () => {
    expect(groupSameTitleTopics([{ title: "BP (a)" }, { title: "BP (b)" }, { title: "BP" }])).toHaveLength(0);
    expect(groupSameTitleTopics([{ title: "BP (a)" }, { title: "BP (b)" }, { title: "BP" }, { title: "bp" }])).toHaveLength(1);
  });
});
