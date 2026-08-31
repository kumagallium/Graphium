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
    const scope = { table: { 秤量表: { 質量: [0.5, 0.33], モル質量: [197.34, 79.87] } } };
    const results = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\nmean(table["秤量表"]["モル質量"])\ntotal * 2',
      scope
    );
    expect(results[0]).toEqual({ kind: "value", text: "0.83" });
    expect(results[1]).toEqual({ kind: "value", text: "138.605" });
    expect(results[2]).toEqual({ kind: "value", text: "1.66" });
  });

  it("col() でも同じ列を引ける（短い書き方）", async () => {
    const scope = { col: (t: unknown, c: unknown) => (t === "秤量表" && c === "質量" ? [1, 2, 3] : []) };
    const results = await evaluateSource('sum(col("秤量表", "質量"))', scope);
    expect(results[0]).toEqual({ kind: "value", text: "6" });
  });

  it("同じ名前に代入したら、以降はそちらが勝つ", async () => {
    const results = await evaluateSource("total = 5\ntotal + 1", { total: 99 });
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
