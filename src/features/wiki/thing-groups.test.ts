import { describe, expect, it } from "vitest";
import {
  composeThingBody,
  planThingGroups,
  type ThingGroupTopic,
} from "./thing-groups";

const topic = (id: string, title: string, sourceCount = 1): ThingGroupTopic => ({ id, title, sourceCount });

describe("planThingGroups", () => {
  it("同じ X の「X の Y」が 2 枚以上あり X のページが無いと、最も資料の多い 1 枚を残して題を付け替える", () => {
    const groups = planThingGroups([
      topic("a", "ライ麦サワー種の発酵時間", 2),
      topic("b", "ライ麦サワー種の酸度", 5),
      topic("c", "ライ麦サワー種の加水率", 1),
      topic("z", "石窯オーブンの予熱時間", 1),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      thing: "ライ麦サワー種",
      keepId: "b",
      retitle: true,
      absorbIds: ["a", "c"],
      sections: [
        { id: "b", heading: "酸度" },
        { id: "c", heading: "加水率" },
        { id: "a", heading: "発酵時間" },
      ],
      memberTitles: ["ライ麦サワー種の発酵時間", "ライ麦サワー種の酸度", "ライ麦サワー種の加水率"],
    });
  });

  it("残す側の資料数が同点なら入力順で先のものを残す", () => {
    const [g] = planThingGroups([topic("a", "ライ麦サワー種の発酵時間", 3), topic("b", "ライ麦サワー種の酸度", 3)]);
    expect(g.keepId).toBe("a");
  });

  it("X のページがあれば 1 枚だけの組でも成り立ち、X のページを残す（付け替えなし）", () => {
    const [g] = planThingGroups([topic("x", "石窯オーブン", 1), topic("a", "石窯オーブンの予熱時間", 9)]);
    expect(g).toEqual({
      thing: "石窯オーブン",
      keepId: "x",
      retitle: false,
      absorbIds: ["a"],
      sections: [
        { id: "x", heading: null },
        { id: "a", heading: "予熱時間" },
      ],
      memberTitles: ["石窯オーブンの予熱時間"],
    });
  });

  it("X のページが複数あれば資料の多い方、同点は入力順", () => {
    const [g1] = planThingGroups([topic("x1", "石窯オーブン", 1), topic("x2", "石窯オーブン", 4), topic("a", "石窯オーブンの予熱時間")]);
    expect(g1.keepId).toBe("x2");
    const [g2] = planThingGroups([topic("x1", "石窯オーブン", 2), topic("x2", "石窯オーブン", 2), topic("a", "石窯オーブンの予熱時間")]);
    expect(g2.keepId).toBe("x1");
  });

  it("「X の Y」が 1 枚だけで X のページも無ければ組にしない", () => {
    expect(planThingGroups([topic("a", "石窯オーブンの予熱時間")])).toEqual([]);
  });

  it("X が 3 文字未満なら対象外（X のページがあっても組にしない）", () => {
    expect(
      planThingGroups([topic("x", "塩"), topic("a", "塩の分量"), topic("b", "塩の種類"), topic("c", "水の温度"), topic("d", "水の量")]),
    ).toEqual([]);
  });

  it("表記ゆれ（空白・ハイフン・全角半角）は同じ組になり、題は一番多い表記を使う", () => {
    const [g] = planThingGroups([
      topic("a", "T-65 小麦粉の灰分", 1),
      topic("b", "T-65小麦粉の吸水", 1),
      topic("c", "Ｔ-65小麦粉の保存", 1),
    ]);
    expect(g.absorbIds.length + 1).toBe(3);
    // 「T-65小麦粉」が 2 件、「T-65 小麦粉」が 1 件
    expect(g.thing).toBe("T-65小麦粉");
    expect(g.retitle).toBe(true);
  });

  it("表記が同数なら最初のものを題にする", () => {
    const [g] = planThingGroups([topic("a", "T-65 小麦粉の灰分"), topic("b", "T-65小麦粉の吸水")]);
    expect(g.thing).toBe("T-65 小麦粉");
  });

  it("末尾の括弧書き付きの題も X のページとして認められる", () => {
    const [g] = planThingGroups([
      topic("x", "ライ麦サワー種（ロッゲンザワー）", 1),
      topic("a", "ライ麦サワー種の発酵時間", 1),
    ]);
    expect(g.keepId).toBe("x");
    expect(g.retitle).toBe(false);
    expect(g.absorbIds).toEqual(["a"]);
  });

  it("「の」が 2 回ある題は最初の「の」で切る", () => {
    const groups = planThingGroups([
      topic("a", "全粒粉の吸水の温度依存", 1),
      topic("b", "全粒粉の灰分", 1),
      topic("c", "全粒粉吸水の目安", 1),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].thing).toBe("全粒粉");
    expect(groups[0].keepId).toBe("a");
    expect(groups[0].absorbIds).toEqual(["b"]);
    expect(groups[0].memberTitles).toEqual(["全粒粉の吸水の温度依存", "全粒粉の灰分"]);
  });

  it("英語の題（X of Y / X lattice constant）は対象外", () => {
    expect(
      planThingGroups([
        topic("a", "Sourdough starter of fermentation time"),
        topic("b", "Sourdough starter of acidity"),
        topic("c", "Sourdough starter"),
        topic("d", "Sourdough starter hydration"),
      ]),
    ).toEqual([]);
  });

  it("残す側が「X の Y」のときは memberTitles に残す側の題も含む", () => {
    const [g] = planThingGroups([topic("a", "ライ麦サワー種の発酵時間", 9), topic("b", "ライ麦サワー種の酸度", 1)]);
    expect(g.keepId).toBe("a");
    expect(g.memberTitles).toEqual(["ライ麦サワー種の発酵時間", "ライ麦サワー種の酸度"]);
  });

  it("並びは吸収される数の多い順、同数は thing の文字列順", () => {
    const groups = planThingGroups([
      topic("b1", "ライ麦サワー種の酸度"),
      topic("b2", "ライ麦サワー種の発酵時間"),
      topic("b3", "ライ麦サワー種の加水率"),
      topic("a1", "石窯オーブンの予熱時間"),
      topic("a2", "石窯オーブンの蓄熱"),
      topic("c1", "全粒粉の吸水"),
      topic("c2", "全粒粉の灰分"),
    ]);
    expect(groups.map((g) => g.thing)).toEqual(["ライ麦サワー種", "全粒粉", "石窯オーブン"]);
  });
});

