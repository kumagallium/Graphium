import { describe, expect, it } from "vitest";
import { createFitFunctions, isPolyFit } from "./fit";

// 単位を扱わない既定の窓口で使う（単位まわりは engine 側の統合テストで見る）
const { coeffs, linspace, polyfit, polyval, r2, resetExtrapolation, takeExtrapolation } =
  createFitFunctions();

/** 熱電の実際の温度域に近い x（laser flash 側の測定点） */
const T_KAPPA = [300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
/** ZEM 側の測定点。刻みも端もずれている（これを揃えるのが目的） */
const T_ELEC = [323, 373, 423, 473, 523, 573, 623, 673, 723, 773];

describe("polyfit", () => {
  it("4 次多項式を係数レベルで復元する（高温側でも条件数に負けない）", () => {
    // κ(T) = 1e-9 T^4 - 2e-6 T^3 + 1.5e-3 T^2 - 0.5 T + 100
    const f = (T: number) => 1e-9 * T ** 4 - 2e-6 * T ** 3 + 1.5e-3 * T ** 2 - 0.5 * T + 100;
    const fit = polyfit(T_KAPPA, T_KAPPA.map(f), 4);
    expect(isPolyFit(fit)).toBe(true);
    expect(r2(fit)).toBeCloseTo(1, 10);
    for (const T of T_ELEC) {
      expect(polyval(fit, T) as number).toBeCloseTo(f(T), 6);
    }
  });

  it("正規化なしでは壊れる規模でも元スケールの係数を戻せる", () => {
    const f = (T: number) => 1e-9 * T ** 4 - 2e-6 * T ** 3 + 1.5e-3 * T ** 2 - 0.5 * T + 100;
    const fit = polyfit(T_KAPPA, T_KAPPA.map(f), 4);
    const c = coeffs(fit); // 降冪（numpy.polyfit と同じ並び）
    expect(c).toHaveLength(5);
    expect(c[0]).toBeCloseTo(1e-9, 12);
    expect(c[1]).toBeCloseTo(-2e-6, 9);
    expect(c[4]).toBeCloseTo(100, 3);
    // 素の係数配列でも polyval が同じ値を出す
    expect(polyval(c, 523) as number).toBeCloseTo(f(523), 6);
  });

  it("配列を渡せば配列で返る（相手の表の温度列をそのまま渡せる）", () => {
    const fit = polyfit(T_KAPPA, T_KAPPA.map((T) => 2 * T + 1), 1);
    const out = polyval(fit, T_ELEC);
    expect(Array.isArray(out)).toBe(true);
    expect(out as number[]).toHaveLength(T_ELEC.length);
    expect((out as number[])[0]).toBeCloseTo(647, 6);
  });

  it("スカラーを渡せばスカラーで返る", () => {
    const fit = polyfit([1, 2, 3], [2, 4, 6], 1);
    expect(polyval(fit, 4) as number).toBeCloseTo(8, 10);
  });

  it("x と y の片方が読めない行は捨ててペアの揃った点だけ使う", () => {
    const fit = polyfit([1, 2, NaN, 4], [2, 4, 6, 8], 1);
    expect(fit.n).toBe(3);
    expect(polyval(fit, 10) as number).toBeCloseTo(20, 8);
  });

  it("ノイズのある直線では R² が 1 未満になる", () => {
    const fit = polyfit([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1], 1);
    expect(r2(fit)).toBeGreaterThan(0.99);
    expect(r2(fit)).toBeLessThan(1);
  });
});

describe("polyfit の入力検証", () => {
  it("点数が次数+1 に足りなければ理由の分かるエラー", () => {
    expect(() => polyfit([1, 2, 3], [1, 2, 3], 4)).toThrow(/at least 5 points/);
  });

  it("長さが違えばエラー", () => {
    expect(() => polyfit([1, 2, 3], [1, 2], 1)).toThrow(/different lengths/);
  });

  it("次数が範囲外ならエラー", () => {
    expect(() => polyfit(T_KAPPA, T_KAPPA, 0)).toThrow(/degree/);
    expect(() => polyfit(T_KAPPA, T_KAPPA, 99)).toThrow(/degree/);
  });

  it("x が全部同じなら特異系としてエラー", () => {
    expect(() => polyfit([5, 5, 5], [1, 2, 3], 1)).toThrow(/singular/);
  });
});

describe("外挿の検出", () => {
  it("フィット範囲に収まっていれば警告は出ない", () => {
    resetExtrapolation();
    const fit = polyfit(T_KAPPA, T_KAPPA.map((T) => T), 1);
    polyval(fit, T_ELEC); // 323〜773 は 300〜800 の内側
    expect(takeExtrapolation()).toBeNull();
  });

  it("範囲外なら値は返しつつ、はみ出した端を報告する", () => {
    resetExtrapolation();
    // κ を 323 K から測り、電気特性が 300 K から始まる噛み合わせ（実測でよく起きる）
    const fit = polyfit([323, 373, 423, 473], [1, 2, 3, 4], 1);
    const out = polyval(fit, [300, 373, 500]) as number[];
    expect(out[1]).toBeCloseTo(2, 8);
    const range = takeExtrapolation();
    expect(range).not.toBeNull();
    // 報告するのはフィット範囲ではなく、はみ出した x の側だけ
    expect(range!.lo).toBe(300);
    expect(range!.hi).toBe(500);
  });

  it("片側だけはみ出したときは、その側の値だけを報告する", () => {
    resetExtrapolation();
    const fit = polyfit([300, 400, 500], [1, 2, 3], 1);
    polyval(fit, [350, 900]);
    const range = takeExtrapolation();
    // 下端は範囲内なので 300 を持ち出さない（持ち出すと下も外れたように読める）
    expect(range).toEqual({ lo: 900, hi: 900 });
  });

  it("報告は 1 回読むと消える（行をまたいで持ち越さない）", () => {
    resetExtrapolation();
    const fit = polyfit([1, 2, 3], [1, 2, 3], 1);
    polyval(fit, 100);
    expect(takeExtrapolation()).not.toBeNull();
    expect(takeExtrapolation()).toBeNull();
  });

  it("素の係数配列には範囲が無いので外挿判定もしない", () => {
    resetExtrapolation();
    polyval([1, 0], 99999);
    expect(takeExtrapolation()).toBeNull();
  });
});

describe("linspace", () => {
  it("端を含む等間隔列を返す", () => {
    const xs = linspace(300, 800, 6);
    expect(xs).toEqual([300, 400, 500, 600, 700, 800]);
  });

  it("点数が足りない・多すぎるときはエラー", () => {
    expect(() => linspace(0, 1, 1)).toThrow(/count/);
    expect(() => linspace(0, 1, 99999)).toThrow(/count/);
  });
});
