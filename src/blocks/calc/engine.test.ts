// calc ブロック評価エンジンのテスト
import { describe, it, expect } from "vitest";
import { evaluateSource, isCommentLine } from "./engine";

describe("evaluateSource", () => {
  it("空行とコメント行を素通しする", async () => {
    const { lines: results } = await evaluateSource("# コメント\n\n// slash comment\n1 + 1");
    expect(results.map((r) => r.kind)).toEqual(["comment", "empty", "comment", "value"]);
    expect(results[3].text).toBe("2");
  });

  it("変数代入を後続行から参照できる（ブロック内スコープ）", async () => {
    const { lines: results } = await evaluateSource("x = 3\ny = 4\nsqrt(x^2 + y^2)");
    expect(results[2]).toEqual({ kind: "value", text: "5" });
  });

  it("単位付き計算と単位換算ができる", async () => {
    const { lines: results } = await evaluateSource("target = 5 g\ntarget / (2.5 g/mol)\n1 atm to kPa");
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
    const { lines: results } = await evaluateSource(source);
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
    const { lines: results } = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\nmean(table["秤量表"]["モル質量"])\ntotal * 2',
      tables
    );
    expect(results[0]).toEqual({ kind: "value", text: "0.83" });
    expect(results[1]).toEqual({ kind: "value", text: "138.605" });
    expect(results[2]).toEqual({ kind: "value", text: "1.66" });
  });

  it("col() でも同じ列を引ける（短い書き方）", async () => {
    const tables = { 秤量表: { 質量: { values: [1, 2, 3] } } };
    const { lines: results } = await evaluateSource('sum(col("秤量表", "質量"))', tables);
    expect(results[0]).toEqual({ kind: "value", text: "6" });
  });

  it("col() の無い表・無い列は理由の分かるエラーになる", async () => {
    const tables = { 秤量表: { 質量: { values: [1] } } };
    const { lines: results } = await evaluateSource(
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
    const { lines: results } = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\ntotal / 2',
      tables
    );
    expect(results[0]).toEqual({ kind: "value", text: "3 g" });
    expect(results[1]).toEqual({ kind: "value", text: "1.5 g" });
  });

  it("exportNames の変数はセルに書ける文字列になる（スカラー・配列・単位付き）", async () => {
    const tables = { 秤量表: { 質量: { values: [1, 2], unit: "g" } } };
    const { exports } = await evaluateSource(
      'total = sum(table["秤量表"]["質量"])\ndoubled = table["秤量表"]["質量"] * 2\nf(x) = x^2\nplain = 1.5',
      tables,
      ["total", "doubled", "f", "plain", "missing"],
    );
    expect(exports.total).toEqual(["3 g"]);
    expect(exports.doubled).toEqual(["2 g", "4 g"]);
    expect(exports.plain).toEqual(["1.5"]);
    // 関数・未定義の変数はセルに書けないので含まれない
    expect(exports.f).toBeUndefined();
    expect(exports.missing).toBeUndefined();
  });

  it("mathjs が知らない単位（個 など）は素の数値として計算される", async () => {
    const tables = { 集計: { 個数: { values: [3, 4], unit: "個" } } };
    const { lines: results } = await evaluateSource('sum(table["集計"]["個数"])', tables);
    expect(results[0]).toEqual({ kind: "value", text: "7" });
  });

  it("table という名前に代入したら、以降はそちらが勝つ", async () => {
    const tables = { 秤量表: { 質量: { values: [1] } } };
    const { lines: results } = await evaluateSource("table = 5\ntable + 1", tables);
    expect(results[1]).toEqual({ kind: "value", text: "6" });
  });

  it("表スコープを渡さなければ参照はエラー（他の行は動く）", async () => {
    const { lines: results } = await evaluateSource('sum(table["秤量表"]["質量"])\n2 + 3');
    expect(results[0].kind).toBe("error");
    expect(results[1]).toEqual({ kind: "value", text: "5" });
  });

  it("エラー行があっても他の行の評価は続く", async () => {
    const { lines: results } = await evaluateSource("nope + 1\n2 * 3");
    expect(results[0].kind).toBe("error");
    expect(results[1]).toEqual({ kind: "value", text: "6" });
  });

  it("評価ごとにスコープがリセットされる（前回の変数が残らない）", async () => {
    await evaluateSource("leak = 42");
    const { lines: results } = await evaluateSource("leak + 1");
    expect(results[0].kind).toBe("error");
  });

  it("import は無効化されている", async () => {
    const { lines: results } = await evaluateSource('import("something")');
    expect(results[0].kind).toBe("error");
  });
});

