import { describe, it, expect } from "vitest";
import {
  buildFolderTree,
  collectFolderSource,
  expandFolderToContextValues,
  splitFolderPath,
  validateFolderPath,
} from "./folder-tree-model";

describe("splitFolderPath", () => {
  it("最初の / だけで分割する（2 個目以降は子名の一部）", () => {
    expect(splitFolderPath("プロジェクトA/実験1")).toEqual({
      parent: "プロジェクトA",
      leaf: "実験1",
    });
    expect(splitFolderPath("A/B/C")).toEqual({ parent: "A", leaf: "B/C" });
  });

  it("/ が無ければ parent = null", () => {
    expect(splitFolderPath("哲学")).toEqual({ parent: null, leaf: "哲学" });
  });

  it("分割すると空になる値は 1 階層として扱う", () => {
    expect(splitFolderPath("A/")).toEqual({ parent: null, leaf: "A/" });
    expect(splitFolderPath("/B")).toEqual({ parent: null, leaf: "/B" });
  });
});

describe("validateFolderPath", () => {
  it("通常名とサブフォルダは ok", () => {
    expect(validateFolderPath("材料X")).toBe("ok");
    expect(validateFolderPath("プロジェクトA/実験1")).toBe("ok");
  });

  it("空は empty、空セグメントは invalid", () => {
    expect(validateFolderPath("  ")).toBe("empty");
    expect(validateFolderPath("A/")).toBe("invalid");
    expect(validateFolderPath("/B")).toBe("invalid");
    expect(validateFolderPath("A//B")).toBe("invalid");
  });

  it("3 階層以上は tooDeep（2 階層制約）", () => {
    expect(validateFolderPath("A/B/C")).toBe("tooDeep");
  });
});

describe("buildFolderTree", () => {
  it("スラッシュ記法を 2 階層ツリーに組む（親の totalCount は直下 + 子合計）", () => {
    const tree = buildFolderTree([
      { value: "プロジェクトA", count: 4 },
      { value: "プロジェクトA/実験1", count: 5 },
      { value: "プロジェクトA/実験2", count: 3 },
      { value: "材料X", count: 8 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["プロジェクトA", "材料X"]);
    const [projectA, materialX] = tree;
    expect(projectA.directCount).toBe(4);
    expect(projectA.totalCount).toBe(12);
    expect(projectA.children.map((c) => ({ path: c.path, count: c.totalCount }))).toEqual([
      { path: "プロジェクトA/実験1", count: 5 },
      { path: "プロジェクトA/実験2", count: 3 },
    ]);
    expect(materialX.children).toEqual([]);
    expect(materialX.totalCount).toBe(8);
  });

  it("子タグしか無い親もフォルダとして実体化する（directCount 0）", () => {
    const tree = buildFolderTree([{ value: "研究/文献", count: 2 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("研究");
    expect(tree[0].directCount).toBe(0);
    expect(tree[0].totalCount).toBe(2);
  });

  it("親名は小文字比較で名寄せし、単独タグの表記を表示名に優先する", () => {
    const tree = buildFolderTree([
      { value: "eureco/設計", count: 1 },
      { value: "Eureco", count: 3 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Eureco");
    expect(tree[0].children[0].path).toBe("Eureco/設計");
    expect(tree[0].totalCount).toBe(4);
  });

  it("3 階層以上の既存タグは「親の子」として壊さず表示する", () => {
    const tree = buildFolderTree([{ value: "A/B/C", count: 1 }]);
    expect(tree[0].name).toBe("A");
    expect(tree[0].children[0].name).toBe("B/C");
    expect(tree[0].children[0].path).toBe("A/B/C");
  });

  it("空フォルダをマージする（既存と小文字名寄せで重複しない）", () => {
    const tree = buildFolderTree([{ value: "哲学", count: 2 }], ["下書き", "哲学"]);
    expect(tree.map((n) => ({ name: n.name, total: n.totalCount }))).toEqual([
      { name: "下書き", total: 0 },
      { name: "哲学", total: 2 },
    ]);
  });

  it("空フォルダはサブフォルダ定義も受け付ける", () => {
    const tree = buildFolderTree([], ["プロジェクトB/構想"]);
    expect(tree[0].name).toBe("プロジェクトB");
    expect(tree[0].children[0].totalCount).toBe(0);
  });

  it("並びは名前昇順（件数順にしない）", () => {
    const tree = buildFolderTree([
      { value: "ブログ", count: 100 },
      { value: "哲学", count: 1 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["ブログ", "哲学"]);
  });
});

describe("collectFolderSource", () => {
  it("人が書いた生きているノートだけ数える（wiki / skill / ゴミ箱 / アーカイブは除く）", () => {
    const result = collectFolderSource([
      { noteContexts: ["研究"] },
      { noteContexts: ["研究"], wikiKind: "claim" },
      { noteContexts: ["研究"], source: "skill" },
      { noteContexts: ["研究"], deletedAt: "2026-08-31T00:00:00Z" },
      { noteContexts: ["研究"], archivedAt: "2026-08-31T00:00:00Z" },
    ]);
    expect(result.folders).toEqual([{ value: "研究", count: 1 }]);
  });

  it("フォルダに入っていないノートを未分類として数える", () => {
    const result = collectFolderSource([
      { noteContexts: ["研究"] },
      { noteContexts: [] },
      {},
      { deletedAt: "2026-08-31T00:00:00Z" },
    ]);
    expect(result.unfiledCount).toBe(2);
  });
});

describe("expandFolderToContextValues", () => {
  const tree = buildFolderTree([
    { value: "プロジェクトA", count: 1 },
    { value: "プロジェクトA/実験1", count: 1 },
    { value: "プロジェクトA/実験2", count: 1 },
    { value: "材料X", count: 1 },
  ]);

  it("親を選ぶと子も含める（件数表示と同じ集合になる）", () => {
    expect(expandFolderToContextValues(tree, "プロジェクトA")).toEqual([
      "プロジェクトA",
      "プロジェクトA/実験1",
      "プロジェクトA/実験2",
    ]);
  });

  it("子を選んだらその子だけ", () => {
    expect(expandFolderToContextValues(tree, "プロジェクトA/実験1")).toEqual([
      "プロジェクトA/実験1",
    ]);
  });

  it("ツリーに無い値はそのまま返す（空フォルダ直後など）", () => {
    expect(expandFolderToContextValues(tree, "未知")).toEqual(["未知"]);
  });
});
