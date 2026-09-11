// 計算ブロックの多項式フィッティング
//
//   c  = polyfit(col("熱伝導率","T"), col("熱伝導率","κ"), 4)
//   κe = polyval(c, col("電気特性","T"))
//
// 測定機器ごとに温度点が違う物性値（熱電材料の κ と S・σ が典型）を、
// 片方を多項式で近似して相手の温度点に揃えるための最小の道具立て。
// mathjs には多項式フィットが無いので自前で持つ。
//
// 設計の決め事:
// - **フィットは値ではなくオブジェクト**。係数だけを裸で返すと、正規化の情報と
//   当てはまりの指標（R²）と適用範囲が式から消える。polyval に渡す相手は
//   このオブジェクトで、素の係数配列も受け付ける（他所で計算した係数を使う道）
// - **必ず中心化・スケーリングしてから解く**。T = 300〜800 K を 4 次で解くと
//   Vandermonde 行列の条件数が 10^12 級になり、素直に解くと係数が壊れる。
//   u = (x - center) / scale で u ∈ [-1, 1] に写してから正規方程式を解く
// - **単位は落とさず持ち回る**。フィット自体は無次元で行うが、x の単位を覚えておいて
//   polyval に渡された x を同じ単位へ換算し、結果には y の単位を付け直す。
//   ここを素通りさせると、κ の単位が消えて ZT が無次元にならない／片方の表が ℃ で
//   もう片方が K のときに黙って食い違う、という静かな事故になる
// - **外挿は止めないが黙認もしない**。電気特性の温度が κ の測定範囲から
//   はみ出るのは熱電では日常（300 K 始まり vs 323 K 始まり）。値は返した上で
//   行に警告を出す。throw にすると ZT の計算列ごと落ちて使い物にならない

/** mathjs の単位を扱うための最小の窓口。fit.ts は mathjs を直接読まない */
export type UnitAdapter = {
  /** 値に付いている単位表記。素の数値なら null */
  unitOf(v: unknown): string | null;
  /** 値を指定単位での数値にする。換算できなければ throw */
  toNumberIn(v: unknown, unit: string): number;
  /** 数値に単位を付け直す */
  make(value: number, unit: string): unknown;
};

/** 単位を扱わない既定の窓口（テストと、単位なしで使う経路） */
export const plainUnitAdapter: UnitAdapter = {
  unitOf: () => null,
  toNumberIn: (v) => toNumber(v),
  make: (value) => value,
};

/** polyfit の結果。polyval / coeffs / r2 の入口になる */
export type PolyFit = {
  readonly __polyfit: true;
  /** 正規化された基底 u = (x - center) / scale での係数。昇冪（[a0, a1, …]） */
  normCoeffs: number[];
  center: number;
  scale: number;
  degree: number;
  /** 決定係数。y が全て同値などで定義できないときは NaN */
  r2: number;
  /** フィットに使った x の範囲（xUnit での値。外挿判定に使う） */
  xMin: number;
  xMax: number;
  /** 実際に使った点数（x, y が揃った行だけ） */
  n: number;
  /** x 側の単位。polyval に渡された x をこの単位へ換算する */
  xUnit: string | null;
  /** y 側の単位。polyval の結果にこれを付け直す */
  yUnit: string | null;
};

export function isPolyFit(v: unknown): v is PolyFit {
  return !!v && typeof v === "object" && (v as { __polyfit?: unknown }).__polyfit === true;
}

/** 単位を持たない値を素の数値にする */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return NaN;
}

/** mathjs の Matrix / 配列 / スカラーを素の配列に開く */
function toArray(v: unknown): unknown[] {
  const plain =
    v && typeof (v as { toArray?: () => unknown[] }).toArray === "function"
      ? (v as { toArray: () => unknown[] }).toArray()
      : v;
  return Array.isArray(plain) ? plain : [plain];
}

/** 配列全体で単位が揃っていればその単位。混在・無単位なら null */
function commonUnit(adapter: UnitAdapter, values: unknown[]): string | null {
  let unit: string | null = null;
  for (const v of values) {
    const u = adapter.unitOf(v);
    if (u === null) return null;
    if (unit === null) unit = u;
    else if (unit !== u) return null;
  }
  return unit;
}