describe("多項式フィットで測定温度をそろえる", () => {
  // 熱電材料: κ は laser flash、S・σ は ZEM で測るので温度点がそろわない。
  // κ を 4 次で当てて電気特性側の温度で評価し直す、という現場の手順をそのまま書けるか
  const kappaT = [300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
  const kappaModel = (T: number) => 1e-9 * T ** 4 - 2e-6 * T ** 3 + 1.5e-3 * T ** 2 - 0.5 * T + 100;
  const elecT = [323, 373, 423, 473, 523];

  const tables = {
    熱伝導率: {
      T: { values: kappaT, unit: "K" },
      κ: { values: kappaT.map(kappaModel) },
    },
    電気特性: {
      T: { values: elecT, unit: "K" },
      S: { values: [120, 140, 160, 180, 200] },
      σ: { values: [900, 850, 800, 750, 700] },
    },
  };

  it("κ をフィットして電気特性の温度で ZT まで計算できる", async () => {
    const source = [
      'c = polyfit(col("熱伝導率","T"), col("熱伝導率","κ"), 4)',
      'kappaE = polyval(c, col("電気特性","T"))',
      // 列ごとの計算なので .^ / .* / ./（^ と * は mathjs では行列演算）
      'ZT = col("電気特性","S") .^ 2 .* col("電気特性","σ") .* col("電気特性","T") ./ kappaE',
    ].join("\n");
    const { lines, exports } = await evaluateSource(source, tables, ["kappaE", "ZT"]);
    expect(lines.map((r) => r.kind)).toEqual(["value", "value", "value"]);
    // フィット行は係数の羅列ではなく、次数と当てはまりを見せる
    expect(lines[0].text).toContain("4");
    expect(lines[0].text).toContain("R²");
    // 適用範囲は行に収まらないので hover 用の補足に回す
    expect(lines[0].detail).toContain("300");
    expect(lines[0].detail).toContain("800");
    expect(lines[0].detail).toContain("11");
    // 電気特性側の温度点の数だけ値が並び、そのまま列に書き戻せる
    expect(exports.kappaE).toHaveLength(elecT.length);
    expect(exports.ZT).toHaveLength(elecT.length);
    expect(Number(exports.kappaE[0])).toBeCloseTo(kappaModel(323), 6);
  });

  it("フィット以外の行には補足を付けない", async () => {
    const { lines } = await evaluateSource("1 + 1");
    expect(lines[0].detail).toBeUndefined();
  });

  it("フィット範囲の外で評価した行には警告が付く（値は返す）", async () => {
    const narrow = {
      熱伝導率: { T: { values: [400, 450, 500, 550] }, κ: { values: [3, 2.8, 2.6, 2.4] } },
      電気特性: { T: { values: [300, 450, 700] } },
    };
    const source = [
      'c = polyfit(col("熱伝導率","T"), col("熱伝導率","κ"), 1)',
      'kappaE = polyval(c, col("電気特性","T"))',
    ].join("\n");
    const { lines, exports } = await evaluateSource(source, narrow, ["kappaE"]);
    expect(lines[0].warn).toBeUndefined();
    expect(lines[1].kind).toBe("value");
    expect(lines[1].warn).toBeTruthy();
    expect(lines[1].warn).toContain("300");
    expect(lines[1].warn).toContain("700");
    // フィット範囲（400〜550）ではなく、はみ出した値の側を出す
    expect(lines[1].warn).not.toContain("400");
    // 警告が出ても値は揃っている
    expect(exports.kappaE).toHaveLength(3);
  });

  it("警告は行をまたいで持ち越さない", async () => {
    const source = [
      "c = polyfit([1, 2, 3], [1, 2, 3], 1)",
      "outside = polyval(c, 100)",
      "inside = polyval(c, 2)",
    ].join("\n");
    const { lines } = await evaluateSource(source);
    expect(lines[1].warn).toBeTruthy();
    // 1 点だけなら範囲ではなくその値を出す
    expect(lines[1].warn).toContain("100");
    expect(lines[2].warn).toBeUndefined();
  });

  it("点数不足などはその行だけエラーになり、他の行は動く", async () => {
    const source = ["bad = polyfit([1, 2], [1, 2], 4)", "1 + 1"].join("\n");
    const { lines } = await evaluateSource(source);
    expect(lines[0].kind).toBe("error");
    expect(lines[1]).toEqual({ kind: "value", text: "2" });
  });

  it("y の単位はフィットを通り抜けて結果に戻る（ZT が無次元になる）", async () => {
    const withUnits = {
      熱伝導率: {
        T: { values: [300, 400, 500, 600], unit: "K" },
        κ: { values: [4, 3, 2.5, 2.2], unit: "W / (m K)" },
      },
      電気特性: { T: { values: [350, 450], unit: "K" } },
    };
    const source = [
      'c = polyfit(col("熱伝導率","T"), col("熱伝導率","κ"), 2)',
      'kappaE = polyval(c, col("電気特性","T"))',
      "kappaE[1] * (1 m * 1 K / 1 W)",
    ].join("\n");
    const { lines } = await evaluateSource(source, withUnits);
    expect(lines[1].kind).toBe("value");
    // 単位が保たれていれば W/(m K) と m·K/W が打ち消えて無次元になる
    expect(lines[2].kind).toBe("value");
    expect(lines[2].text).not.toMatch(/[A-Za-z]/);
  });

  it("x の単位が違っても換算してから当てる（℃ と K の取り違えを潰す）", async () => {
    const mixed = {
      熱伝導率: {
        T: { values: [300, 400, 500], unit: "K" },
        κ: { values: [3, 2, 1] },
      },
      // 相手の表は摂氏で記録されている
      電気特性: { T: { values: [26.85], unit: "degC" } },
    };
    const source = [
      'c = polyfit(col("熱伝導率","T"), col("熱伝導率","κ"), 1)',
      'kappaE = polyval(c, col("電気特性","T"))',
    ].join("\n");
    const { exports } = await evaluateSource(source, mixed, ["kappaE"]);
    // 26.85 ℃ = 300 K → κ = 3。単位を無視すると 26.85 K として評価され桁が違う
    expect(Number(exports.kappaE[0])).toBeCloseTo(3, 3);
  });

  it("列に ^ を使ったら .^ を使うよう言い換える", async () => {
    const tables = { 電気特性: { S: { values: [1, 2, 3] } } };
    const { lines } = await evaluateSource('col("電気特性","S")^2', tables);
    expect(lines[0].kind).toBe("error");
    expect(lines[0].text).toContain(".^");
  });

  it("linspace でフィット曲線を描くための等間隔の温度を作れる", async () => {
    const source = ["xs = linspace(300, 800, 6)", "sum(xs)"].join("\n");
    const { lines, exports } = await evaluateSource(source, undefined, ["xs"]);
    expect(exports.xs).toEqual(["300", "400", "500", "600", "700", "800"]);
    expect(lines[1].text).toBe("3300");
  });
});

describe("isCommentLine", () => {
  it("# と // をコメントと判定する", () => {
    expect(isCommentLine("# メモ")).toBe(true);
    expect(isCommentLine("  // メモ")).toBe(true);
    expect(isCommentLine("1 + 1")).toBe(false);
  });
});
