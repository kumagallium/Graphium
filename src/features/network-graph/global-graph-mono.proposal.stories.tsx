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

type Variant = "mono" | "mono-focus";

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
  style.update();
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

export const MonoFocus: Story = {
  name: "3. 2 ＋ 選んだところだけ色",
  render: () => (
    <Frame>
      <MonoGraph variant="mono-focus" />
    </Frame>
  ),
};
