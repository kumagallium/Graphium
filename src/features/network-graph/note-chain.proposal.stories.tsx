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
//   ステップ   = 工程ノートの中の step ブロック
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
import { ArrowRight, GitBranch, Layers, Table, Folder, Network, FileText } from "lucide-react";
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
  /** 横幅（0..1）。計画ノートは全体に伸ばす */
  w?: number;
  origin?: boolean;
};
type Edge = { from: string; to: string; kind: "handoff" | "partOf" };

const LANE_Y: Record<Lane, number> = { plan: 40, note: 130, step: 270 };
const LANE_LABEL: Record<Lane, string> = { plan: "計画", note: "工程ノート", step: "ステップ" };
const W = 760;
const LEFT = 100;
const NODE_W = 120;
const NODE_H = 44;
const ROW_GAP = 12;

function x(t: number) {
  return LEFT + t * (W - LEFT - NODE_W - 20);
}
function y(n: Node) {
  return LANE_Y[n.lane] + (n.row ?? 0) * (NODE_H + ROW_GAP);
}

function Swimlane({ nodes, edges, ticks }: { nodes: Node[]; edges: Edge[]; ticks: string[] }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const H = 370;
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
              y1={y(a) + NODE_H}
              x2={x(b.t) + NODE_W / 2}
              y2={y(b)}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
            />
          );
        }
        const x1 = x(a.t) + NODE_W;
        const y1 = y(a) + NODE_H / 2;
        const x2 = x(b.t);
        const y2 = y(b) + NODE_H / 2;
        const d =
          y1 === y2
            ? `M${x1} ${y1} L${x2 - 2} ${y2}`
            : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2 - 2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke="var(--forest)" strokeWidth={1.5} markerEnd="url(#nc-arrow)" />;
      })}
      {/* ノード */}
      {nodes.map((n) => {
        const w = n.w ? n.w * (W - LEFT - 20) : NODE_W;
        const nx = n.lane === "plan" ? LEFT : x(n.t);
        const ny = y(n);
        const fill =
          n.lane === "plan" ? "var(--color-secondary)" : n.origin ? "var(--forest-soft)" : "var(--color-card)";
        const stroke = n.origin ? "var(--forest)" : "var(--color-border)";
        return (
          <g key={n.id}>
            <rect x={nx} y={ny} width={w} height={NODE_H} rx={6} fill={fill} stroke={stroke} strokeWidth={n.origin ? 1.5 : 1} />
            <text x={nx + 10} y={ny + 18} fill="var(--color-foreground)" fontWeight={n.origin ? 600 : 500}>
              {n.label}
            </text>
            {n.sub && (
              <text x={nx + 10} y={ny + 34} fill="var(--color-muted-foreground)" fontSize={11}>
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
  { id: "s1", lane: "step", label: "こねる", t: 0.33 },
  { id: "s2", lane: "step", label: "一次発酵", t: 0.45 },
  { id: "s3", lane: "step", label: "分割", t: 0.57 },
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
  { id: "s1", lane: "step", label: "秤量", t: 0 },
  { id: "s2", lane: "step", label: "挽く", t: 0.12 },
  { id: "s3", lane: "step", label: "ふるう", t: 0.24 },
];
const BRANCH_EDGES: Edge[] = [
  { from: "mill", to: "doughA", kind: "handoff" },
  { from: "mill", to: "doughB", kind: "handoff" },
  { from: "doughA", to: "bake", kind: "handoff" },
  { from: "doughB", to: "bake", kind: "handoff" },
  { from: "bake", to: "taste", kind: "handoff" },
  { from: "s1", to: "s2", kind: "handoff" },
  { from: "s2", to: "s3", kind: "handoff" },
  { from: "plan", to: "mill", kind: "partOf" },
  { from: "plan", to: "doughA", kind: "partOf" },
  { from: "plan", to: "bake", kind: "partOf" },
  { from: "plan", to: "taste", kind: "partOf" },
  { from: "mill", to: "s1", kind: "partOf" },
];

// ── 右パネル（計画ノートの工程タブ）────────────────

function RightPanelMock() {
  const rows = [
    { name: "製粉", from: "—", out: "全粒粉 #12", date: "4/03" },
    { name: "仕込み A", from: "製粉 › 全粒粉 #12", out: "生地 A", date: "4/05" },
    { name: "仕込み B", from: "製粉 › 全粒粉 #12", out: "生地 B", date: "4/05" },
    { name: "焼成", from: "仕込み A › 生地 A ＋ 仕込み B › 生地 B", out: "焼き上がり", date: "4/08" },
    { name: "試食", from: "焼成 › 焼き上がり", out: "試食記録", date: "4/12" },
  ];
  return (
    <div className="flex gap-4">
      {/* 本文（計画ノート） */}
      <div className="flex-1 rounded-lg border border-border bg-card p-5 min-h-[420px]">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-lg font-semibold">春のカンパーニュ試作</p>
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
            <Folder size={10} /> 計画
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">工程 5 ・ 分岐 1</p>
        <p className="text-sm mb-3">目的: 加水率の違いがクラムの気泡に与える影響を見る。</p>
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
          「工程」列 = 行から作った工程ノート（既存機能）。「入力元」「出力」列は工程ノートの step から導出した読み取り専用。
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
                (tab.on ? "border-b-2 text-foreground" : "text-muted-foreground")
              }
              style={tab.on ? { borderBottomColor: "var(--forest)" } : undefined}
            >
              {tab.icon}
              {tab.l}
            </div>
          ))}
        </div>
        <div className="p-3">
          <p className="text-[11px] text-muted-foreground mb-2">この計画の工程ノートの流れ</p>
          <MiniChain />
          <p className="text-[11px] text-muted-foreground mt-3 mb-1">選択中: 仕込み B</p>
          <div className="rounded-md border border-border bg-card p-2 text-xs space-y-1.5">
            <Row k="入力元" v="製粉 › 全粒粉 #12" action="変更" />
            <Row k="出力" v="生地 B" />
            <Row k="次の工程" v="焼成" action="追加" />
            <Row k="計画" v="春のカンパーニュ試作" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            入力元を変えると、工程ノート側の step の input に書き戻る（1 か所で持つ）。
            「計画」は表の行から導出するので編集項目にしない。
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
      className={"rounded border px-2 py-1 text-[11px] bg-card " + (hi ? "font-semibold" : "")}
      style={hi ? { borderColor: "var(--forest)", background: "var(--forest-soft)" } : undefined}
    >
      {label}
    </div>
  );
  const arrow = <ArrowRight size={12} className="text-muted-foreground shrink-0" />;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {box("製粉")}
      {arrow}
      <div className="flex flex-col gap-1">
        {box("仕込み A")}
        {box("仕込み B", true)}
      </div>
      {arrow}
      {box("焼成")}
      {arrow}
      {box("試食")}
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
            "ステップレーンは起点ノートの中の step ブロック。段階（表の行）はさらに 1 段下なので、ここには出さない。",
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
            "分岐した工程ノートは同じレーンの中で縦にずらす。ステップレーンは起点（製粉）の中身。",
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
  name: "3. 計画ノートの右パネル（工程タブ）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="鎖の編集は計画ノートの右パネルに集める"
          points={[
            "計画ノート = 「計画」フォルダに入っているノート。テンプレートの有無は問わない。",
            "工程ノート = 計画ノートの表の行から参照されているノート。工程タグは付けない。紐づいていれば工程。",
            "右パネルの「工程」タブに、工程ノートの流れと、選択中の工程の入力元・出力・次の工程。",
            "「入力元を変更」はピッカーで他ノートの出力を選ぶ。既存の cross-note 参照ピッカーを流用。",
            "書き戻し先は工程ノートの step。計画ノート側には持たない（二重管理を避ける）。",
            "本文側の表は行から工程ノートを作る既存機能のまま。「入力元」「出力」列は step から導出した読み取り専用。",
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
