// 計画の線（予定）と実行の線（実績）の提案ストーリー
//
// 背景: 計画ノートの工程フローは「実際に記録された受け渡し」しか描けず、計画の段階で
// 「この工程の出力をあの工程に渡すつもり」を書く場所が無い。前回「工程フローで線を
// 引けない」と決めたのは、書き込み先が相手のノートになるからだった。
//
// 提案: 予定の線は**計画ノート自身の表**（インデックステーブルの「入力元」列）に持つ。
// 工程フローでポートを引くとこの列に書く。相手のノートには何も書かない。
// 実績の線は今のまま（工程ノートの手順が前の工程の出力を入力に選んだ cross-note 参照）。
//
// 見るべきところ:
//   - 予定（灰色の点線）と実績（実線）が一目で区別できるか
//   - 両方あるとき「計画どおり」、実績だけのとき「計画外」の印が読めるか
//   - 表の「入力元」列と、フローの点線が同じものだと分かるか
//
// 本ストーリーは視覚合意用。データ配線はしていない。
// 表とフローを縦に並べているのは「入力元列 = 点線」を見比べるための描き方で、
// 実装ではフローはノート本文に置かず、今と同じ右パネル「ステップ」タブの「工程」
// サブタブ（と拡大表示）に出す。本文に増えるのは表の「入力元」列だけ。
// 決定したら FlowEdge に planned フラグを足し、plan-flow.ts が入力元列から予定の線を作る。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import "../../app.css";

// ── 共通部品（note-chain.proposal と同じ流儀） ────────

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
    <div className="min-h-screen flex bg-background text-foreground" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flex-1 p-6 overflow-auto">{children}</div>
      {note}
    </div>
  );
}

// ── 工程フローのモック（上から下、StepFlowView と同じ配色） ────

type EdgeKind = "planned" | "executed" | "both";
type Op = { id: string; name: string; x: number; y: number; out?: string };
type E = { from: string; to: string; kind: EdgeKind };

const ACTIVITY_BLUE = "#3f6c92";
const OUTPUT_TERRACOTTA = "#a8513f";
const NW = 150;
const NH = 44;

