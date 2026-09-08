import { describe, expect, it } from "vitest";
import { linkedColumnsFor, mergeLinkedColumns } from "./linked";

const writebacks = {
  calcA: [
    { tableBlockId: "dt1", column: "d", texts: ["1", "2", "3"], calcName: "換算" },
    { tableBlockId: "other", column: "x", texts: ["9"] },
  ],
  calcB: [
    { tableBlockId: "dt1", column: "d", texts: ["7", "8", "9"] }, // 同名は先勝ち
    { tableBlockId: "dt1", column: " ratio ", texts: [0.5, null, 1] },
    { tableBlockId: "dt1", column: "", texts: ["x"] }, // 空名は無視
  ],
};

describe("linkedColumnsFor", () => {
  it("このデータ表宛ての宣言だけを文書順で集め、同名は先勝ち・名前は trim・値は文字列化する", () => {
    const linked = linkedColumnsFor("dt1", writebacks);
    expect(linked.map((l) => l.name)).toEqual(["d", "ratio"]);
    expect(linked[0].texts).toEqual(["1", "2", "3"]);
    expect(linked[0].calcName).toBe("換算");
    expect(linked[1].texts).toEqual(["0.5", "", "1"]);
    expect(linked[1].calcName).toBeUndefined();
  });

  it("宣言が無ければ空", () => {
    expect(linkedColumnsFor("dt1", null)).toEqual([]);
    expect(linkedColumnsFor("dt1", {})).toEqual([]);
  });
});

describe("mergeLinkedColumns", () => {
  const data = { headers: ["t", "v"], rows: [["0", "10"], ["1", "20"], ["2", "30"]] };

  it("計算列を右に足し、行数より短い分は空にする", () => {
    const merged = mergeLinkedColumns(data, [{ name: "d", texts: ["a", "b"] }]);
    expect(merged?.data.headers).toEqual(["t", "v", "d"]);
    expect(merged?.data.rows).toEqual([["0", "10", "a"], ["1", "20", "b"], ["2", "30", ""]]);
    expect(merged?.linked.map((l) => l.name)).toEqual(["d"]);
  });

  it("素材に同名の列があれば足さない（素材が勝つ）", () => {
    const merged = mergeLinkedColumns(data, [{ name: "v", texts: ["x"] }]);
    expect(merged?.data).toBe(data);
    expect(merged?.linked).toEqual([]);
  });

  it("data が null なら null", () => {
    expect(mergeLinkedColumns(null, [{ name: "d", texts: [] }])).toBeNull();
  });
});
