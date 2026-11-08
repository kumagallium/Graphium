// 全体グラフの「束ね線」（試作）。
//
// Force-Directed Edge Bundling（Holten & van Wijk, 2009）を素直に実装したもの。
// レイアウト済みのノード座標と辺の一覧を受け取り、辺ごとの折れ線（両端を含む点列）を返す。
// 描画には関与しない（Canvas / Cytoscape のどちらにも渡せるよう、点列だけを返す）。
//
// 仕組み:
//   1. 各辺を等間隔の点に分ける（最初は 1 点）
//   2. 向き・長さ・位置が似た辺どうしを「なかま」とみなす（compatibility）
//   3. 点を、自分の辺の隣の点へ引くばね＋なかまの辺の同じ番目の点へ引く力で動かす
//   4. 周回ごとに分割数を倍・歩幅を半分にして細かくしていく
//
// 計算量は相性の判定が O(辺²)、反復が O(辺 × なかまの上限 × 分割数 × 反復)。

export type Point = { x: number; y: number };

export type BundleEdge = { source: Point; target: Point };

export type BundleOptions = {
  /** 1 反復で、隣の点の中点へ戻る割合（大きいほど辺がまっすぐに戻る。0〜1） */
  stiffness?: number;
  /** 周回の数。周回ごとに分割数が倍になる */
  cycles?: number;
  /** 最初の周回の反復回数（以後は周回ごとに 2/3 に減らす） */
  iterations?: number;
  /** 1 反復で、なかまの点の重み付き平均へ寄る割合（周回ごとに半分にする。0〜1） */
  stepSize?: number;
  /** これより相性が低い辺の組は引き合わせない（0〜1） */
  compatibilityThreshold?: number;
  /** 引き合う距離の目安（全体の対角線に対する割合）。遠いなかまほど弱く引く */
  reach?: number;
  /** 1 本の辺が引き合うなかまの上限（相性の高い順）。線が多いときの計算量を抑える */
  maxPartners?: number;
};

const DEFAULTS: Required<BundleOptions> = {
  stiffness: 0.05,
  cycles: 5,
  iterations: 50,
  stepSize: 0.3,
  compatibilityThreshold: 0.4,
  reach: 0.08,
  maxPartners: 20,
};

const EPS = 1e-6;

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
function len(v: Point): number {
  return Math.hypot(v.x, v.y);
}
function mid(e: BundleEdge): Point {
  return { x: (e.source.x + e.target.x) / 2, y: (e.source.y + e.target.y) / 2 };
}

/** 点 p を線分 e を延長した直線へ射影した点 */
function project(p: Point, e: BundleEdge): Point {
  const d = sub(e.target, e.source);
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 < EPS) return { ...e.source };
  const t = ((p.x - e.source.x) * d.x + (p.y - e.source.y) * d.y) / l2;
  return { x: e.source.x + t * d.x, y: e.source.y + t * d.y };
}

/** 可視性: e2 を e1 の上に射影したとき、e1 の中点から見てどれだけ重なるか */
function visibility(e1: BundleEdge, e2: BundleEdge): number {
  const i0 = project(e2.source, e1);
  const i1 = project(e2.target, e1);
  const im = { x: (i0.x + i1.x) / 2, y: (i0.y + i1.y) / 2 };
  const pm = mid(e1);
  const span = len(sub(i0, i1));
  if (span < EPS) return 0;
  return Math.max(0, 1 - (2 * len(sub(pm, im))) / span);
}

/**
 * 2 本の辺の相性（0〜1）。論文の 4 つの指標の積。
 * 向きが平行・長さが近い・位置が近い・互いに重なって見える ほど 1 に近い。
 */
export function edgeCompatibility(p: BundleEdge, q: BundleEdge): number {
  const vp = sub(p.target, p.source);
  const vq = sub(q.target, q.source);
  const lp = len(vp);
  const lq = len(vq);
  if (lp < EPS || lq < EPS) return 0;
  const angle = Math.abs((vp.x * vq.x + vp.y * vq.y) / (lp * lq));
  const lavg = (lp + lq) / 2;
  const scale = 2 / (lavg / Math.min(lp, lq) + Math.max(lp, lq) / lavg);
  const position = lavg / (lavg + len(sub(mid(p), mid(q))));
  if (angle * scale * position < EPS) return 0;
  const vis = Math.min(visibility(p, q), visibility(q, p));
  return angle * scale * position * vis;
}

