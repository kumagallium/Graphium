// calc ブロック評価エンジンのテスト
import { describe, it, expect } from "vitest";
import { evaluateSource, isCommentLine } from "./engine";

describe("evaluateSource", () => {
  it("空行とコメント行を素通しする", async () => {
    const results = await evaluateSource("# コメント\n\n// slash comment\n1 + 1");
    expect(results.map((r) => r.kind)).toEqual(["comment", "empty", "comment", "value"]);
    expect(results[3].text).toBe("2");
  });

  it("変数代入を後続行から参照できる（ブロック内スコープ）", async () => {
    const results = await evaluateSource("x = 3\ny = 4\nsqrt(x^2 + y^2)");
    expect(results[2]).toEqual({ kind: "value", text: "5" });
  });

  it("単位付き計算と単位換算ができる", async () => {
    const results = await evaluateSource("target = 5 g\ntarget / (2.5 g/mol)\n1 atm to kPa");
    expect(results[1].kind).toBe("value");
    expect(results[1].text).toBe("2 mol");
    expect(results[2].text).toMatch(/^101\.325 kPa$/);
  });

  it("秤量計算の代表例が解ける", async () => {
    const source = [
      "target = 5 g",
      "BaTiO3 = 233.19 g/mol",
      "BaCO3 = 197.34 g/mol",
      "mol = target / BaTiO3",
      "mol * BaCO3 to g",
    ].join("\n");
    const results = await evaluateSource(source);
    const last = results[4];
    expect(last.kind).toBe("value");
    // 5 / 233.19 * 197.34 = 4.2313135... g（精度 8 桁で丸め）
    expect(last.text).toBe("4.2313135 g");
  });

  it("表の列を文字列キーで参照して集計できる", async () => {
    // mathjs の識別子は ASCII 限定なので、日本語名は文字列キーで引く
    const tables = {
      秤量表: {
        質量: { values: [0.5, 0.33] },
        モル質量: { values: [197.34, 79.87] },
      },
    };
    const results = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\nmean(table["秤量表"]["モル質量"])\ntotal * 2',
      tables
    );
    expect(results[0]).toEqual({ kind: "value", text: "0.83" });
    expect(results[1]).toEqual({ kind: "value", text: "138.605" });
    expect(results[2]).toEqual({ kind: "value", text: "1.66" });
  });

  it("col() でも同じ列を引ける（短い書き方）", async () => {
    const tables = { 秤量表: { 質量: { values: [1, 2, 3] } } };
    const results = await evaluateSource('sum(col("秤量表", "質量"))', tables);
    expect(results[0]).toEqual({ kind: "value", text: "6" });
  });

  it("col() の無い表・無い列は理由の分かるエラーになる", async () => {
    const tables = { 秤量表: { 質量: { values: [1] } } };
    const results = await evaluateSource(
      'sum(col("無い表", "質量"))\nsum(col("秤量表", "無い列"))',
      tables
    );
    expect(results[0].kind).toBe("error");
    expect(results[0].text).toMatch(/table not found/);
    expect(results[1].kind).toBe("error");
    expect(results[1].text).toMatch(/column not found/);
  });

  it("列内で単位が揃っていれば、単位ごと計算される", async () => {
    const tables = { 秤量表: { 質量: { values: [1, 2], unit: "g" } } };
    const results = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\ntotal / 2',
      tables
    );
    expect(results[0]).toEqual({ kind: "value", text: "3 g" });
    expect(results[1]).toEqual({ kind: "value", text: "1.5 g" });
  });

  it("mathjs が知らない単位（個 など）は素の数値として計算される", async () => {
    const tables = { 集計: { 個数: { values: [3, 4], unit: "個" } } };
    const results = await evaluateSource('sum(table["集計"]["個数"])', tables);
    expect(results[0]).toEqual({ kind: "value", text: "7" });
  });

  it("table という名前に代入したら、以降はそちらが勝つ", async () => {
    const tables = { 秤量表: { 質量: { values: [1] } } };
    const results = await evaluateSource("table = 5\ntable + 1", tables);
    expect(results[1]).toEqual({ kind: "value", text: "6" });
  });

  it("表スコープを渡さなければ参照はエラー（他の行は動く）", async () => {
    const results = await evaluateSource('sum(table["秤量表"]["質量"])\n2 + 3');
    expect(results[0].kind).toBe("error");
    expect(results[1]).toEqual({ kind: "value", text: "5" });
  });

  it("エラー行があっても他の行の評価は続く", async () => {
    const results = await evaluateSource("nope + 1\n2 * 3");
    expect(results[0].kind).toBe("error");
    expect(results[1]).toEqual({ kind: "value", text: "6" });
  });

  it("評価ごとにスコープがリセットされる（前回の変数が残らない）", async () => {
    await evaluateSource("leak = 42");
    const results = await evaluateSource("leak + 1");
    expect(results[0].kind).toBe("error");
  });

  it("import は無効化されている", async () => {
    const results = await evaluateSource('import("something")');
    expect(results[0].kind).toBe("error");
  });
});

describe("isCommentLine", () => {
  it("# と // をコメントと判定する", () => {
    expect(isCommentLine("# メモ")).toBe(true);
    expect(isCommentLine("  // メモ")).toBe(true);
    expect(isCommentLine("1 + 1")).toBe(false);
  });
});
