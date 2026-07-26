// スラッシュメニューのラベル項目の回帰テスト
//
// 工程（手順）は step ブロックが表すようになった。ラベル付き見出しを挿入する
// 旧項目を残すと、同じ「工程を作る」操作が /ステップ と /手順 の 2 通り並び、
// 実際にメニュー上で衝突した（step という語で両方が引っかかる）。
// 「工程の作り方は 1 つだけ」を構造的に守るためのテスト。

import { describe, it, expect } from "vitest";
import { buildLabelSlashMenuItems } from "./slash-menu-items";

describe("buildLabelSlashMenuItems", () => {
  const labels = () => buildLabelSlashMenuItems().map((i) => i.label);

  it("工程（procedure）を挿入する項目は無い（step ブロックが担う）", () => {
    expect(labels()).not.toContain("procedure");
  });

  it("計画 / 結果の項目も無い（step 内のドラッグハンドルから付ける）", () => {
    expect(labels()).not.toContain("plan");
    expect(labels()).not.toContain("result");
  });

  it("step という語でラベル項目が引っかからない（/ステップ と衝突しない）", () => {
    const hits = buildLabelSlashMenuItems().filter(
      (i) =>
        i.aliases.some((a) => a.toLowerCase().includes("step")) ||
        i.title.includes("ステップ"),
    );
    expect(hits).toEqual([]);
  });

  it("Entity 系（材料 / ツール / 属性 / 成果）の項目は残る", () => {
    const l = labels();
    expect(l).toContain("material");
    expect(l).toContain("tool");
    expect(l).toContain("attribute");
    expect(l).toContain("output");
  });

  it("残った項目は見出しを作らない（工程と紛らわしくないように）", () => {
    for (const item of buildLabelSlashMenuItems()) {
      expect(item.blockType).not.toBe("heading");
    }
  });
});
