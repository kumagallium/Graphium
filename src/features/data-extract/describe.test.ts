import { beforeEach, describe, expect, it } from "vitest";
import { syncLocale, t } from "../../i18n";
import { describeCondition, describeSpec } from "./describe";

describe("describeCondition / describeSpec", () => {
  beforeEach(() => syncLocale("ja"));

  it("演算子ごとに 1 行にする", () => {
    expect(describeCondition({ column: "prop_y", op: "eq", value: "Seebeck coefficient" }, t)).toBe(
      "prop_y = Seebeck coefficient"
    );
    expect(describeCondition({ column: "temperature", op: "ge", value: "300" }, t)).toBe(
      "temperature ≥ 300"
    );
    expect(describeCondition({ column: "comment", op: "contains", value: "ok" }, t)).toBe(
      'comment を含む "ok"'
    );
    expect(describeCondition({ column: "value", op: "notEmpty" }, t)).toBe("value が空でない");
  });

  it("spec は列と条件をまとめ、書きかけの条件は出さない", () => {
    expect(
      describeSpec(
        {
          columns: ["time", "temp_c"],
          conditions: [
            { column: "temp_c", op: "gt", value: "200" },
            { column: "dough", op: "eq", value: "" },
            { column: "note", op: "notEmpty" },
          ],
        },
        t
      )
    ).toBe("列: time, temp_c / temp_c > 200 かつ note が空でない");
  });

  it("何も絞らない spec は全列・全行", () => {
    expect(describeSpec({ columns: [], conditions: [] }, t)).toBe("全列・全行");
  });

  it("英語でも同じ形", () => {
    syncLocale("en");
    expect(describeCondition({ column: "x", op: "contains", value: "a" }, t)).toBe('x contains "a"');
  });
});
