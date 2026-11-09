// 全体グラフの「発火」。最近 AI に使われたページ（usage-activity.ts の重み）から、
// つながる線に沿って火花が走り、届いた先が弱く光って、確率で次の隣へ伝わる。
// 走った線にはしばらく残光が残る。島をまたぐ束（island-edge-bundling.ts）を
// 何度も走ると、そこが流れとして浮かぶ。
//
// cytoscape の上に重ねた canvas に描く（ノード・線そのものは触らない。クリックや
// ホバーはそのまま効く）。線の形は公開 API（sourceEndpoint / targetEndpoint /
// controlPoints）から組み立てるので、束ねた曲線にも沿って走る。
//
// OS の「視差効果を減らす」が有効なときは何も動かさない（呼び出し側で判定する）。

import type cytoscape from "cytoscape";

type Pt = { x: number; y: number };

type Spark = {
  e: cytoscape.EdgeSingular;
  from: cytoscape.NodeSingular;
  to: cytoscape.NodeSingular;
  t0: number;
  dur: number;
  s: number;
  depth: number;
  done?: boolean;
};
type Trail = { e: cytoscape.EdgeSingular; from: cytoscape.NodeSingular; t0: number; s: number };
type Flash = { n: cytoscape.NodeSingular; t0: number; s: number };

/** 火花の色（Graphium の「派生」の緑より少し明るい緑） */
const SPARK_RGB = "62, 140, 78";
const TRAIL_MS = 1800;
const FLASH_MS = 900;
/** 発火の間隔の平均。重みの強いページほど選ばれやすい */
const FIRE_EVERY_MS = 1100;
/** 連鎖の深さの上限（1 段目 → 2 段目 → 3 段目まで） */
const MAX_DEPTH = 2;

/** 束ねた線（島をまたぐ流れ）の残光は長めに残す */
const trailMs = (e: cytoscape.EdgeSingular) => (e.hasClass("bundled") ? TRAIL_MS * 1.6 : TRAIL_MS);

/**
 * 線が描かれている形（モデル座標の折れ線）を from 側から返す。
 * cytoscape の unbundled-bezier / bezier は、制御点の中点をつなぐ 2 次ベジェの列で
 * 描かれる（始点 → c1 → (c1+c2)/2 → c2 → … → cN → 終点）。それをなぞる。
 * 制御点の無い線は直線。
 */
export function edgeModelPath(
  source: Pt,
  target: Pt,
  controls: readonly Pt[] | undefined,
  steps = 8,
): Pt[] {
  if (!controls || controls.length === 0) return [source, target];
  // 2 次ベジェの区切り: 始点, c1, m12, c2, m23, …, cN, 終点
  const knots: Pt[] = [source];
  for (let i = 0; i < controls.length; i++) {
    knots.push(controls[i]);
    if (i < controls.length - 1) {
      knots.push({ x: (controls[i].x + controls[i + 1].x) / 2, y: (controls[i].y + controls[i + 1].y) / 2 });
    }
  }
  knots.push(target);
  const out: Pt[] = [source];
  for (let i = 0; i + 2 < knots.length; i += 2) {
    const p0 = knots[i];
    const c = knots[i + 1];
    const p1 = knots[i + 2];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
    }
  }
  return out;
}

/** 折れ線の累積長 */
export function cumulativeLengths(path: readonly Pt[]): number[] {
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return acc;
}

/** 折れ線上の割合 f（0〜1）の位置 */
export function pointAlong(path: readonly Pt[], acc: readonly number[], f: number): Pt {
  const total = acc[acc.length - 1];
  if (path.length === 1 || total <= 0) return path[0];
  const d = Math.max(0, Math.min(1, f)) * total;
  let i = 1;
  while (i < acc.length - 1 && acc[i] < d) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const k = Math.max(0, Math.min(1, (d - acc[i - 1]) / seg));
  return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * k, y: path[i - 1].y + (path[i].y - path[i - 1].y) * k };
}

/** 画面座標の折れ線（from 側から） */
function renderedPath(cy: cytoscape.Core, e: cytoscape.EdgeSingular, from: cytoscape.NodeSingular): Pt[] {
  let model: Pt[];
  try {
    const cps = (e as unknown as { controlPoints?: () => Pt[] | undefined }).controlPoints?.();
    model = edgeModelPath(e.sourceEndpoint(), e.targetEndpoint(), cps);
  } catch {
    model = [{ ...e.source().position() }, { ...e.target().position() }];
  }
  const z = cy.zoom();
  const pan = cy.pan();
  const out = model.map((p) => ({ x: p.x * z + pan.x, y: p.y * z + pan.y }));
  return e.source().same(from) ? out : out.reverse();
}

/** 割合 f0〜f1 の部分を線として引く（beginPath から stroke の手前まで） */
function tracePart(ctx: CanvasRenderingContext2D, path: Pt[], acc: number[], f0: number, f1: number) {
  const total = acc[acc.length - 1] || 1;
  const p0 = pointAlong(path, acc, f0);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < path.length - 1; i++) {
    const f = acc[i] / total;
    if (f > f0 && f < f1) ctx.lineTo(path[i].x, path[i].y);
  }
  const p1 = pointAlong(path, acc, f1);
  ctx.lineTo(p1.x, p1.y);
}

