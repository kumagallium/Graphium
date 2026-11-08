// 全体グラフの「色を抑えた見せ方」の見比べ（提案・未合意）。
//
// 背景: SNS でよく見る白黒のグラフ画面は、点も線も同じ黒で描き、線だけを
// ごく薄く細くしている。色相をそろえて濃さで分けると、種類ごとに色を付けた
// 今の全体グラフより落ち着いて見えるのではないか、という問いを確かめる。
//
// 本体（global-graph-view.tsx）は変えない。描画後に cytoscape のスタイルを
// 上書きして見た目だけを試す（合意したら本体のスタイル定義に移す）。
//   1. 現状: 種類ごとの色・線は種類の色で不透明度 0.85
//   2. 同じ色・線を薄く: 点は 1 色（濃い灰）、線も同じ色で細く・ごく薄く・矢印なし
//   3. 2 ＋ 選んだところだけ色: 一番つながりの多いノートとその隣だけに色を付ける

import { useEffect, useRef, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type cytoscape from "cytoscape";
import { GlobalGraphView } from "./global-graph-view";
import { SAMPLE_DATA } from "./global-graph-structure.stories";

type Variant = "mono" | "mono-focus" | "alive";

/** 点と線に使う 1 色（濃い灰。真っ黒は強すぎるので少し温かみのある灰） */
const INK = "#3d3b38";
/** 選んだところだけに付ける色（Graphium の「派生」の緑） */
const ACCENT = "#4B7A52";

/** コンテナの DOM から cytoscape の実体を拾う（cytoscape が _cyreg に置く） */
function findCy(root: HTMLElement): cytoscape.Core | null {
  for (const el of root.querySelectorAll<HTMLElement>("div")) {
    const reg = (el as unknown as { _cyreg?: { cy?: cytoscape.Core } })._cyreg;
    if (reg?.cy) return reg.cy;
  }
  return null;
}

function applyVariant(cy: cytoscape.Core, variant: Variant) {
  const style = cy.style() as unknown as {
    selector: (s: string) => { style: (o: Record<string, unknown>) => unknown };
    update: () => void;
  };
  // 形はすべて丸に、色は 1 色に。種類は「濃さ」で分ける:
  // ノート（data.shape が ellipse）は濃く、知見・出典などは薄く
  style.selector("node").style({
    "background-color": INK,
    "border-color": INK,
    "border-width": 0,
    "background-image": "none",
    shape: "ellipse",
    opacity: 0.4,
  });
  style.selector('node[shape = "ellipse"]').style({ opacity: 0.92 });
  style.selector("node[?satellite]").style({ opacity: 0.25 });
  style.selector("edge").style({
    "line-color": INK,
    "target-arrow-color": INK,
    "target-arrow-shape": "none",
    "line-style": "solid",
    width: 0.6,
    opacity: 0.16,
  });
  style.selector("edge.satellite-edge").style({ opacity: 0.08 });
  // 不可視のレイアウト用要素は隠したまま
  style.selector("edge.cluster-edge").style({ opacity: 0 });
  style.selector("node.cluster-hub").style({ opacity: 0 });

  if (variant === "mono-focus") {
    // 一番つながりの多いノートを「選んだ」ものとみなす
    const notes = cy.nodes().filter((n) => !n.hasClass("cluster-hub") && n.visible() && n.data("shape") === "ellipse");
    let hub: cytoscape.NodeSingular | null = null;
    notes.forEach((n) => {
      const d = n.connectedEdges().filter((e) => !e.hasClass("cluster-edge")).length;
      if (!hub || d > hub.connectedEdges().filter((e) => !e.hasClass("cluster-edge")).length) hub = n;
    });
    if (hub) {
      const h = hub as cytoscape.NodeSingular;
      const edges = h.connectedEdges().filter((e) => !e.hasClass("cluster-edge"));
      edges.addClass("mono-focus");
      edges.connectedNodes().addClass("mono-focus");
      h.addClass("mono-focus-center");
      // 選んでいないものは一段沈める（色が付いたところに目が行くように）
      style.selector("node").style({ opacity: 0.18 });
      style.selector("edge").style({ opacity: 0.06 });
      style.selector("node.mono-focus").style({ "background-color": ACCENT, "border-color": ACCENT, opacity: 1, "z-index": 50 });
      style.selector("edge.mono-focus").style({ "line-color": ACCENT, width: 1.6, opacity: 0.9, "z-index": 49 });
      style.selector("node.mono-focus-center").style({
        "background-color": ACCENT,
        "border-color": "#ffffff",
        "border-width": 3,
        opacity: 1,
        label: "data(fullLabel)",
        "z-index": 60,
      });
      // 選んだときの画面: 選んだノートとその隣が収まるところまで寄せる
      cy.fit(h.closedNeighborhood(), 50);
    }
  }
  if (variant === "alive") applyAlive(cy, style);
  style.update();
}

// ── 「生きているノード」の見本 ─────────────────────────
// 本物の回数はまだ無いので、決まった乱数で「最近 AI に使われた重み」を作る。
// つながりの多いノードほど使われやすい、という偏りだけ持たせる。

type StyleBuilder = { selector: (s: string) => { style: (o: Record<string, unknown>) => unknown } };

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applyAlive(cy: cytoscape.Core, style: StyleBuilder) {
  // スタイルは当て直しのたびに後ろへ積み直す（土台の灰色の規則に負けないように）。
  // 重みと点滅のタイマーは最初の 1 回だけ用意する
  aliveStyles(style);
  if (cy.scratch("_aliveDone")) return;
  cy.scratch("_aliveDone", true);
  const rng = seeded(7);
  const nodes = cy.nodes().filter((n) => !n.hasClass("cluster-hub"));
  const active: cytoscape.NodeSingular[] = [];
  nodes.forEach((n) => {
    const deg = n.connectedEdges().filter((e) => !e.hasClass("cluster-edge")).length;
    // つながりが多いほど使われやすい。全体の 1 割弱だけが「最近使われた」
    const p = Math.min(0.5, 0.03 + deg * 0.02);
    if (rng() < p) {
      // 重みは 0〜1。最近ほど 1 に近い（時間で薄れる重みの見本）
      const w = Math.pow(rng(), 1.8);
      n.data("act", Math.max(0.08, w));
      active.push(n);
    }
  });
  // 使われたノード同士を結ぶ線も少しだけ起こす
  cy.edges().forEach((e) => {
    const a = e.source().data("act") ?? 0;
    const b = e.target().data("act") ?? 0;
    if (a > 0 && b > 0) e.data("act", Math.min(a, b));
  });
  // data を足したので、積んだスタイルを効かせ直す
  (cy.style() as unknown as { update: () => void }).update();

  startSynapse(cy, active, rng);
}

// ── 発火（シナプスの見本） ─────────────────────────────
// 「いま引用された」ノードが発火し、つながるエッジを火花が走って隣へ伝わる。
// 届いた先は弱く光り、確率で次の隣へ連鎖する（強さは段ごとに減る）。
// 走ったエッジには残光がしばらく残る。cytoscape の上に重ねた canvas に描く。
//
// 撮影用: window.__synapseManual = true のときは時計を止め、window.__synapseStep(ms)
// で時刻を進めて 1 コマずつ描く（スクショを連番で撮って動画にするため）。

type Spark = { a: cytoscape.NodeSingular; b: cytoscape.NodeSingular; t0: number; dur: number; s: number; depth: number; done?: boolean };
type Trail = { a: cytoscape.NodeSingular; b: cytoscape.NodeSingular; t0: number; s: number };
type Flash = { n: cytoscape.NodeSingular; t0: number; s: number };

const SPARK_RGB = "62, 140, 78"; // 火花の色（ACCENT より少し明るい緑）
const TRAIL_MS = 1800;
const FLASH_MS = 900;
const FIRE_EVERY_MS = 1100;

function startSynapse(cy: cytoscape.Core, active: cytoscape.NodeSingular[], rng: () => number) {
  const container = cy.container();
  if (!container || active.length === 0) return;
  const canvas = document.createElement("canvas");
  // cytoscape の座標（renderedPosition）はコンテナの左上が原点。canvas の基準も
  // コンテナにそろえる（static のままだと外側の要素が基準になってずれる）
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
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const w = window as unknown as { __synapseManual?: boolean; __synapseStep?: (ms: number) => void };

  let now = performance.now();
  let nextFire = now + 300;
  const sparks: Spark[] = [];
  const trails: Trail[] = [];
  const flashes: Flash[] = [];

  const pick = () => {
    let total = 0;
    for (const n of active) total += n.data("act");
    let r = rng() * total;
    for (const n of active) {
      r -= n.data("act");
      if (r <= 0) return n;
    }
    return active[0];
  };
  const realEdges = (n: cytoscape.NodeSingular) =>
    n.connectedEdges().filter((e) => {
      if (e.hasClass("cluster-edge") || !e.visible()) return false;
      // 見えないダミー（島の重心など）へ向かう線は走らせない
      const o = e.source().same(n) ? e.target() : e.source();
      return !o.hasClass("cluster-hub") && o.visible() && Number(o.style("opacity")) > 0;
    });

  const fire = (n: cytoscape.NodeSingular, s: number, depth: number, at: number) => {
    flashes.push({ n, t0: at, s });
    const edges = realEdges(n).toArray() as cytoscape.EdgeSingular[];
    // 枝の数は段ごとに絞る（1 段目は最大 6 本、それ以降は 3 本）
    const max = depth === 0 ? 6 : 3;
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [edges[i], edges[j]] = [edges[j], edges[i]];
    }
    for (const e of edges.slice(0, max)) {
      const other = e.source().same(n) ? e.target() : e.source();
      const p = n.position();
      const q = other.position();
      const len = Math.hypot(p.x - q.x, p.y - q.y);
      sparks.push({ a: n, b: other, t0: at + rng() * 140, dur: Math.min(900, 260 + len * 1.1), s, depth });
    }
  };

  const step = () => {
    if (now >= nextFire) {
      const n = pick();
      fire(n, 1, 0, now);
      nextFire = now + FIRE_EVERY_MS * (0.6 + rng() * 0.8);
    }
    for (const sp of sparks) {
      if (sp.done || now < sp.t0 + sp.dur) continue;
      sp.done = true;
      trails.push({ a: sp.a, b: sp.b, t0: now, s: sp.s });
      const s2 = sp.s * 0.55;
      flashes.push({ n: sp.b, t0: now, s: s2 });
      if (sp.depth < 2 && rng() < 0.6 * sp.s) fire(sp.b, s2, sp.depth + 1, now + 60);
    }
    // 寿命が尽きたものを捨てる
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].done) sparks.splice(i, 1);
    for (let i = trails.length - 1; i >= 0; i--) if (now - trails[i].t0 > TRAIL_MS) trails.splice(i, 1);
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].t0 > FLASH_MS) flashes.splice(i, 1);
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // 太さは画面上の大きさで決める（俯瞰の倍率でも細くなりすぎないように）
    const z = Math.max(1, Math.min(1.6, cy.zoom()));
    ctx.lineCap = "round";

    // 残光: 走ったエッジがゆっくり消える
    for (const tr of trails) {
      const k = 1 - (now - tr.t0) / TRAIL_MS;
      const a = tr.a.renderedPosition();
      const b = tr.b.renderedPosition();
      ctx.strokeStyle = `rgba(${SPARK_RGB}, ${0.75 * tr.s * k})`;
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 火花: 尾を引いて走る
    for (const sp of sparks) {
      if (now < sp.t0) continue;
      const t = Math.min(1, (now - sp.t0) / sp.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const a = sp.a.renderedPosition();
      const b = sp.b.renderedPosition();
      const hx = a.x + (b.x - a.x) * e;
      const hy = a.y + (b.y - a.y) * e;
      const te = Math.max(0, e - 0.4);
      const tx = a.x + (b.x - a.x) * te;
      const ty = a.y + (b.y - a.y) * te;
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, `rgba(${SPARK_RGB}, 0)`);
      g.addColorStop(1, `rgba(${SPARK_RGB}, ${0.9 * sp.s})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 3.4 * z * (0.6 + 0.4 * sp.s);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // 先端: 白い芯と緑のにじみ
      const r = (5 + 6 * sp.s) * z;
      const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
      rg.addColorStop(0, `rgba(255, 255, 255, ${0.95 * sp.s})`);
      rg.addColorStop(0.35, `rgba(${SPARK_RGB}, ${0.8 * sp.s})`);
      rg.addColorStop(1, `rgba(${SPARK_RGB}, 0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 発火: ノードが一瞬強く光り、広がる波紋が 1 つ出る
    for (const f of flashes) {
      const k = (now - f.t0) / FLASH_MS;
      if (k < 0) continue;
      const p = f.n.renderedPosition();
      const nr = (f.n.renderedWidth() / 2) || 4;
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

  let raf = 0;
  const loop = () => {
    if (cy.destroyed()) return;
    if (!w.__synapseManual) {
      now = performance.now();
      step();
      draw();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  w.__synapseStep = (ms: number) => {
    now += ms;
    step();
    draw();
  };
  cy.one("destroy", () => {
    cancelAnimationFrame(raf);
    canvas.remove();
  });
}

function aliveStyles(style: StyleBuilder) {
  // 普段の濃さ: 最近使われたものほど濃い緑。輪や明滅は付けない（動きは発火だけに任せる）
  style.selector("node[act > 0]").style({
    "background-color": "mapData(act, 0, 1, #a9bfad, #2f6b3a)",
    opacity: "mapData(act, 0, 1, 0.6, 1)",
    "z-index": 40,
  });
  style.selector("edge[act > 0]").style({
    "line-color": ACCENT,
    width: 0.8,
    opacity: "mapData(act, 0, 1, 0.12, 0.4)",
    "z-index": 39,
  });
}

function MonoGraph({ variant }: { variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 配置が落ち着くまで何度か当て直す（配置後の再スタイルに負けないように）
    const timers = [400, 1200, 2500, 4500].map((ms) =>
      setTimeout(() => {
        const cy = ref.current ? findCy(ref.current) : null;
        if (cy) applyVariant(cy, variant);
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [variant]);
  return (
    <div ref={ref} style={{ height: "100%" }}>
      <GlobalGraphView data={SAMPLE_DATA} onClose={noop} onSelectNote={noop} />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ height: "100vh" }}>{children}</div>;
}

function noop() {
  // 見比べ用なのでナビゲーションは配線しない
}

const meta: Meta = {
  title: "Graph/GlobalGraphMono (proposal)",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "全体グラフの色を抑えた見せ方の見比べ（未合意）。本体は変えず、描画後に cytoscape のスタイルを上書きしている。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

export const Current: Story = {
  name: "1. 現状（種類ごとの色）",
  render: () => (
    <Frame>
      <GlobalGraphView data={SAMPLE_DATA} onClose={noop} onSelectNote={noop} />
    </Frame>
  ),
};

export const Mono: Story = {
  name: "2. 同じ色・線を薄く",
  render: () => (
    <Frame>
      <MonoGraph variant="mono" />
    </Frame>
  ),
};

export const Alive: Story = {
  name: "4. 発火（AI に使われたところがシナプスのように伝わる・見本）",
  render: () => (
    <Frame>
      <MonoGraph variant="alive" />
    </Frame>
  ),
};

export const MonoFocus: Story = {
  name: "3. 2 ＋ 選んだところだけ色",
  render: () => (
    <Frame>
      <MonoGraph variant="mono-focus" />
    </Frame>
  ),
};
