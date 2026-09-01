// calc → 表への書き戻し
import { describe, expect, it } from "vitest";
import {
  applyCalcWritebacks,
  assignedVariableOf,
  extractReadColumns,
  parseCalcTargets,
  type CalcWritebackRequest,
} from "./writeback";

describe("parseCalcTargets", () => {
  it("正しい形だけを残す（壊れた JSON・欠けたフィールドは捨てる）", () => {
    expect(parseCalcTargets('{"w":{"tableBlockId":"t1","column":"秤量値"}}')).toEqual({
      w: { tableBlockId: "t1", column: "秤量値" },
    });
    expect(parseCalcTargets('{"w":{"tableBlockId":"t1"}}')).toEqual({});
    expect(parseCalcTargets("broken")).toEqual({});
    expect(parseCalcTargets("")).toEqual({});
    expect(parseCalcTargets("[1]")).toEqual({});
  });
});

describe("assignedVariableOf", () => {
  it("変数代入行から変数名を取る", () => {
    expect(assignedVariableOf("w = 5 * 2")).toBe("w");
    expect(assignedVariableOf("  total_2 = sum(x)")).toBe("total_2");
  });
  it("代入でない行・比較・日本語名は対象外（mathjs の識別子は ASCII 限定）", () => {
    expect(assignedVariableOf("1 + 2")).toBeNull();
    expect(assignedVariableOf("x == 3")).toBeNull();
    expect(assignedVariableOf('sum(table["a"]["b"])')).toBeNull();
    expect(assignedVariableOf("質量 = 3")).toBeNull();
  });
});

describe("extractReadColumns", () => {
  it("table[][] と col() の両記法から読み先を集める", () => {
    const reads = extractReadColumns(
      'a = sum(table["配合表"]["比率"])\nb = mean(col("秤量表", "質量"))\nc = column("表 1", "値")'
    );
    expect(reads).toEqual(new Set(["配合表 比率", "秤量表 質量", "表 1 値"]));
  });
});

/** テスト用の最小エディタ: getBlock と updateBlock だけ */
const cell = (text: string) => [{ type: "text", text, styles: {} }];
function makeEditor(rows: string[][]) {
  const block = {
    id: "t1",
    type: "table",
    content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
  };
  const updates: any[] = [];
  return {
    editor: {
      getBlock: (id: string) => (id === "t1" ? block : undefined),
      updateBlock: (_id: string, patch: any) => updates.push(patch),
    },
    updates,
  };
}

const request = (texts: string[]): Record<string, CalcWritebackRequest[]> => ({
  calc1: [{ tableBlockId: "t1", column: "秤量値", texts }],
});

describe("applyCalcWritebacks", () => {
  it("対象列のデータ行だけ書き換え、他の列・ヘッダは触らない", () => {
    const { editor, updates } = makeEditor([
      ["試料", "秤量値"],
      ["A", ""],
      ["B", "old"],
    ]);
    applyCalcWritebacks(editor, request(["3.5 g", "1.5 g"]));
    expect(updates).toHaveLength(1);
    const rows = updates[0].content.rows;
    expect(rows[0].cells[0]).toEqual(cell("試料"));
    expect(rows[1].cells[0]).toEqual(cell("A"));
    expect(rows[1].cells[1]).toEqual(cell("3.5 g"));
    expect(rows[2].cells[1]).toEqual(cell("1.5 g"));
  });

  it("値が行数より少ない分は空にし、余る分は捨てる", () => {
    const { editor, updates } = makeEditor([
      ["試料", "秤量値"],
      ["A", "stale"],
      ["B", "stale"],
    ]);
    applyCalcWritebacks(editor, request(["7"]));
    const rows = updates[0].content.rows;
    expect(rows[1].cells[1]).toEqual(cell("7"));
    expect(rows[2].cells[1]).toEqual([]); // 空セル
  });

  it("全セルが既に一致していれば updateBlock しない（収束の要）", () => {
    const { editor, updates } = makeEditor([
      ["試料", "秤量値"],
      ["A", "3.5 g"],
      ["B", "1.5 g"],
    ]);
    applyCalcWritebacks(editor, request(["3.5 g", "1.5 g"]));
    expect(updates).toHaveLength(0);
  });

  it("列が見つからない・表が無いときは何もしない", () => {
    const { editor, updates } = makeEditor([
      ["試料", "別の列"],
      ["A", "x"],
    ]);
    applyCalcWritebacks(editor, request(["1"]));
    applyCalcWritebacks(editor, {
      calc1: [{ tableBlockId: "missing", column: "秤量値", texts: ["1"] }],
    });
    expect(updates).toHaveLength(0);
  });
});