/** 決まった種から作る乱数（見た目の確認・撮影で同じ動きを再現できるように） */
export function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一度きりの発火で、ページごとに火を付ける間隔と、一度に付ける数の上限 */
const ONCE_STAGGER_MS = 180;
const ONCE_MAX_PAGES = 12;

/**
 * 発火の仕方。
 * - loop（既定）: 重みに比例して選んだページから、ずっと繰り返し発火させる（全体グラフ）
 * - once: 一番強い（重み 1）ページだけを一度ずつ順に発火させ、火花と残光が消えたら
 *   自分で止まる（チャットの横のグラフ。答えが返ったときだけ動かすため）
 * - pulse: once と同じ選び方で、線に火花を走らせずページが一度光るだけ（AI が読んだ瞬間）
 */
export type GraphFiringMode = "loop" | "once" | "pulse";

/** once で発火させるページ（重み 1 のものだけ、上限つき）。純粋な選択なので分けてある */
export function pickOnceFiringIds(weights: ReadonlyMap<string, number>, max: number = ONCE_MAX_PAGES): string[] {
  const out: string[] = [];
  for (const [id, w] of weights) {
    if (out.length >= max) break;
    if (w >= 0.999) out.push(id);
  }
  return out;
}

/**
 * 発火を始める。重みが 1 つも無ければ何もしない。戻り値で止める（canvas も外す）。
 * weights のキーは全体グラフのノード ID、値は 0〜1。
 */
