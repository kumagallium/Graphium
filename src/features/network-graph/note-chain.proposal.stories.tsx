// ノート間プロセス（工程ノートの鎖）の可視化提案ストーリー
//
// 背景: ノート内は step ブロックでフローが描けるが、ノート自体の並び
// （製粉 → 仕込み → 焼成 → 試食 のような工程ノートの鎖）は一望できない。
// インデックステーブルは分岐を表せず、計画ノートへの所属を手で付ける UI もない。
// これらをどう見せ、どこで編集するかの案。
//
// 用語（この提案での定義）:
//   計画ノート = 「計画」フォルダに入っているノート。テンプレートの有無は問わない
//   工程ノート = 計画ノートのインデックステーブルの行から参照されているノート。
//                工程タグは付けない。紐づいていれば工程
//   ステップ   = 工程ノートの中の step ブロック（これもグラフ。3 層は同じ形の入れ子）
//   段階       = step のパラメータ表の行（この提案の図には出さない）
//
// 見るべきところ:
//   - ローカルビュー: 起点ノートから「深さ × 時間」で近傍が読めるか
//   - 分岐: 表（行 = 工程ノート）で持たず、受け渡し（Entity）で持てば分岐が自然に出るか
//   - 右パネル: 計画ノートを開いたときに鎖の編集がここで済むか
//   - 全体ビュー: 「どんな工程を何回やってきたか」がステップ名の集約で読めるか
//   - UI 上の位置: 全体グラフと同じ枠に入るか
//
// 本ストーリーは Storybook 上での視覚合意用。データ配線はしていない。
// 確定したら process-index / cross-note-flow / noteLinks を土台に実装へ移す。
// デモデータはマニュアルと同じパン作りの世界観にそろえる。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitBranch, Layers, Table, Folder, Network, FileText, Bot, History, StickyNote, ListOrdered, Workflow } from "lucide-react";
import { StepFlowView } from "./step-flow-view";
import type { FlowGraphData } from "./activity-graph-adapter";
import { LocaleProvider } from "../../i18n";
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

type Lane = "plan" | "note" | "step";
type Node = {
  id: string;
  lane: Lane;
  label: string;
  sub?: string;
  /** 時間軸上の位置（0..1） */
  t: number;
  /** レーン内の段（分岐で縦にずらす） */
  row?: number;
  /** ステップレーン用: 起点ノートの位置から何列目か（step は時刻を持たないので順序で並べる） */
  col?: number;
  /** 横幅（0..1）。計画ノートは全体に伸ばす */
  w?: number;
  origin?: boolean;
};
type Edge = { from: string; to: string; kind: "handoff" | "partOf" };

const LANE_Y: Record<Lane, number> = { plan: 40, note: 130, step: 260 };
const LANE_LABEL: Record<Lane, string> = { plan: "計画", note: "工程ノート", step: "ステップ（順序）" };
const W = 760;
const LEFT = 100;
const NODE_W = 120;
const NODE_H = 44;
const ROW_GAP = 12;
const STEP_W = 96;
const STEP_GAP = 36;

function x(t: number) {
  return LEFT + t * (W - LEFT - NODE_W - 20);
}
/** ノードの左端。step は起点の t から col 分だけ右へ等間隔 */
function nx(n: Node) {
  if (n.lane === "plan") return LEFT;
  if (n.lane === "step") return x(n.t) + (n.col ?? 0) * (STEP_W + STEP_GAP);
  return x(n.t);
}
function nw(n: Node) {
  if (n.w) return n.w * (W - LEFT - 20);
  return n.lane === "step" ? STEP_W : NODE_W;
}
function y(n: Node) {
  return LANE_Y[n.lane] + (n.row ?? 0) * (NODE_H + ROW_GAP);
}