/** 正方行列の連立一次方程式を部分ピボット付きガウス消去で解く */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
    }
    if (Math.abs(m[pivot][k]) < 1e-14) throw new Error("polyfit: singular system (duplicate x?)");
    if (pivot !== k) [m[k], m[pivot]] = [m[pivot], m[k]];
    for (let i = k + 1; i < n; i++) {
      const f = m[i][k] / m[k][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x;
}

/** 昇冪係数（正規化基底）を u で評価する。Horner 法 */
function evalNorm(coeffs: number[], u: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * u + coeffs[i];
  return acc;
}

/**
 * 外挿が起きた範囲。フィット範囲そのものではなく、**はみ出した x の最小と最大**を持つ。
 * 高温側だけはみ出したときに「300〜900」と出ると、下端も外れていたように読めるため。
 */
export type ExtrapolationRange = { lo: number; hi: number };

export type FitFunctions = {
  polyfit: (x: unknown, y: unknown, degree: unknown) => PolyFit;
  polyval: (fit: unknown, x: unknown) => unknown;
  coeffs: (fit: unknown) => number[];
  r2: (fit: unknown) => number;
  linspace: (start: unknown, stop: unknown, count: unknown) => number[];
  /** 直前の polyval で範囲外の x が使われたかを取り出して消す（行ごとに engine が読む） */
  takeExtrapolation: () => ExtrapolationRange | null;
  /** 行の評価前に持ち越しを捨てる */
  resetExtrapolation: () => void;
};

/**
 * 計算ブロックのスコープに入れるフィット関数一式を作る。
 * 外挿の記録は 1 回の評価に閉じたいので、モジュール変数ではなくここの閉包に持つ。
 */
export function createFitFunctions(adapter: UnitAdapter = plainUnitAdapter): FitFunctions {
  let lastExtrapolation: ExtrapolationRange | null = null;

  /** x, y を「フィットに使う素の数値」に落とす。単位は揃っていれば覚えて剥がす */
  function numbersOf(values: unknown[], unit: string | null): number[] {
    if (!unit) return values.map(toNumber);
    return values.map((v) => {
      try {
        return adapter.toNumberIn(v, unit);
      } catch {
        return NaN;
      }
    });
  }

  function polyfit(xRaw: unknown, yRaw: unknown, degreeRaw: unknown): PolyFit {
    const xValues = toArray(xRaw);
    const yValues = toArray(yRaw);
    const degree = Math.trunc(toNumber(degreeRaw));
    if (!Number.isFinite(degree) || degree < 1 || degree > 10) {
      throw new Error("polyfit: degree must be an integer between 1 and 10");
    }
    if (xValues.length !== yValues.length) {
      throw new Error(
        `polyfit: x and y have different lengths (${xValues.length} vs ${yValues.length})`,
      );
    }
    const xUnit = commonUnit(adapter, xValues);
    const yUnit = commonUnit(adapter, yValues);
    const xs = numbersOf(xValues, xUnit);
    const ys = numbersOf(yValues, yUnit);

    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        x.push(xs[i]);
        y.push(ys[i]);
      }
    }
    if (x.length < degree + 1) {
      throw new Error(
        `polyfit: need at least ${degree + 1} points for degree ${degree} (got ${x.length})`,
      );
    }

    const xMin = Math.min(...x);
    const xMax = Math.max(...x);
    const center = (xMin + xMax) / 2;
    // u を [-1, 1] に収める。全点同じ x のときは 1 に逃がす（solve 側で特異として弾かれる）
    const scale = (xMax - xMin) / 2 || 1;
    const u = x.map((v) => (v - center) / scale);

    // 正規方程式 (V^T V) a = V^T y。u ∈ [-1, 1] なので低次では条件数が実用域に収まる
    const size = degree + 1;
    // powerSums[k] = Σ u^k。Gram 行列の各要素 (r, c) はこの和 powerSums[r + c] で書ける
    const powerSums = new Array<number>(2 * degree + 1).fill(0);
    for (const ui of u) {
      let p = 1;
      for (let k = 0; k <= 2 * degree; k++) {
        powerSums[k] += p;
        p *= ui;
      }
    }
    const rhs = new Array<number>(size).fill(0);
    for (let i = 0; i < u.length; i++) {
      let p = 1;
      for (let k = 0; k < size; k++) {
        rhs[k] += p * y[i];
        p *= u[i];
      }
    }
    const gram: number[][] = [];
    for (let r = 0; r < size; r++) {
      const row = new Array<number>(size);
      for (let c = 0; c < size; c++) row[c] = powerSums[r + c];
      gram.push(row);
    }
    const normCoeffs = solve(gram, rhs);

    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < u.length; i++) {
      const d = y[i] - evalNorm(normCoeffs, u[i]);
      ssRes += d * d;
      const tot = y[i] - mean;
      ssTot += tot * tot;
    }
    const r2Value = ssTot === 0 ? NaN : 1 - ssRes / ssTot;

    return {
      __polyfit: true,
      normCoeffs,
      center,
      scale,
      degree,
      r2: r2Value,
      xMin,
      xMax,
      n: x.length,
      xUnit,
      yUnit,
    };
  }

  function polyval(fitRaw: unknown, xRaw: unknown): unknown {
    const xValues = toArray(xRaw);
    const isArray =
      Array.isArray(xRaw) ||
      (!!xRaw && typeof (xRaw as { toArray?: unknown }).toArray === "function");

    let out: unknown[];
    if (isPolyFit(fitRaw)) {
      const fit = fitRaw;
      // フィット時と同じ単位に揃えてから評価する（K と ℃ の取り違えはここで潰す）
      const xs = fit.xUnit
        ? xValues.map((v) => {
            if (adapter.unitOf(v) === null) return toNumber(v); // 素の数値は同じ単位とみなす
            return adapter.toNumberIn(v, fit.xUnit!);
          })
        : xValues.map(toNumber);

      let lo = Infinity;
      let hi = -Infinity;
      for (const v of xs) {
        if (!Number.isFinite(v)) continue;
        if (v < fit.xMin || v > fit.xMax) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (lo !== Infinity) lastExtrapolation = { lo, hi };

      out = xs.map((v) => {
        if (!Number.isFinite(v)) return NaN;
        const y = evalNorm(fit.normCoeffs, (v - fit.center) / fit.scale);
        return fit.yUnit ? adapter.make(y, fit.yUnit) : y;
      });
    } else {
      // 素の係数配列は降冪（numpy / MATLAB の polyval と同じ並び）。単位は扱わない
      const desc = toArray(fitRaw).map(toNumber);
      if (desc.length === 0 || desc.some((v) => !Number.isFinite(v))) {
        throw new Error("polyval: first argument must be a fit or a list of coefficients");
      }
      out = xValues.map((v) => {
        const xn = toNumber(v);
        if (!Number.isFinite(xn)) return NaN;
        let acc = 0;
        for (const c of desc) acc = acc * xn + c;
        return acc;
      });
    }

    return isArray ? out : out[0];
  }

  /**
   * 元の x スケールでの係数を降冪で返す（numpy.polyfit と同じ並び）。
   * 正規化基底の係数を二項展開で x の冪に戻す。論文に係数を載せるための出口なので、
   * 単位は付けない（次数ごとに次元が変わるため、値だけを出す）。
   */
  function coeffs(fitRaw: unknown): number[] {
    if (!isPolyFit(fitRaw)) throw new Error("coeffs: argument must be a polyfit result");
    const { normCoeffs, center, scale } = fitRaw;
    const asc = new Array<number>(normCoeffs.length).fill(0);
    for (let k = 0; k < normCoeffs.length; k++) {
      // a_k * ((x - center)/scale)^k を展開して x^j の係数に足し込む
      const ak = normCoeffs[k] / Math.pow(scale, k);
      let binom = 1; // C(k, j)
      for (let j = k; j >= 0; j--) {
        asc[j] += ak * binom * Math.pow(-center, k - j);
        binom = (binom * j) / (k - j + 1);
      }
    }
    return asc.reverse();
  }

  function r2(fitRaw: unknown): number {
    if (!isPolyFit(fitRaw)) throw new Error("r2: argument must be a polyfit result");
    return fitRaw.r2;
  }

  /** 等間隔の数列。フィット曲線を細かく描くための x を作る */
  function linspace(startRaw: unknown, stopRaw: unknown, countRaw: unknown): number[] {
    const start = toNumber(startRaw);
    const stop = toNumber(stopRaw);
    const count = Math.trunc(toNumber(countRaw));
    if (!Number.isFinite(start) || !Number.isFinite(stop)) {
      throw new Error("linspace: start and stop must be numbers");
    }
    if (!Number.isFinite(count) || count < 2 || count > 10000) {
      throw new Error("linspace: count must be an integer between 2 and 10000");
    }
    const step = (stop - start) / (count - 1);
    return Array.from({ length: count }, (_, i) => start + step * i);
  }

  return {
    polyfit,
    polyval,
    coeffs,
    r2,
    linspace,
    takeExtrapolation: () => {
      const r = lastExtrapolation;
      lastExtrapolation = null;
      return r;
    },
    resetExtrapolation: () => {
      lastExtrapolation = null;
    },
  };
}

/** 境界値の丸め。桁を出しすぎると読めなくなる */
export function formatBound(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return String(Math.round(v * 1000) / 1000);
}

/** フィットの結果表示。係数の羅列ではなく、次数・当てはまり・適用範囲を見せる */
export function formatFit(
  fit: PolyFit,
  label: (key: string, params?: Record<string, string>) => string,
): string {
  return label("calc.fitSummary", {
    degree: String(fit.degree),
    r2: Number.isFinite(fit.r2) ? fit.r2.toFixed(4) : "—",
    min: formatBound(fit.xMin),
    max: formatBound(fit.xMax),
    n: String(fit.n),
  });
}