function Flow({ ops, edges, title }: { ops: Op[]; edges: E[]; title: string }) {
  const by = Object.fromEntries(ops.map((o) => [o.id, o]));
  const H = Math.max(...ops.map((o) => o.y)) + NH + 60;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground mb-2">{title}<span className="ml-2 text-[10px]">（実装では右パネル「工程」サブタブに出る。本文には出ない）</span></p>
      <svg width={720} height={H} className="block max-w-full" style={{ fontSize: 12 }}>
        <defs>
          <marker id="pe-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = by[e.from];
          const b = by[e.to];
          const x1 = a.x + NW / 2;
          const y1 = a.y + NH;
          const x2 = b.x + NW / 2;
          const y2 = b.y;
          // 2 段以上飛ぶ線は、間のノードを突き抜けないよう左へ膨らませる
          const far = y2 - y1 > 200;
          const cx = far ? Math.min(x1, x2) - 200 : null;
          const d = far
            ? `M${x1} ${y1} C${cx} ${y1 + 60} ${cx} ${y2 - 60} ${x2} ${y2 - 2}`
            : `M${x1} ${y1} C${x1} ${y1 + 36} ${x2} ${y2 - 36} ${x2} ${y2 - 2}`;
          const mx = far ? (cx ?? 0) + 60 : (x1 + x2) / 2;
          const my = far ? y1 + (y2 - y1) * 0.62 : (y1 + y2) / 2;
          if (e.kind === "planned") {
            return (
              <g key={i}>
                <path d={d} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.5} strokeDasharray="5 4" markerEnd="url(#pe-arrow)" />
                <Badge x={mx} y={my} text="予定" tone="muted" />
              </g>
            );
          }
          if (e.kind === "both") {
            return (
              <g key={i}>
                <path d={d} fill="none" stroke="var(--forest)" strokeWidth={2} markerEnd="url(#pe-arrow)" />
                <Badge x={mx} y={my} text="計画どおり" tone="forest" />
              </g>
            );
          }
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--amber)" strokeWidth={2} markerEnd="url(#pe-arrow)" />
              <Badge x={mx} y={my} text="計画外" tone="amber" />
            </g>
          );
        })}
        {ops.map((o) => (
          <g key={o.id}>
            <rect x={o.x} y={o.y} width={NW} height={NH} rx={8} fill="var(--color-card)" stroke={ACTIVITY_BLUE} strokeWidth={1.5} />
            <rect x={o.x} y={o.y} width={NW} height={18} rx={8} fill="var(--color-label-activity-bg)" />
            <circle cx={o.x + 12} cy={o.y + 9} r={3} fill={ACTIVITY_BLUE} />
            <text x={o.x + 22} y={o.y + 13} fontSize={11} fontWeight={700} fill={ACTIVITY_BLUE}>{o.name}</text>
            {o.out && (
              <text x={o.x + 10} y={o.y + 35} fontSize={11} fill={OUTPUT_TERRACOTTA}>→ {o.out}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Badge({ x, y, text, tone }: { x: number; y: number; text: string; tone: "muted" | "forest" | "amber" }) {
  const w = text.length * 11 + 14;
  const color = tone === "forest" ? "var(--forest)" : tone === "amber" ? "var(--amber-ink)" : "var(--color-muted-foreground)";
  const bg = tone === "forest" ? "var(--forest-soft)" : tone === "amber" ? "var(--amber-soft)" : "var(--color-background)";
  return (
    <g>
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} fill={bg} stroke={color} strokeWidth={0.5} />
      <text x={x} y={y + 4} fontSize={10} fontWeight={700} fill={color} textAnchor="middle">{text}</text>
    </g>
  );
}

// ── 計画ノートの表（入力元列つき） ─────────────────────

function PlanTable({ rows, highlight }: { rows: { name: string; from: string; note?: string }[]; highlight?: string }) {
  return (
    <div className="rounded-md border border-border overflow-hidden text-xs max-w-[520px]">
      <div className="bg-secondary text-muted-foreground" style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr" }}>
        {["工程", "入力元", "加水"].map((h) => (
          <div key={h} className={"px-2 py-1 border-r border-border last:border-r-0 " + (h === "入力元" ? "font-semibold text-foreground" : "")}>
            {h}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.name} className="border-t border-border" style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", background: highlight === r.name ? "var(--forest-soft)" : undefined }}>
          <div className="px-2 py-1.5 border-r border-border text-primary underline decoration-dotted">@{r.name}</div>
          <div className="px-2 py-1.5 border-r border-border">{r.from || <span className="text-muted-foreground">—</span>}</div>
          <div className="px-2 py-1.5 text-muted-foreground">{r.note ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

const OPS: Op[] = [
  { id: "mill", name: "製粉", x: 380, y: 20, out: "全粒粉 #12" },
  { id: "doughA", name: "仕込み A", x: 240, y: 130, out: "生地 A" },
  { id: "doughB", name: "仕込み B", x: 520, y: 130, out: "生地 B" },
  { id: "bake", name: "焼成", x: 380, y: 240, out: "焼き上がり" },
  { id: "taste", name: "試食", x: 380, y: 350 },
];

const ROWS = [
  { name: "製粉", from: "" },
  { name: "仕込み A", from: "製粉", note: "65%" },
  { name: "仕込み B", from: "製粉", note: "72%" },
  { name: "焼成", from: "仕込み A、仕込み B" },
  { name: "試食", from: "焼成" },
];

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Proposal/計画の線と実績の線",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "計画ノートの工程フローに、予定の線（計画ノートの表が持つ）と実績の線（工程ノートの参照）を重ねる提案。" } },
  },
};
export default meta;
type Story = StoryObj;

export const PlannedOnly: Story = {
  name: "1. 予定だけ（計画の段階）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="計画の線は計画ノート自身の表に持つ"
          points={[
            "表に「入力元」列を足す。中身は工程の行名（複数なら「、」区切り）。この列が予定の線の実体。",
            "工程フローでポートを引くと、この列に行名が書かれる。相手のノートには何も書かない（前回の懸念を満たす）。",
            "予定の線は灰色の点線に「予定」。まだ何も実行していない計画の絵。",
            "行順からは線を作らない（今までどおり）。入力元は人が書いた明示的な予定。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTable rows={ROWS} />
        <Flow
          title="工程フロー（予定だけ）"
          ops={OPS}
          edges={[
            { from: "mill", to: "doughA", kind: "planned" },
            { from: "mill", to: "doughB", kind: "planned" },
            { from: "doughA", to: "bake", kind: "planned" },
            { from: "doughB", to: "bake", kind: "planned" },
            { from: "bake", to: "taste", kind: "planned" },
          ]}
        />
      </div>
    </Frame>
  ),
};

export const InProgress: Story = {
  name: "2. 途中（計画どおり・予定・計画外が混在）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="実績が付くと線が変わる"
          points={[
            "実績の線 = 工程ノートの手順が前の工程の出力を入力に選んだ参照（今の仕組みのまま）。",
            "予定と実績が一致した線は緑の実線に「計画どおり」。",
            "実績はあるが予定に無い線は琥珀の実線に「計画外」（焼成が仕込み A の生地しか使わず、試食が製粉の粉を直接使った）。",
            "予定はあるがまだ実績が無い線は点線のまま（仕込み B → 焼成）。",
            "「計画どおりに進んだか」が工程フローで読める。これが計画の線を持つ一番の価値。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTable rows={ROWS} highlight="焼成" />
        <Flow
          title="工程フロー（途中）"
          ops={OPS}
          edges={[
            { from: "mill", to: "doughA", kind: "both" },
            { from: "mill", to: "doughB", kind: "both" },
            { from: "doughA", to: "bake", kind: "both" },
            { from: "doughB", to: "bake", kind: "planned" },
            { from: "bake", to: "taste", kind: "planned" },
            { from: "mill", to: "taste", kind: "executed" },
          ]}
        />
      </div>
    </Frame>
  ),
};

export const ExecutedOnly: Story = {
  name: "3. 実績だけ（計画を書かなかった場合）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="入力元を書かなければ今と同じ"
          points={[
            "入力元列が空なら、線は実績だけ。すべて「計画外」の印になるのは煩いので、**計画に予定の線が 1 本も無いときは印を出さない**（今の表示と同じ実線）。",
            "印が出るのは、予定を 1 本でも書いた計画だけ。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTable rows={ROWS.map((r) => ({ ...r, from: "" }))} />
        <Flow
          title="工程フロー（実績だけ・印なし）"
          ops={OPS}
          edges={[
            { from: "mill", to: "doughA", kind: "both" },
            { from: "doughA", to: "bake", kind: "both" },
            { from: "bake", to: "taste", kind: "both" as const },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">※ このストーリーの実線は「計画どおり」の印を省いた見た目の代わりに同じ色で描いている</p>
      </div>
    </Frame>
  ),
};

export const DrawingEdge: Story = {
  name: "4. フローで予定の線を引く",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="ポートを引く = 表の入力元に書く"
          points={[
            "工程ノードのポートを再び掴めるようにする。ドラッグして別の工程に落とすと、落とした先の行の「入力元」に元の工程名が追記される。",
            "書き込み先は計画ノート自身の表なので、副作用は表の 1 セルだけ。相手のノートに step は生まれない。",
            "予定の線を選んで削除 → そのセルから名前を消す。実績の線は選んでもここでは消せない（工程ノート側で外す）。",
            "予定の線は PROV には出さない（実績ではない）。v1 はノートと表の中だけ。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTable rows={ROWS.map((r) => (r.name === "試食" ? { ...r, from: "焼成、仕込み A" } : r))} highlight="試食" />
        <Flow
          title="仕込み A → 試食 の予定を引いた直後"
          ops={OPS}
          edges={[
            { from: "mill", to: "doughA", kind: "planned" },
            { from: "mill", to: "doughB", kind: "planned" },
            { from: "doughA", to: "bake", kind: "planned" },
            { from: "doughB", to: "bake", kind: "planned" },
            { from: "bake", to: "taste", kind: "planned" },
            { from: "doughA", to: "taste", kind: "planned" },
          ]}
        />
      </div>
    </Frame>
  ),
};