/** 折れ線を、長さの等しい n 区間（n-1 個の内点）に分け直す。両端は保つ */
function resample(points: Point[], segments: number): Point[] {
  const total = points.reduce((s, p, i) => (i === 0 ? 0 : s + len(sub(p, points[i - 1]))), 0);
  if (total < EPS) return Array.from({ length: segments + 1 }, () => ({ ...points[0] }));
  const step = total / segments;
  const out: Point[] = [{ ...points[0] }];
  let acc = 0;
  let next = step;
  for (let i = 1; i < points.length && out.length < segments; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = len(sub(b, a));
    while (seg > EPS && acc + seg >= next - EPS && out.length < segments) {
      const t = (next - acc) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      next += step;
    }
    acc += seg;
  }
  while (out.length < segments) out.push({ ...points[points.length - 1] });
  out.push({ ...points[points.length - 1] });
  return out;
}

/**
 * 辺を束ねた点列を返す。戻り値の i 番目は edges[i] に対応し、両端（source / target）を含む。
 * 長さ 0 の辺（自己ループ等）は両端だけの直線のまま返す。
 */
export function bundleEdges(edges: BundleEdge[], options: BundleOptions = {}): Point[][] {
  const o = { ...DEFAULTS, ...options };
  const n = edges.length;

  // 相性の良い組を先に一覧にしておく（毎反復で全組を見ない）。重みは相性そのもの
  const partners: { j: number; w: number; same: boolean }[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = edgeCompatibility(edges[i], edges[j]);
      if (w < o.compatibilityThreshold) continue;
      const a = sub(edges[i].target, edges[i].source);
      const b = sub(edges[j].target, edges[j].source);
      // 向きが逆の辺は番目を反転させて対応させる
      const same = a.x * b.x + a.y * b.y >= 0;
      partners[i].push({ j, w, same });
      partners[j].push({ j: i, w, same });
    }
  }

  // 引き合う距離の目安 σ（全体の対角線 × reach）
  const xs = edges.flatMap((e) => [e.source.x, e.target.x]);
  const ys = edges.flatMap((e) => [e.source.y, e.target.y]);
  const diag = n === 0 ? 1 : Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const twoSigma2 = 2 * Math.max(EPS, diag * o.reach) ** 2;

  // なかまは相性の高い順に上限まで（線が密な所で計算が膨らまないように）
  for (const ps of partners) {
    if (ps.length > o.maxPartners) {
      ps.sort((a, b) => b.w - a.w);
      ps.length = o.maxPartners;
    }
  }

  let paths: Point[][] = edges.map((e) => [{ ...e.source }, mid(e), { ...e.target }]);
  let segments = 2;
  let step = o.stepSize;
  let iterations = o.iterations;

  for (let cycle = 0; cycle < o.cycles; cycle++) {
    if (cycle > 0) {
      segments *= 2;
      step /= 2;
      iterations = Math.max(1, Math.round((iterations * 2) / 3));
    }
    paths = paths.map((p) => resample(p, segments));

    for (let it = 0; it < iterations; it++) {
      const next = paths.map((p) => p.map((q) => ({ ...q })));
      for (let i = 0; i < n; i++) {
        const ps = partners[i];
        if (ps.length === 0) continue;
        const P = paths[i];
        for (let k = 1; k < segments; k++) {
          const cur = P[k];
          // ばね: 隣 2 点の中点へ戻る（両端が固定なので、なかまがいなければ直線に戻る）
          const sx = (P[k - 1].x + P[k + 1].x) / 2 - cur.x;
          const sy = (P[k - 1].y + P[k + 1].y) / 2 - cur.y;
          // 引力（mean shift）: 自分を含めた、なかまの辺の同じ番目の点の重み付き平均へ寄る。
          // 重み = 相性 × 距離のガウス。近いなかまほど強く引くので、局所的な束ができる
          // （全員の単純平均だと、なかまが四方にいるとき平均が自分の近くになり動かない）
          let mx = cur.x;
          let my = cur.y;
          let wsum = 1;
          for (const { j, w, same } of ps) {
            const other = paths[j][same ? k : segments - k];
            const dx = other.x - cur.x;
            const dy = other.y - cur.y;
            const g = w * Math.exp(-(dx * dx + dy * dy) / twoSigma2);
            mx += other.x * g;
            my += other.y * g;
            wsum += g;
          }
          const ax = mx / wsum - cur.x;
          const ay = my / wsum - cur.y;
          next[i][k].x += o.stiffness * sx + step * ax;
          next[i][k].y += o.stiffness * sy + step * ay;
        }
      }
      paths = next;
    }
  }
  return paths;
}