export function startGraphFiring(
  cy: cytoscape.Core,
  weights: ReadonlyMap<string, number>,
  rng: () => number = Math.random,
  mode: GraphFiringMode = "loop",
): () => void {
  const container = cy.container();
  const active: { n: cytoscape.NodeSingular; w: number }[] = [];
  const onceIds = mode !== "loop" ? new Set(pickOnceFiringIds(weights)) : null;
  for (const [id, w] of weights) {
    if (onceIds && !onceIds.has(id)) continue;
    const n = cy.getElementById(id);
    if (n.nonempty() && n.isNode() && w > 0) active.push({ n: n as cytoscape.NodeSingular, w });
  }
  if (!container || active.length === 0) return () => {};

  const canvas = document.createElement("canvas");
  // cytoscape の renderedPosition はコンテナの左上が原点。canvas の基準もコンテナにそろえる
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "5",
  });
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return () => {};
  }

  const total = active.reduce((s, a) => s + a.w, 0);
  const pick = () => {
    let r = rng() * total;
    for (const a of active) {
      r -= a.w;
      if (r <= 0) return a;
    }
    return active[active.length - 1];
  };
  // 走らせる線: 見えている本物の線だけ（不可視の重心・射影・絞り込みで消えたものは除く）
  const realEdges = (n: cytoscape.NodeSingular) =>
    (n.connectedEdges().toArray() as cytoscape.EdgeSingular[]).filter((e) => {
      if (e.hasClass("cluster-edge") || !e.visible()) return false;
      const o = e.source().same(n) ? e.target() : e.source();
      return !o.hasClass("cluster-hub") && o.visible();
    });

  let now = performance.now();
  let nextFire = now + 400;
  const sparks: Spark[] = [];
  const trails: Trail[] = [];
  const flashes: Flash[] = [];

  // once: ページごとに一度だけ、少しずつずらして火を付ける（残りはここから取り出す）
  const onceQueue =
    mode !== "loop"
      ? active.map((a, i) => ({ n: a.n, at: now + (mode === "pulse" ? 0 : 300) + i * (mode === "pulse" ? 60 : ONCE_STAGGER_MS) }))
      : [];
  // once は連鎖を 1 段で止める（会話の横で動きすぎないように）
  const maxDepth = mode === "once" ? 1 : MAX_DEPTH;

  const fire = (n: cytoscape.NodeSingular, s: number, depth: number, at: number) => {
    flashes.push({ n, t0: at, s });
    // pulse はページが光るだけ（線には走らせない）
    if (mode === "pulse") return;
    const edges = realEdges(n);
    // 枝の数は段ごとに絞る（1 段目は最大 6 本、それ以降は 3 本）
    const max = depth === 0 ? 6 : 3;
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [edges[i], edges[j]] = [edges[j], edges[i]];
    }
    for (const e of edges.slice(0, max)) {
      const to = e.source().same(n) ? e.target() : e.source();
      // 長さは描かれた形で測る（束ねた線は遠回りする分だけ時間をかけて走る）
      const path = renderedPath(cy, e, n);
      const acc = cumulativeLengths(path);
      const len = acc[acc.length - 1] / (cy.zoom() || 1);
      sparks.push({ e, from: n, to, t0: at + rng() * 140, dur: Math.min(1400, 260 + len * 1.1), s, depth });
    }
  };

  const step = () => {
    if (mode !== "loop") {
      while (onceQueue.length > 0 && onceQueue[0].at <= now) fire(onceQueue.shift()!.n, 1, 0, now);
    } else if (now >= nextFire) {
      const a = pick();
      // 重みの弱いページは弱く光る（最低でも見える強さは残す）
      fire(a.n, 0.45 + 0.55 * a.w, 0, now);
      nextFire = now + FIRE_EVERY_MS * (0.6 + rng() * 0.8);
    }
    for (const sp of sparks) {
      if (sp.done || now < sp.t0 + sp.dur) continue;
      sp.done = true;
      trails.push({ e: sp.e, from: sp.from, t0: now, s: sp.s });
      const s2 = sp.s * 0.55;
      flashes.push({ n: sp.to, t0: now, s: s2 });
      if (sp.depth < maxDepth && rng() < 0.6 * sp.s) fire(sp.to, s2, sp.depth + 1, now + 60);
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].done || sparks[i].e.removed()) sparks.splice(i, 1);
    for (let i = trails.length - 1; i >= 0; i--) if (now - trails[i].t0 > trailMs(trails[i].e) || trails[i].e.removed()) trails.splice(i, 1);
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].t0 > FLASH_MS || flashes[i].n.removed()) flashes.splice(i, 1);
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // 太さは画面上の大きさで決める（俯瞰の倍率でも細くなりすぎないように）
    const z = Math.max(1, Math.min(1.6, cy.zoom()));
    ctx.lineCap = "round";

    for (const tr of trails) {
      if (!tr.e.visible()) continue;
      const k = 1 - (now - tr.t0) / trailMs(tr.e);
      const path = renderedPath(cy, tr.e, tr.from);
      const acc = cumulativeLengths(path);
      const bundled = tr.e.hasClass("bundled");
      ctx.strokeStyle = `rgba(${SPARK_RGB}, ${(bundled ? 0.55 : 0.75) * tr.s * k})`;
      ctx.lineWidth = (bundled ? 2.6 : 2) * z;
      ctx.beginPath();
      tracePart(ctx, path, acc, 0, 1);
      ctx.stroke();
    }

    for (const sp of sparks) {
      if (now < sp.t0 || !sp.e.visible()) continue;
      const t = Math.min(1, (now - sp.t0) / sp.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const path = renderedPath(cy, sp.e, sp.from);
      const acc = cumulativeLengths(path);
      const te = Math.max(0, e - 0.4);
      const head = pointAlong(path, acc, e);
      const tail = pointAlong(path, acc, te);
      const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      g.addColorStop(0, `rgba(${SPARK_RGB}, 0)`);
      g.addColorStop(1, `rgba(${SPARK_RGB}, ${0.9 * sp.s})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 3.4 * z * (0.6 + 0.4 * sp.s);
      ctx.beginPath();
      tracePart(ctx, path, acc, te, Math.max(te + 0.001, e));
      ctx.stroke();
      // 先端: 白い芯と緑のにじみ
      const r = (5 + 6 * sp.s) * z;
      const rg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r);
      rg.addColorStop(0, `rgba(255, 255, 255, ${0.95 * sp.s})`);
      rg.addColorStop(0.35, `rgba(${SPARK_RGB}, ${0.8 * sp.s})`);
      rg.addColorStop(1, `rgba(${SPARK_RGB}, 0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const f of flashes) {
      const k = (now - f.t0) / FLASH_MS;
      if (k < 0 || !f.n.visible()) continue;
      const p = f.n.renderedPosition();
      const nr = f.n.renderedWidth() / 2 || 4;
      const glow = Math.max(0, 1 - k * 2.2);
      if (glow > 0) {
        const r = nr + 18 * z * f.s;
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        rg.addColorStop(0, `rgba(255, 255, 255, ${0.9 * glow * f.s})`);
        rg.addColorStop(0.45, `rgba(${SPARK_RGB}, ${0.7 * glow * f.s})`);
        rg.addColorStop(1, `rgba(${SPARK_RGB}, 0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${SPARK_RGB}, ${0.5 * f.s * (1 - k) * (1 - k)})`;
      ctx.lineWidth = 1.6 * z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, nr + 40 * z * f.s * Math.sqrt(k), 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // 撮影・検証用: window.__graphFiringManual = true のあいだは時計を止め、
  // window.__graphFiringStep(ms) で時刻を進めて 1 コマずつ描く
  const w = window as unknown as { __graphFiringManual?: boolean; __graphFiringStep?: (ms: number) => void };
  let raf = 0;
  let stopped = false;
  const loop = () => {
    if (stopped || cy.destroyed()) return;
    if (!w.__graphFiringManual) {
      now = performance.now();
      step();
      draw();
      // once は出し切って消えたら止まる（canvas も外す）
      if (mode !== "loop" && onceQueue.length === 0 && sparks.length === 0 && trails.length === 0 && flashes.length === 0) {
        stop();
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  w.__graphFiringStep = (ms: number) => {
    now += ms;
    step();
    draw();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
    if (w.__graphFiringStep) delete w.__graphFiringStep;
  };
  cy.one("destroy", stop);
  return stop;
}
