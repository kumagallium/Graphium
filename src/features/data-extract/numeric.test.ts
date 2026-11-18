import { describe, expect, it } from "vitest";
import { applyExtract } from "./apply";
import { strictNumeric } from "./numeric";
import { profileColumns } from "./profile";

describe("strictNumeric", () => {
  it("単位・%・指数・桁区切りつきは数値", () => {
    expect(strictNumeric("12 g")).toBe(12);
    expect(strictNumeric("0.4 mm")).toBe(0.4);
    expect(strictNumeric("35%")).toBe(35);
    expect(strictNumeric("-3.2e5")).toBe(-320000);
    expect(strictNumeric("1,234.5")).toBe(1234.5);
    expect(strictNumeric(" 7 ")).toBe(7);
  });
  it("日付・版番号・時刻・分数・範囲は数値でない", () => {
    for (const v of ["2024-01-05", "3.5.2", "12:30", "1/2", "10-20", "abc", ""]) {
      expect(strictNumeric(v)).toBeNull();
    }
  });
});

describe("日付の列", () => {
  const headers = ["date", "v"];
  const rows = [
    ["2024-01-05", "1"],
    ["2024-02-10", "2"],
    ["2024-01-05", "3"],
    ["2023-12-31", "4"],
  ];
  it("列の種類は text になる", () => {
    expect(profileColumns(headers, rows).find((p) => p.name === "date")!.kind).toBe("text");
    expect(profileColumns(headers, rows).find((p) => p.name === "v")!.kind).toBe("number");
  });
  it("eq 2024-01-05 はその日だけに一致する（2024 年の全行ではない）", () => {
    const r = applyExtract(headers, rows, {
      columns: [],
      conditions: [{ column: "date", op: "eq", value: "2024-01-05" }],
    });
    expect(r.rows.map((x) => x[1])).toEqual(["1", "3"]);
  });
  it("大小比較は両方が厳密な数値のときだけ（日付の値では何も一致しない）", () => {
    const r = applyExtract(headers, rows, {
      columns: [],
      conditions: [{ column: "date", op: "ge", value: "2024" }],
    });
    expect(r.rows).toHaveLength(0);
  });
  it("数値の列では単位つきの値も大小比較できる", () => {
    const r = applyExtract(["w"], [["12 g"], ["30 g"], ["2024-01-05"], ["5 g"], ["7 g"], ["9 g"], ["11 g"], ["13 g"], ["15 g"], ["17 g"]], {
      columns: [],
      conditions: [{ column: "w", op: "ge", value: "12" }],
    });
    expect(r.rows.map((x) => x[0])).toEqual(["12 g", "30 g", "13 g", "15 g", "17 g"]);
  });
});
