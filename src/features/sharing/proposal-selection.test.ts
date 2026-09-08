// 取り込みの選択（proposal-selection）のテスト。
//
// ここで守りたいこと:
//   1. 既定で選ばれるのは「提案者だけが変えた」もの（both / unknown は人が判断する）
//   2. 表は既定でセル単位。丸ごと置き換えを既定にすると、元の作者が足した行まで消える
//   3. 親（丸ごと置き換え）と子（セル）は同時に選ばれない —— どちらのつもりだったのか
//      分からない状態を UI に作らない

import { describe, it, expect } from "vitest";
import {
  cellIdsOf,
  countSelected,
  defaultProposalSelection,
  isChangeSelectable,
  toggleProposalSelection,
} from "./proposal-selection";
import type { BlockChange, ProposalDiff, TableCellChange } from "./proposal-diff";

function block(over: Partial<BlockChange> & { id: string }): BlockChange {
  return {
    kind: "modified",
    by: "theirs",
    blockId: over.id.replace(/^block:/, ""),
    blockType: "paragraph",
    before: "",
    after: "",
    ...over,
  };
}

function cell(id: string, by: TableCellChange["by"]): TableCellChange {
  return {
    kind: "cellModified",
    id,
    by,
    rowLabel: "行",
    rowIndex: 0,
    column: "列",
    columnIndex: 0,
    before: "1",
    after: "2",
  };
}

function diffOf(blocks: BlockChange[], title?: ProposalDiff["title"]): ProposalDiff {
  return { blocks, unsupported: [], ...(title ? { title } : {}) };
}

describe("isChangeSelectable", () => {
  it("元の作者だけが変えたものは選べない（取り込む相手がいない）", () => {
    expect(isChangeSelectable("theirs")).toBe(true);
    expect(isChangeSelectable("both")).toBe(true);
    expect(isChangeSelectable("unknown")).toBe(true);
    expect(isChangeSelectable("mine")).toBe(false);
  });
});

describe("defaultProposalSelection", () => {
  it("theirs だけを選ぶ", () => {
    const diff = diffOf([
      block({ id: "block:a", by: "theirs" }),
      block({ id: "block:b", by: "both" }),
      block({ id: "block:c", by: "mine" }),
      block({ id: "block:d", by: "unknown" }),
    ]);
    expect([...defaultProposalSelection(diff)]).toEqual(["block:a"]);
  });

  it("題名も theirs のときだけ選ぶ", () => {
    const selected = defaultProposalSelection(
      diffOf([], { id: "title", by: "theirs", before: "旧", after: "新" }),
    );
    expect(selected.has("title")).toBe(true);
    const notSelected = defaultProposalSelection(
      diffOf([], { id: "title", by: "both", before: "旧", after: "新" }),
    );
    expect(notSelected.has("title")).toBe(false);
  });

  it("表は丸ごとではなくセル単位を既定にする", () => {
    const diff = diffOf([
      block({
        id: "block:t",
        kind: "table",
        by: "theirs",
        cells: [cell("cell:t:r1:c1", "theirs"), cell("cell:t:r2:c1", "both")],
      }),
    ]);
    const selected = defaultProposalSelection(diff);
    expect(selected.has("block:t")).toBe(false);
    expect(selected.has("cell:t:r1:c1")).toBe(true);
    expect(selected.has("cell:t:r2:c1")).toBe(false);
  });

  it("セルの内訳が読めなかった表は丸ごとの項目で選ぶ", () => {
    const diff = diffOf([block({ id: "block:t", kind: "table", by: "theirs", cells: [] })]);
    expect(defaultProposalSelection(diff).has("block:t")).toBe(true);
  });

  it("差分が無ければ空", () => {
    expect(defaultProposalSelection(null).size).toBe(0);
  });
});

describe("toggleProposalSelection", () => {
  const diff = diffOf([
    block({
      id: "block:t",
      kind: "table",
      by: "theirs",
      cells: [cell("cell:t:r1:c1", "theirs"), cell("cell:t:r2:c1", "theirs")],
    }),
  ]);

  it("親を選ぶと子は全部外れる", () => {
    const start = defaultProposalSelection(diff);
    expect(start.size).toBe(2);
    const next = toggleProposalSelection(diff, start, "block:t");
    expect([...next]).toEqual(["block:t"]);
  });

  it("子を選ぶと親が外れる", () => {
    const withParent = new Set(["block:t"]);
    const next = toggleProposalSelection(diff, withParent, "cell:t:r1:c1");
    expect(next.has("block:t")).toBe(false);
    expect(next.has("cell:t:r1:c1")).toBe(true);
  });

  it("もう一度押すと外れるだけ（他は動かさない）", () => {
    const next = toggleProposalSelection(diff, new Set(["cell:t:r1:c1", "cell:t:r2:c1"]), "cell:t:r1:c1");
    expect([...next]).toEqual(["cell:t:r2:c1"]);
  });

  it("元の Set は書き換えない", () => {
    const start = new Set(["cell:t:r1:c1"]);
    toggleProposalSelection(diff, start, "block:t");
    expect([...start]).toEqual(["cell:t:r1:c1"]);
  });
});

describe("countSelected / cellIdsOf", () => {
  it("親を選んでいるときは子を二重に数えない", () => {
    const diff = diffOf([
      block({
        id: "block:t",
        kind: "table",
        by: "theirs",
        cells: [cell("cell:t:r1:c1", "theirs"), cell("cell:t:r2:c1", "theirs")],
      }),
      block({ id: "block:p", by: "theirs" }),
    ]);
    expect(countSelected(diff, new Set(["block:t", "block:p"]))).toBe(2);
    expect(countSelected(diff, new Set(["cell:t:r1:c1", "cell:t:r2:c1"]))).toBe(2);
  });

  it("題名も 1 件として数える", () => {
    const diff = diffOf([], { id: "title", by: "theirs", before: "旧", after: "新" });
    expect(countSelected(diff, new Set(["title"]))).toBe(1);
  });

  it("cellIdsOf はセルの内訳が無いブロックで空", () => {
    expect(cellIdsOf(block({ id: "block:p" }))).toEqual([]);
  });
});
