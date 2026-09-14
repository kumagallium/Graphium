// ノート間プロセス（工程ノートの鎖）の可視化提案ストーリー
//
// 背景: ノート内は step ブロックでフローが描けるが、「合成」「配合」といった
// ノート自体の並びは一望できない。インデックステーブルは分岐を表せず、
// 計画ノートの所属は手で付けられない。これらをどう見せ、どこで編集するかの案。
//
// 見るべきところ:
//   - ローカルビュー: 起点ノートから「深さ × 時間」で近傍が読めるか
//   - 分岐: 表（行 = 子ノート）で持たず、受け渡し（Entity）で持てば分岐が自然に出るか
//   - 右パネル: 計画ノートを開いたときに鎖の編集がここで済むか
//   - 全体ビュー: 組織として「どんな工程を何回やってきたか」が工程名の集約で読めるか
//
// 本ストーリーは Storybook 上での視覚合意用。データ配線はしていない。
// 確定したら process-index / cross-note-flow を土台に実装へ移す。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, GitBranch, Layers, Table } from "lucide-react";
import "../../app.css";

// ── 共通部品 ─────────────────────────────────────────

/** 案の説明を右側に出す共通の枠（FileSidebar.ia.stories と同じ流儀） */
function CaseNote({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="w-[300px] shrink-0 p-6 text-xs text-muted-foreground space-y-2 border-l border-border">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {points.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function Frame({ children, note }: { children: ReactNode; note: ReactNode }) {
  return (
    <div
      className="min-h-screen flex bg-background text-foreground"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div className="flex-1 p-6 overflow-auto">{children}</div>
      {note}
    </div>
  );
}

/** 画面上部のツールバー（起点・深さ・軸の切替） */
function ViewHeader({ origin }: { origin: string }) {
  return (
    <div className="flex items-center gap-3 mb-5 text-sm">
      <span className="text-muted-foreground">起点</span>
      <span className="px-2 py-0.5 rounded-md border border-border bg-card">{origin}</span>
      <span className="ml-3 text-muted-foreground">深さ</span>
      <Segment items={["1", "2", "3"]} active={1} />
      <span className="ml-3 text-muted-foreground">並べ方</span>
      <Segment items={["時系列", "受け渡し"]} active={0} />
      <span className="ml-auto text-xs text-muted-foreground">全体グラフへ戻る</span>
    </div>
  );
}

function Segment({ items, active }: { items: string[]; active: number }) {
  return (
    <span className="inline-flex rounded-md border border-border overflow-hidden text-xs">
      {items.map((it, i) => (
        <span
          key={it}
          className={
            "px-2 py-0.5 " +
            (i === active ? "bg-secondary text-foreground" : "text-muted-foreground")
          }
        >
          {it}
        </span>
      ))}
    </span>
  );
}

// ── スイムレーン（ローカルビュー）────────────────────

type Lane = "plan" | "step" | "stage";
type Node = {
  id: string;
  lane: Lane;
  label: string;
  sub?: string;
  /** 時間軸上の位置（0..1） */
  t: number;
  /** 横幅（0..1）。計画ノートは全体に伸ばす */
  w?: number;
  origin?: boolean;
};
type Edge = { from: string; to: string; kind: "handoff" | "partOf" };

const LANE_Y: Record<Lane, number> = { plan: 40, step: 130, stage: 220 };
const LANE_LABEL: Record<Lane, string> = { plan: "計画", step: "工程", stage: "段階" };
const W = 760;
const LEFT = 90;
const NODE_W = 120;
const NODE_H = 44;

function x(t: number) {
  return LEFT + t * (W - LEFT - NODE_W - 20);
}

function Swimlane({ nodes, edges, ticks }: { nodes: Node[]; edges: Edge[]; ticks: string[] }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const H = 320;
  return (
    <svg width={W} height={H} className="block max-w-full" style={{ fontSize: 12 }}>
      <defs>
        <marker id="nc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>
      {(Object.keys(LANE_Y) as Lane[]).map((lane) => (
        <g key={lane}>
          <line x1={0} x2={W} y1={LANE_Y[lane] - 14} y2={LANE_Y[lane] - 14} stroke="var(--color-border)" />
          <text x={12} y={LANE_Y[lane] + NODE_H / 2 + 4} fill="var(--color-muted-foreground)">
            {LANE_LABEL[lane]}
          </text>
        </g>
      ))}
      {/* 時間軸 */}
      <line x1={LEFT} x2={W - 20} y1={H - 30} y2={H - 30} stroke="var(--color-muted-foreground)" markerEnd="url(#nc-arrow)" />
      {ticks.map((tk, i) => (
        <text key={tk} x={x(i / (ticks.length - 1))} y={H - 12} fill="var(--color-muted-foreground)">
          {tk}
        </text>
      ))}
      {/* エッジ */}
      {edges.map((e, i) => {
        const a = byId[e.from];
        const b = byId[e.to];
        if (!a || !b) return null;
        if (e.kind === "partOf") {
          return (
            <line
              key={i}
              x1={x(b.t) + NODE_W / 2}
              y1={LANE_Y[a.lane] + NODE_H}
              x2={x(b.t) + NODE_W / 2}
              y2={LANE_Y[b.lane]}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
            />
          );
        }
        const sameLane = a.lane === b.lane;
        const x1 = x(a.t) + NODE_W;
        const y1 = LANE_Y[a.lane] + NODE_H / 2;
        const x2 = x(b.t);
        const y2 = LANE_Y[b.lane] + NODE_H / 2;
        const d = sameLane
          ? `M${x1} ${y1} L${x2 - 2} ${y2}`
          : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2 - 2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke="var(--forest)" strokeWidth={1.5} markerEnd="url(#nc-arrow)" />;
      })}
      {/* ノード */}
      {nodes.map((n) => {
        const w = n.w ? n.w * (W - LEFT - 20) : NODE_W;
        const nx = n.lane === "plan" ? LEFT : x(n.t);
        const y = LANE_Y[n.lane];
        const fill =
          n.lane === "plan" ? "var(--color-secondary)" : n.origin ? "var(--forest-soft)" : "var(--color-card)";
        const stroke = n.origin ? "var(--forest)" : "var(--color-border)";
        return (
          <g key={n.id}>
            <rect x={nx} y={y} width={w} height={NODE_H} rx={6} fill={fill} stroke={stroke} strokeWidth={n.origin ? 1.5 : 1} />
            <text x={nx + 10} y={y + 18} fill="var(--color-foreground)" fontWeight={n.origin ? 600 : 500}>
              {n.label}
            </text>
            {n.sub && (
              <text x={nx + 10} y={y + 34} fill="var(--color-muted-foreground)" fontSize={11}>
                {n.sub}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const LINEAR_NODES: Node[] = [
  { id: "plan", lane: "plan", label: "正極 A ロット", sub: "計画ノート", t: 0, w: 1 },
  { id: "syn", lane: "step", label: "合成", sub: "→ 前駆体粉末 #12", t: 0 },
  { id: "mix", lane: "step", label: "配合", sub: "→ スラリー", t: 0.33, origin: true },
  { id: "coat", lane: "step", label: "サンプル作製", sub: "→ 電極シート", t: 0.66 },
  { id: "eval", lane: "step", label: "評価", sub: "→ 充放電データ", t: 1 },
  { id: "st1", lane: "stage", label: "混練", t: 0.33 },
  { id: "st2", lane: "stage", label: "脱泡", t: 0.45 },
  { id: "st3", lane: "stage", label: "粘度調整", t: 0.57 },
];
const LINEAR_EDGES: Edge[] = [
  { from: "syn", to: "mix", kind: "handoff" },
  { from: "mix", to: "coat", kind: "handoff" },
  { from: "coat", to: "eval", kind: "handoff" },
  { from: "plan", to: "syn", kind: "partOf" },
  { from: "plan", to: "mix", kind: "partOf" },
  { from: "plan", to: "coat", kind: "partOf" },
  { from: "plan", to: "eval", kind: "partOf" },
  { from: "mix", to: "st1", kind: "partOf" },
];

const BRANCH_NODES: Node[] = [
  { id: "plan", lane: "plan", label: "正極 A ロット", sub: "計画ノート", t: 0, w: 1 },
  { id: "syn", lane: "step", label: "合成", sub: "→ 前駆体粉末 #12", t: 0, origin: true },
  { id: "mixA", lane: "step", label: "配合 A", sub: "バインダ 3%", t: 0.33 },
  { id: "mixB", lane: "stage", label: "配合 B", sub: "バインダ 5%", t: 0.4 },
  { id: "coat", lane: "step", label: "サンプル作製", sub: "A / B を並行", t: 0.66 },
  { id: "eval", lane: "step", label: "評価", sub: "A vs B", t: 1 },
];
const BRANCH_EDGES: Edge[] = [
  { from: "syn", to: "mixA", kind: "handoff" },
  { from: "syn", to: "mixB", kind: "handoff" },
  { from: "mixA", to: "coat", kind: "handoff" },
  { from: "mixB", to: "coat", kind: "handoff" },
  { from: "coat", to: "eval", kind: "handoff" },
  { from: "plan", to: "syn", kind: "partOf" },
  { from: "plan", to: "mixA", kind: "partOf" },
  { from: "plan", to: "coat", kind: "partOf" },
  { from: "plan", to: "eval", kind: "partOf" },
];

// ── 右パネル（計画ノートの工程タブ）────────────────

function RightPanelMock() {
  const rows = [
    { name: "合成", from: "—", out: "前駆体粉末 #12", date: "8/20" },
    { name: "配合 A", from: "合成 › 前駆体粉末 #12", out: "スラリー A", date: "8/22" },
    { name: "配合 B", from: "合成 › 前駆体粉末 #12", out: "スラリー B", date: "8/22" },
    { name: "サンプル作製", from: "配合 A › スラリー A ＋ 配合 B › スラリー B", out: "電極シート", date: "8/25" },
    { name: "評価", from: "サンプル作製 › 電極シート", out: "充放電データ", date: "9/01" },
  ];
  return (
    <div className="flex gap-4">
      {/* 本文（計画ノート） */}
      <div className="flex-1 rounded-lg border border-border bg-card p-5 min-h-[420px]">
        <p className="text-lg font-semibold mb-1">正極 A ロット</p>
        <p className="text-xs text-muted-foreground mb-4">計画ノート ・ 工程 5 ・ 分岐 1</p>
        <p className="text-sm mb-3">目的: バインダ量の違いが初回充放電効率に与える影響を見る。</p>
        <div className="rounded-md border border-border overflow-hidden text-xs">
          <div className="grid grid-cols-[1fr_2fr_1.2fr_60px] bg-secondary text-muted-foreground">
            {["工程", "入力元", "出力", "日付"].map((h) => (
              <div key={h} className="px-2 py-1 border-r border-border last:border-r-0">{h}</div>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[1fr_2fr_1.2fr_60px] border-t border-border">
              <div className="px-2 py-1.5 border-r border-border text-primary underline decoration-dotted">{r.name}</div>
              <div className="px-2 py-1.5 border-r border-border text-muted-foreground">{r.from}</div>
              <div className="px-2 py-1.5 border-r border-border">{r.out}</div>
              <div className="px-2 py-1.5 text-muted-foreground">{r.date}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          「工程」列 = 子ノート（行から作成）。「入力元」列 = 他の工程ノートの出力を選ぶ（cross-note 参照）。
          分岐は同じ入力元を持つ行が 2 つあるだけで表せる。
        </p>
      </div>
      {/* 右パネル */}
      <div className="w-[300px] shrink-0 rounded-lg border border-border bg-sidebar-background">
        <div className="flex text-xs border-b border-border">
          {[
            { l: "工程", icon: <GitBranch size={12} />, on: true },
            { l: "表", icon: <Table size={12} /> },
            { l: "来歴", icon: <Layers size={12} /> },
          ].map((tab) => (
            <div
              key={tab.l}
              className={
                "flex items-center gap-1 px-3 py-2 " +
                (tab.on ? "border-b-2 border-forest text-foreground" : "text-muted-foreground")
              }
              style={tab.on ? { borderBottomColor: "var(--forest)" } : undefined}
            >
              {tab.icon}
              {tab.l}
            </div>
          ))}
        </div>
        <div className="p-3">
          <p className="text-[11px] text-muted-foreground mb-2">この計画に属する工程の流れ</p>
          <MiniChain />
          <p className="text-[11px] text-muted-foreground mt-3 mb-1">選択中: 配合 B</p>
          <div className="rounded-md border border-border bg-card p-2 text-xs space-y-1.5">
            <Row k="入力元" v="合成 › 前駆体粉末 #12" action="変更" />
            <Row k="出力" v="スラリー B" />
            <Row k="次の工程" v="サンプル作製" action="追加" />
            <Row k="所属" v="正極 A ロット" action="外す" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            ここで変えた入力元は、子ノート側の step の input に書き戻る（1 か所で持つ）。
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, action }: { k: string; v: string; action?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{k}</span>
      <span className="flex-1">{v}</span>
      {action && <span className="text-[11px] text-primary">{action}</span>}
    </div>
  );
}

function MiniChain() {
  const box = (label: string, hi?: boolean) => (
    <div
      className={
        "rounded border px-2 py-1 text-[11px] bg-card " +
        (hi ? "font-semibold" : "")
      }
      style={hi ? { borderColor: "var(--forest)", background: "var(--forest-soft)" } : undefined}
    >
      {label}
    </div>
  );
  const arrow = <ArrowRight size={12} className="text-muted-foreground shrink-0" />;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {box("合成")}
      {arrow}
      <div className="flex flex-col gap-1">
        {box("配合 A")}
        {box("配合 B", true)}
      </div>
      {arrow}
      {box("サンプル作製")}
      {arrow}
      {box("評価")}
    </div>
  );
}

// ── 工程の全体ビュー（組織レベル）────────────────────

function ProcessOverviewMock() {
  // 工程名で集約した有向グラフ。線の太さ = 何回その受け渡しが起きたか
  const nodes = [
    { id: "syn", label: "合成", n: 38, x: 40, y: 100 },
    { id: "mix", label: "配合", n: 31, x: 240, y: 100 },
    { id: "coat", label: "サンプル作製", n: 29, x: 440, y: 100 },
    { id: "eval", label: "評価", n: 44, x: 640, y: 100 },
    { id: "xrd", label: "XRD 測定", n: 17, x: 110, y: 220 },
    { id: "sem", label: "SEM 観察", n: 9, x: 520, y: 220 },
  ];
  const edges = [
    { a: "syn", b: "mix", n: 31 },
    { a: "mix", b: "coat", n: 29 },
    { a: "coat", b: "eval", n: 27 },
    { a: "syn", b: "xrd", n: 17 },
    { a: "xrd", b: "mix", n: 6 },
    { a: "coat", b: "sem", n: 9 },
    { a: "sem", b: "eval", n: 4 },
  ];
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const NW = 120;
  const NH = 48;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3 text-sm">
        <span className="text-muted-foreground">期間</span>
        <Segment items={["3 か月", "1 年", "すべて"]} active={1} />
        <span className="ml-3 text-muted-foreground">範囲</span>
        <Segment items={["自分", "共有フォルダ"]} active={1} />
        <span className="ml-auto text-xs text-muted-foreground">工程名で集約 ・ 線の太さ = 受け渡しの回数</span>
      </div>
      <svg width={780} height={300} className="block max-w-full rounded-lg border border-border bg-card" style={{ fontSize: 12 }}>
        <defs>
          <marker id="ov-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = by[e.a];
          const b = by[e.b];
          // 同じ段は右→左。下の段へは底から天へ、上の段へは右端から左端へ入れる
          let x1: number, y1: number, x2: number, y2: number, d: string;
          if (a.y === b.y) {
            x1 = a.x + NW; y1 = a.y + NH / 2; x2 = b.x; y2 = b.y + NH / 2;
            d = `M${x1} ${y1} L${x2 - 2} ${y2}`;
          } else if (b.y > a.y) {
            x1 = a.x + NW / 2; y1 = a.y + NH; x2 = b.x + NW / 2; y2 = b.y;
            d = `M${x1} ${y1} C${x1} ${y1 + 40} ${x2} ${y2 - 40} ${x2} ${y2 - 2}`;
          } else {
            x1 = a.x + NW; y1 = a.y + NH / 2; x2 = b.x; y2 = b.y + NH / 2;
            d = `M${x1} ${y1} C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2 - 2} ${y2}`;
          }
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--forest)" strokeWidth={1 + e.n / 8} opacity={0.7} markerEnd="url(#ov-arrow)" />
              <text x={(x1 + x2) / 2 - 8} y={(y1 + y2) / 2 - 6} fill="var(--color-muted-foreground)" fontSize={11}>
                {e.n}
              </text>
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={NW} height={NH} rx={8} fill="var(--forest-soft)" stroke="var(--forest)" />
            <text x={n.x + 12} y={n.y + 20} fill="var(--color-foreground)" fontWeight={600}>
              {n.label}
            </text>
            <text x={n.x + 12} y={n.y + 36} fill="var(--color-muted-foreground)" fontSize={11}>
              {n.n} ノート
            </text>
          </g>
        ))}
      </svg>
      <p className="text-xs text-muted-foreground mt-2">
        ノードをクリック → その工程名を持つノート一覧（プロセス一覧の絞り込み）。線をクリック → その受け渡しを含む計画ノート一覧。
      </p>
    </div>
  );
}

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Proposal/ノート間プロセス",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "工程ノート（合成・配合…）の鎖を可視化・編集する提案。ローカルビュー / 分岐 / 右パネル / 全体ビューの 4 案。",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

export const LocalView: Story = {
  name: "1. ローカルビュー（直線）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="起点ノートの近傍を「深さ × 時間」で並べる"
          points={[
            "縦 = 深さ（計画 → 工程 → 段階）。横 = 時間。ツリーと時系列を 1 画面に載せる。",
            "工程間の矢印 = 出力 → 次の工程の入力（cross-note 参照）。点線 = 所属。",
            "段階レーンは起点ノートの中身（パラメータ表の行）。孫はここで受ける。",
            "入口: 全体グラフの SidePeek に「この周辺を時系列で見る」。ノート右パネルの来歴タブからも。",
            "データ変更なし。process-index と cross-note-flow の 1 ホップ表示を両方向に辿るだけ。",
          ]}
        />
      }
    >
      <ViewHeader origin="配合" />
      <Swimlane nodes={LINEAR_NODES} edges={LINEAR_EDGES} ticks={["8/20", "8/22", "8/25", "9/01"]} />
    </Frame>
  ),
};

export const LocalViewBranch: Story = {
  name: "2. ローカルビュー（分岐）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="分岐は表ではなく受け渡しで持つ"
          points={[
            "同じ出力（前駆体粉末 #12）を 2 つの工程ノートが入力にすれば、それが分岐。表に分岐用の列は要らない。",
            "合流も同じ: サンプル作製が A と B の両方を入力にする。",
            "インデックステーブルは「行 = 子ノート」の一覧に徹し、つながりは step の input/output に任せる。表が真ではなく、投影。",
            "段階レーンに配合 B を置いているのは描画の都合。実装では工程レーン内で縦にずらす。",
          ]}
        />
      }
    >
      <ViewHeader origin="合成" />
      <Swimlane nodes={BRANCH_NODES} edges={BRANCH_EDGES} ticks={["8/20", "8/22", "8/25", "9/01"]} />
    </Frame>
  ),
};

export const RightPanel: Story = {
  name: "3. 計画ノートの右パネル（工程タブ）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="鎖の編集は計画ノートの右パネルに集める"
          points={[
            "計画ノートを開くと右パネルに「工程」タブ。所属する工程ノートの流れと、選択中の工程の入力元・出力・次の工程。",
            "「入力元を変更」はピッカーで他ノートの出力を選ぶ。既存の cross-note 参照ピッカーを流用。",
            "書き戻し先は子ノートの step。計画ノート側には持たない（二重管理を避ける）。",
            "所属（partOf）はここで付け外しできる。今は論文抽出でしか付かないので、この UI が空白を埋める。",
            "本文側の表は行から子ノートを作る既存機能のまま。「入力元」列は step から導出した読み取り専用。",
          ]}
        />
      }
    >
      <RightPanelMock />
    </Frame>
  ),
};

export const ProcessOverview: Story = {
  name: "4. 工程の全体ビュー（組織レベル）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="工程より上の層: 名前で集約した全体像"
          points={[
            "個々のノートではなく工程名で束ね、受け渡しの回数を線の太さにする。「自分（組織）がどんな工程をやってきたか」に答える。",
            "データは ProcessIndex の同名集計（step 継承と同じ源）。PROV エッジは張らない。統計は統計のまま。",
            "範囲を共有フォルダにすると、Library 経由の他メンバーの記録も混ざる。",
            "既存のプロセス一覧（ProcessGalleryView）の上に置く 1 段抽象の画面。ノードから一覧へドリルダウン。",
            "孫ノートまでの階層はこの層には出さない。深さはローカルビューの役目。",
          ]}
        />
      }
    >
      <ProcessOverviewMock />
    </Frame>
  ),
};