function Swimlane({ nodes, edges, ticks }: { nodes: Node[]; edges: Edge[]; ticks: string[] }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const H = 420;
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
              x1={nx(b) + nw(b) / 2}
              y1={y(a) + NODE_H}
              x2={nx(b) + nw(b) / 2}
              y2={y(b)}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
            />
          );
        }
        const x1 = nx(a) + nw(a);
        const y1 = y(a) + NODE_H / 2;
        const x2 = nx(b);
        const y2 = y(b) + NODE_H / 2;
        const d =
          y1 === y2
            ? `M${x1} ${y1} L${x2 - 2} ${y2}`
            : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2 - 2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke="var(--forest)" strokeWidth={1.5} markerEnd="url(#nc-arrow)" />;
      })}
      {/* ノード */}
      {nodes.map((n) => {
        const w = nw(n);
        const left = nx(n);
        const ny = y(n);
        const fill =
          n.lane === "plan" ? "var(--color-secondary)" : n.origin ? "var(--forest-soft)" : "var(--color-card)";
        const stroke = n.origin ? "var(--forest)" : "var(--color-border)";
        return (
          <g key={n.id}>
            <rect x={left} y={ny} width={w} height={NODE_H} rx={6} fill={fill} stroke={stroke} strokeWidth={n.origin ? 1.5 : 1} />
            <text x={left + 10} y={ny + 18} fill="var(--color-foreground)" fontWeight={n.origin ? 600 : 500}>
              {n.label}
            </text>
            {n.sub && (
              <text x={left + 10} y={ny + 34} fill="var(--color-muted-foreground)" fontSize={11}>
                {n.sub}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const TICKS = ["4/03", "4/05", "4/08", "4/12"];

const LINEAR_NODES: Node[] = [
  { id: "plan", lane: "plan", label: "春のカンパーニュ試作", sub: "「計画」フォルダのノート", t: 0, w: 1 },
  { id: "mill", lane: "note", label: "製粉", sub: "→ 全粒粉 #12", t: 0 },
  { id: "dough", lane: "note", label: "仕込み", sub: "→ 生地", t: 0.33, origin: true },
  { id: "bake", lane: "note", label: "焼成", sub: "→ 焼き上がり", t: 0.66 },
  { id: "taste", lane: "note", label: "試食", sub: "→ 試食記録", t: 1 },
  { id: "s1", lane: "step", label: "こねる", t: 0.33, col: 0 },
  { id: "s2", lane: "step", label: "一次発酵", t: 0.33, col: 1 },
  { id: "s3", lane: "step", label: "分割", t: 0.33, col: 2 },
];
const LINEAR_EDGES: Edge[] = [
  { from: "mill", to: "dough", kind: "handoff" },
  { from: "dough", to: "bake", kind: "handoff" },
  { from: "bake", to: "taste", kind: "handoff" },
  { from: "s1", to: "s2", kind: "handoff" },
  { from: "s2", to: "s3", kind: "handoff" },
  { from: "plan", to: "mill", kind: "partOf" },
  { from: "plan", to: "dough", kind: "partOf" },
  { from: "plan", to: "bake", kind: "partOf" },
  { from: "plan", to: "taste", kind: "partOf" },
  { from: "dough", to: "s1", kind: "partOf" },
];

const BRANCH_NODES: Node[] = [
  { id: "plan", lane: "plan", label: "春のカンパーニュ試作", sub: "「計画」フォルダのノート", t: 0, w: 1 },
  { id: "mill", lane: "note", label: "製粉", sub: "→ 全粒粉 #12", t: 0, origin: true },
  { id: "doughA", lane: "note", label: "仕込み A", sub: "加水 65%", t: 0.33 },
  { id: "doughB", lane: "note", label: "仕込み B", sub: "加水 72%", t: 0.36, row: 1 },
  { id: "bake", lane: "note", label: "焼成", sub: "A / B を同じ窯で", t: 0.66 },
  { id: "taste", lane: "note", label: "試食", sub: "A vs B", t: 1 },
  { id: "s1", lane: "step", label: "秤量", t: 0, col: 0 },
  { id: "s2", lane: "step", label: "挽く", t: 0, col: 1 },
  { id: "s3", lane: "step", label: "ふるう", t: 0, col: 2 },
  { id: "s4", lane: "step", label: "粗挽き分け", t: 0, col: 2, row: 1 },
];
const BRANCH_EDGES: Edge[] = [
  { from: "mill", to: "doughA", kind: "handoff" },
  { from: "mill", to: "doughB", kind: "handoff" },
  { from: "doughA", to: "bake", kind: "handoff" },
  { from: "doughB", to: "bake", kind: "handoff" },
  { from: "bake", to: "taste", kind: "handoff" },
  { from: "s1", to: "s2", kind: "handoff" },
  { from: "s2", to: "s3", kind: "handoff" },
  { from: "s2", to: "s4", kind: "handoff" },
  { from: "plan", to: "mill", kind: "partOf" },
  { from: "plan", to: "doughA", kind: "partOf" },
  { from: "plan", to: "bake", kind: "partOf" },
  { from: "plan", to: "taste", kind: "partOf" },
  { from: "mill", to: "s1", kind: "partOf" },
];

// ── 右パネル（計画ノートで開いた「ステップ」タブ）──────
//
// 新しいタブは足さない。既存の右パネル（note-app.tsx の rightTab）の
// 「ステップ」タブをそのまま使い、ノートが「計画」フォルダにあるときは
// 中身が step ではなく工程ノートの流れになる。描画は実物の StepFlowView。

/** 工程ノートを step、受け渡される物を entity として StepFlowView に流す */
const PLAN_FLOW: FlowGraphData = {
  steps: [
    // 表の 2 列目以降がそのまま属性になる。空セルは出さない
    { id: "n-mill", name: "製粉", params: [{ label: "日付: 4/03" }] },
    { id: "n-doughA", name: "仕込み A", params: [{ label: "加水: 65%" }, { label: "日付: 4/05" }] },
    { id: "n-doughB", name: "仕込み B", params: [{ label: "加水: 72%" }, { label: "日付: 4/05" }] },
    { id: "n-bake", name: "焼成", params: [{ label: "日付: 4/08" }] },
    { id: "n-taste", name: "試食", params: [{ label: "日付: 4/12" }] },
  ],
  entities: [
    { id: "e-wheat", label: "小麦（春よ恋）", kind: "material", attrs: [] },
    { id: "e-flour", label: "全粒粉 #12", kind: "output", attrs: [] },
    { id: "e-doughA", label: "生地 A", kind: "output", attrs: [] },
    { id: "e-doughB", label: "生地 B", kind: "output", attrs: [] },
    { id: "e-bread", label: "焼き上がり", kind: "output", attrs: [] },
    { id: "e-note", label: "試食記録", kind: "output", attrs: [] },
  ],
  edges: [
    { id: "u0", kind: "used", source: "e-wheat", target: "n-mill" },
    { id: "g1", kind: "generates", source: "n-mill", target: "e-flour" },
    { id: "u1", kind: "used", source: "e-flour", target: "n-doughA" },
    { id: "u2", kind: "used", source: "e-flour", target: "n-doughB" },
    { id: "g2", kind: "generates", source: "n-doughA", target: "e-doughA" },
    { id: "g3", kind: "generates", source: "n-doughB", target: "e-doughB" },
    { id: "u3", kind: "used", source: "e-doughA", target: "n-bake" },
    { id: "u4", kind: "used", source: "e-doughB", target: "n-bake" },
    { id: "g4", kind: "generates", source: "n-bake", target: "e-bread" },
    { id: "u5", kind: "used", source: "e-bread", target: "n-taste" },
    { id: "g5", kind: "generates", source: "n-taste", target: "e-note" },
  ],
};

function RightPanelMock() {
  const rows = [
    { name: "製粉", water: "", date: "4/03" },
    { name: "仕込み A", water: "65%", date: "4/05" },
    { name: "仕込み B", water: "72%", date: "4/05" },
    { name: "焼成", water: "", date: "4/08" },
    { name: "試食", water: "", date: "4/12" },
  ];
  const rail = [
    { icon: <Bot size={18} />, label: "チャット" },
    { icon: <Network size={18} />, label: "グラフ" },
    { icon: <GitBranch size={18} />, label: "ステップ", on: true },
    { icon: <History size={18} />, label: "履歴" },
    { icon: <StickyNote size={18} />, label: "メモ" },
  ];
  return (
    <div className="flex h-[640px] rounded-lg border border-border overflow-hidden">
      {/* 本文（計画ノート） */}
      <div className="flex-1 bg-background p-6 overflow-auto">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-2xl font-semibold">春のカンパーニュ試作</p>
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
            <Folder size={10} /> 計画
          </span>
        </div>
        <p className="text-sm mb-4 mt-3">目的: 加水率の違いがクラムの気泡に与える影響を見る。</p>
        <p className="text-xs text-muted-foreground mb-1">インデックステーブル（今のまま。行 = 工程ノート）</p>
        <div className="rounded-md border border-border overflow-hidden text-xs max-w-[520px]">
          <div className="grid grid-cols-[1fr_1fr_60px] bg-secondary text-muted-foreground">
            {["工程", "加水", "日付"].map((h) => (
              <div key={h} className="px-2 py-1 border-r border-border last:border-r-0">{h}</div>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[1fr_1fr_60px] border-t border-border">
              <div className="px-2 py-1.5 border-r border-border text-primary underline decoration-dotted">{r.name}</div>
              <div className="px-2 py-1.5 border-r border-border">{r.water}</div>
              <div className="px-2 py-1.5 text-muted-foreground">{r.date}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 max-w-[520px]">
          表には受け渡しの列を足さない。つながりは各工程ノートの step が持ち、右のフローに投影される。
          1 列目 = ノード名、2 列目以降 = ノードの属性（加水・日付）。空セルは属性にしない（ノート内の表 ⇄ フローと同じ往復）。
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-[520px]">
          右のボタン文言は実装時に「+ 工程を追加」に出し分ける（モックは部品そのままなので「+ 手順を追加」）。作業手順側は「+ 作業手順を追加」。
        </p>
      </div>
      {/* 右パネル本体（note-app.tsx と同じ枠: w-[480px] bg-muted border-l） */}
      <div className="w-[480px] shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <span className="text-xs font-bold tracking-wide text-foreground">ステップ</span>
        </div>
        {/* サブタブ（graph-links-panel の 近傍 / 来歴 と同じ作り） */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
          {[
            { icon: <ListOrdered size={14} />, label: "作業手順", count: 0 },
            { icon: <Workflow size={14} />, label: "工程", count: 5, on: true },
          ].map((tab) => (
            <div
              key={tab.label}
              className={
                "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md " +
                (tab.on ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground")
              }
            >
              {tab.icon}
              {tab.label}
              <span className="text-[10px] text-muted-foreground">{tab.count}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          <StepFlowView graph={PLAN_FLOW} onAddActivity={() => {}} onJumpToBlock={() => {}} />
        </div>
      </div>
      {/* アイコンレール（w-10 border-l bg-muted/50） */}
      <div className="w-10 shrink-0 border-l border-border bg-muted/50 flex flex-col items-center gap-1 py-2">
        {rail.map((r) => (
          <div
            key={r.label}
            title={r.label}
            className={
              "w-8 h-8 flex items-center justify-center rounded-md " +
              (r.on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")
            }
          >
            {r.icon}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 工程の全体ビュー（ステップ名で集約）─────────────

function ProcessOverviewMock() {
  // ステップ名で集約した有向グラフ。線の太さ = 何回その受け渡しが起きたか
  const nodes = [
    { id: "mill", label: "製粉", n: 38, x: 40, y: 100 },
    { id: "knead", label: "こねる", n: 31, x: 240, y: 100 },
    { id: "bake", label: "焼成", n: 29, x: 440, y: 100 },
    { id: "taste", label: "試食", n: 44, x: 640, y: 100 },
    { id: "ferment", label: "一次発酵", n: 17, x: 110, y: 220 },
    { id: "cut", label: "断面観察", n: 9, x: 520, y: 220 },
  ];
  const edges = [
    { a: "mill", b: "knead", n: 31 },
    { a: "knead", b: "bake", n: 29 },
    { a: "bake", b: "taste", n: 27 },
    { a: "mill", b: "ferment", n: 17 },
    { a: "ferment", b: "knead", n: 6 },
    { a: "bake", b: "cut", n: 9 },
    { a: "cut", b: "taste", n: 4 },
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
        <span className="ml-auto text-xs text-muted-foreground">ステップ名で集約 ・ 線の太さ = 受け渡しの回数</span>
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
        ノードをクリック → そのステップ名を持つノート一覧（プロセス一覧の絞り込み）。線をクリック → その受け渡しを含む計画ノート一覧。
      </p>
    </div>
  );
}

// ── UI 上の位置（アプリの枠に入れたところ）──────────

function AppShellMock() {
  const item = (icon: ReactNode, label: string, on?: boolean, indent?: boolean) => (
    <div
      className={
        "flex items-center gap-2 px-2 py-1 rounded text-xs " +
        (indent ? "ml-4 " : "") +
        (on ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/80")
      }
    >
      {icon}
      {label}
    </div>
  );
  const group = (label: string) => (
    <p className="px-2 pt-3 pb-1 text-[10px] text-muted-foreground tracking-wide">{label}</p>
  );
  return (
    <div className="flex h-[560px] rounded-lg border border-border overflow-hidden">
      <aside className="w-52 shrink-0 border-r border-sidebar-border bg-sidebar-background p-2">
        <div className="rounded-md border border-sidebar-border px-2 py-1 text-xs mb-1">+ ノート</div>
        {group("記録と知識")}
        {item(<FileText size={12} />, "すべてのノート")}
        {item(<Folder size={12} />, "計画", false, true)}
        {item(<Folder size={12} />, "試作", false, true)}
        {item(<Layers size={12} />, "ナレッジ")}
        {group("保管庫")}
        {item(<Table size={12} />, "素材")}
        {item(<GitBranch size={12} />, "プロセス")}
        {item(<Network size={12} />, "全体グラフ", true)}
      </aside>
      <main className="flex-1 p-5 bg-background overflow-auto">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <span>全体グラフ</span>
          <span>›</span>
          <span className="text-foreground">周辺を時系列で見る（起点: 仕込み）</span>
        </div>
        <ViewHeader origin="仕込み" />
        <Swimlane nodes={LINEAR_NODES} edges={LINEAR_EDGES} ticks={TICKS} />
      </main>
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
          "工程ノート（製粉・仕込み・焼成・試食…）の鎖を可視化・編集する提案。ローカルビュー / 分岐 / 右パネル / 全体ビュー / UI 上の位置 の 5 案。",
      },
    },
  },
};
meta.decorators = [
  (Story) => (
    <LocaleProvider>
      <Story />
    </LocaleProvider>
  ),
];
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
            "縦 = 深さ（計画 → 工程ノート → ステップ）。横 = 時間。ツリーと時系列を 1 画面に載せる。",
            "工程ノート間の矢印 = 出力 → 次の工程の入力（cross-note 参照）。点線 = 計画の表に載っている。",
            "ステップレーンは起点ノートの中の step ブロック。step もグラフなので、分岐があれば工程ノートと同じく縦にずらす。段階（表の行）はさらに 1 段下なので出さない。",
            "3 層（計画 → 工程ノート → ステップ）は同じ形の入れ子。どの層も「活動のノードと、受け渡される物の線」で描く。",
            "入口: 全体グラフの SidePeek に「この周辺を時系列で見る」。ノート右パネルの来歴タブからも。",
            "データ変更なし。noteLinks・process-index・cross-note-flow の 1 ホップ表示を両方向に辿るだけ。",
          ]}
        />
      }
    >
      <ViewHeader origin="仕込み" />
      <Swimlane nodes={LINEAR_NODES} edges={LINEAR_EDGES} ticks={TICKS} />
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
            "同じ出力（全粒粉 #12）を 2 つの工程ノートが入力にすれば、それが分岐。表に分岐用の列は要らない。",
            "合流も同じ: 焼成が A と B の両方を入力にする。",
            "インデックステーブルは「行 = 工程ノート」の一覧に徹し、つながりは step の input/output に任せる。表が真ではなく、投影。",
            "分岐した工程ノートは同じレーンの中で縦にずらす。ステップレーンは起点（製粉）の中身で、こちらも「挽く」から分岐している。",
            "横 = 時間なので左から右。右パネルのフロー（上から下）と向きが違うのは、時間軸を持つのがこの画面だけだから。",
          ]}
        />
      }
    >
      <ViewHeader origin="製粉" />
      <Swimlane nodes={BRANCH_NODES} edges={BRANCH_EDGES} ticks={TICKS} />
    </Frame>
  ),
};

export const RightPanel: Story = {
  name: "3. 計画ノートで開いた「ステップ」タブ",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="新しいパネルは作らない。既存の「ステップ」タブの中身が変わる"
          points={[
            "計画ノート = 「計画」フォルダに入っているノート。工程ノート = その表の行から参照されているノート。どちらもタグは増やさない。",
            "計画ノートで右パネルの「ステップ」を開くと、step ではなく工程ノートがノードになる。描画は今のフロービュー（StepFlowView）そのもの。上から下。",
            "工程ノートが step、受け渡される物（全粒粉・生地）が entity。ノート内のフローと同じ 3 層構造なので、同じ部品で描ける。",
            "分岐は「同じ entity を 2 つの工程ノートが使う」。表に分岐の列は要らない。",
            "インデックステーブルは今のまま。行 = 工程ノート、フローのノード = 行、フローで追加 = 行を append。ノート内の「表 ⇄ フロー」と同じ往復。工程テーブルは作らない。",
            "つながりの実体は工程ノート側の step の input（cross-note 参照）。フローで線を引く = その step に書き戻す。計画ノートには持たない。",
            "工程ノードの出力 = そのノートから外へ出る output。ノート内で次の step に消費されない output（末端）は全部出す。2 つあれば 2 つ。途中の output でも他ノートから参照されていれば出す（参照が線になる）。",
            "「+ 工程を追加」= 表に行を足して工程ノートを作る（既存の「行からノートを作成」）。パラメータ = 表の列。新しい表は作らない。",
            "用語: 「作業手順」（このノートの step ブロック）と「工程」（表の行 = 工程ノート）で分ける。ボタンも「+ 作業手順を追加」「+ 工程を追加」に揃える。",
            "切替はグラフパネルの「近傍 / 来歴」と同じサブタブ。計画ノート以外ではサブタブを出さず今のまま。",
            "計画ノートに step ブロックもある場合: サブタブで選ぶ。既定は工程が 1 つでもあれば工程。混ぜて描かない。件数を両方に出すので隠れた側が分かる。",
          ]}
        />
      }
    >
      <RightPanelMock />
    </Frame>
  ),
};

export const ProcessOverview: Story = {
  name: "4. 工程の全体ビュー（ステップ名で集約）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="工程より上の層: ステップ名で集約した全体像"
          points={[
            "個々のノートではなくステップ名で束ね、受け渡しの回数を線の太さにする。「自分（組織）がどんな工程をやってきたか」に答える。",
            "集約キーはノート名ではなくステップ名。ノート名は「仕込み A」「4/05 仕込み」と揺れるが、step 名は継承（同名集計）で既にそろう。",
            "データは ProcessIndex の同名集計（step 継承と同じ源）。PROV エッジは張らない。統計は統計のまま。",
            "範囲を共有フォルダにすると、Library 経由の他メンバーの記録も混ざる。",
            "既存のプロセス一覧（ProcessGalleryView）の上に置く 1 段抽象の画面。ノードから一覧へドリルダウン。",
          ]}
        />
      }
    >
      <ProcessOverviewMock />
    </Frame>
  ),
};

export const Placement: Story = {
  name: "5. UI 上の位置",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="全体グラフと同じ枠に入る"
          points={[
            "全体グラフ・プロセス一覧と同じ、<main> 内の排他ビュー。左ナビは残る。全画面のポータルにはしない。",
            "左ナビに項目は増やさない。全体グラフの中の 1 モード（周辺を時系列で見る）として入り、パンくずで戻る。",
            "入口は 2 つ。全体グラフでノードを選んだ SidePeek のボタンと、ノートの右パネル（来歴タブ）のボタン。",
            "全体ビュー（4）はプロセス一覧の上部に置く。こちらも左ナビの項目は増やさない。",
          ]}
        />
      }
    >
      <AppShellMock />
    </Frame>
  ),
};