describe("planThingGroups の sections", () => {
  it("残す側が X のページなら先頭は見出し無し、吸収側は題の文字列順で Y を見出しにする", () => {
    const [g] = planThingGroups([
      topic("x", "石窯オーブン", 1),
      topic("b", "石窯オーブンの蓄熱"),
      topic("a", "石窯オーブンの予熱時間"),
    ]);
    expect(g.sections).toEqual([
      { id: "x", heading: null },
      { id: "a", heading: "予熱時間" },
      { id: "b", heading: "蓄熱" },
    ]);
  });

  it("残す側が「X の Y」（retitle）なら残す側も節になり先頭に置く", () => {
    const [g] = planThingGroups([topic("a", "ライ麦サワー種の発酵時間", 1), topic("b", "ライ麦サワー種の酸度", 5)]);
    expect(g.retitle).toBe(true);
    expect(g.sections).toEqual([
      { id: "b", heading: "酸度" },
      { id: "a", heading: "発酵時間" },
    ]);
  });

  it("同じ Y が 2 つあれば 2 つ目以降に番号を付ける。表記は NFKC 前のまま", () => {
    const [g] = planThingGroups([
      topic("x", "T-65 小麦粉", 1),
      topic("a", "T-65 小麦粉の灰分"),
      topic("b", "Ｔ-65小麦粉の灰分"),
    ]);
    expect(g.sections.map((s) => s.heading)).toEqual([null, "灰分", "灰分（2）"]);
  });
});

describe("composeThingBody", () => {
  it("見出し無しの本文はそのまま先頭に、ほかは節にして見出しを 1 段下げる（6 段目は据え置き）", () => {
    const out = composeThingBody([
      { heading: null, body: "## 定義\n\nライ麦の種。" },
      { heading: "酸度", body: "## 要点\n\n### 細目\n\n###### 最下段\n\n本文" },
    ]);
    expect(out).toBe("## 定義\n\nライ麦の種。\n\n## 酸度\n\n### 要点\n\n#### 細目\n\n###### 最下段\n\n本文\n");
  });

  it("コードブロックの中の # は触らない", () => {
    const out = composeThingBody([{ heading: "手順", body: "## 工程\n\n```sh\n# 混ぜる\n```\n\n## 後ろ" }]);
    expect(out).toContain("### 工程");
    expect(out).toContain("```sh\n# 混ぜる\n```");
    expect(out).toContain("\n### 後ろ");
  });

  it("出典の印は変わらない", () => {
    const body = "発酵は 12 時間 [[source:abc#1]] [[source:def]]。";
    expect(composeThingBody([{ heading: "発酵時間", body }])).toContain(body);
  });

  it("空の本文は節ごと省く", () => {
    expect(composeThingBody([{ heading: null, body: "本体" }, { heading: "酸度", body: "  \n" }])).toBe("本体\n");
    expect(composeThingBody([{ heading: "酸度", body: "" }])).toBe("");
  });

  it("retitle の組では残す側も節になる", () => {
    const [g] = planThingGroups([topic("a", "ライ麦サワー種の発酵時間", 1), topic("b", "ライ麦サワー種の酸度", 5)]);
    const bodies = new Map([["a", "発酵の話"], ["b", "酸度の話"]]);
    const out = composeThingBody(g.sections.map((s) => ({ heading: s.heading, body: bodies.get(s.id) ?? "" })));
    expect(out).toBe("## 酸度\n\n酸度の話\n\n## 発酵時間\n\n発酵の話\n");
  });
});

describe("composeThingBody - # の見出しが混じる本文", () => {
  it("いちばん上の見出しが ### になるだけ下げる（節の ## と並ばせない）", () => {
    const out = composeThingBody([
      { heading: "発酵時間", body: "## 要点\n一次発酵は 3 時間。\n\n# 食い違い\n資料によって 2 時間。" },
    ]);
    expect(out.split("\n").filter((l) => /^## /.test(l))).toEqual(["## 発酵時間"]);
    expect(out).toContain("#### 要点");
    expect(out).toContain("### 食い違い");
  });
});
