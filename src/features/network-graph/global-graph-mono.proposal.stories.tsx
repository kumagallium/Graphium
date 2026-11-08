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

  // 「いま引用された」: 数秒おきに 1 つずつ光らせて沈める（よく使われるものほど選ばれやすい）
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
  const flash = () => {
    if (cy.destroyed() || active.length === 0) return;
    const n = pick();
    n.data("act", Math.min(1, (n.data("act") as number) + 0.35));
    n.addClass("alive-flash");
    n.animate({ style: { "underlay-opacity": 0.55, "underlay-padding": 22 } }, { duration: 260 })
      .delay(500)
      .animate({ style: { "underlay-opacity": 0.28, "underlay-padding": 9 } }, {
        duration: 1400,
        complete: () => {
          n.removeClass("alive-flash");
          n.removeStyle("underlay-opacity underlay-padding");
        },
      });
  };
  const timer = setInterval(flash, 1600);
  cy.one("destroy", () => clearInterval(timer));
}

function aliveStyles(style: StyleBuilder) {
  style.selector("node[act > 0]").style({
    "background-color": "mapData(act, 0, 1, #9db8a1, #2f6b3a)",
    opacity: "mapData(act, 0, 1, 0.55, 1)",
    "underlay-color": ACCENT,
    "underlay-padding": "mapData(act, 0, 1, 2, 9)",
    "underlay-opacity": "mapData(act, 0, 1, 0.05, 0.28)",
    "underlay-shape": "ellipse",
    "z-index": 40,
  });
  style.selector("edge[act > 0]").style({
    "line-color": ACCENT,
    width: 1,
    opacity: "mapData(act, 0, 1, 0.15, 0.6)",
    "z-index": 39,
  });
  style.selector("node.alive-flash").style({
    "background-color": ACCENT,
    opacity: 1,
    label: "data(fullLabel)",
    "z-index": 80,
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
  name: "4. 生きているノード（AI に使われた重み・見本）",
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
