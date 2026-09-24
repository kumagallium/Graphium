// 工程グラフを「表ごと」に束ねる提案ストーリー
//
// 背景: 計画ノートにはインデックステーブルを複数置ける（例: 生地 / 焼成 / 評価 の 3 表）。
// 利用者はこの表の単位で工程を考えているのに、今の工程グラフは全部の表の行を
// 1 つの平面に混ぜて描くため、その層が消えている。時系列ビューへの「折りたたみ」
// 要望も、根っこはこの「表の層が見えない」こと。
//
// 提案:
//   1. 工程ノードに「所属する表」を持たせ、表ごとの帯（グループ枠）で囲む。色相は表名から
//      決める（フォルダの色と同じ noteContextHue）。線は今までどおり帯をまたいで引ける
//   2. 線を選んだときのメニューに「根拠を見る」を足す。実績の線は工程ノートの手順が
//      根拠なので、どの手順がどの出力を使ったかを示して相手ノートへ飛べるようにする
//   3. 予定の線に 2 種類を持たせる: 「物を渡す」（今の入力元）と「順序だけ」。
//      メニューで切り替える。実績の線の種類は変えられない（記録の書き換えになる）
//
// 見るべきところ:
//   - 帯で囲むと表の層が読めるか。バッジだけ（枠なし）と比べてどちらが良いか
//   - 「根拠を見る」で「なぜ繋がっているか」の疑問が解けるか
//   - 予定 2 種の描き分け（点線 + 矢印の形）が区別できるか
//
// 本ストーリーは視覚合意用。データ配線はしていない。
// 決定したら FlowStep に group（表の id と名前）を足し、StepFlowView が
// React Flow の親ノード + ELK の入れ子レイアウトで帯を描く。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import "../../app.css";

// ── 共通部品（planned-edges.proposal と同じ流儀） ────────

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

// ── モックの型 ─────────────────────────────────────────

type EdgeKind = "planned" | "plannedOrder" | "both" | "executed";
type Group = { id: string; name: string; x: number; y: number; w: number; h: number };
type Op = { id: string; name: string; group: string; x: number; y: number };
type E = { from: string; to: string; kind: EdgeKind; selected?: boolean };

const ACTIVITY_BLUE = "#3f6c92";
const NW = 150;
const NH = 44;

// 色相は表の並び順で等間隔に振る（同じ計画の中で見分けがつくことを優先。
// 名前のハッシュだと「生地」「焼成」のように近い色相に落ちることがある）
const GROUP_HUES = [150, 30, 275, 200, 340, 80];
function groupColors(index: number) {
  const h = GROUP_HUES[index % GROUP_HUES.length];
  return { fill: `hsl(${h}, 45%, 95%)`, stroke: `hsl(${h}, 35%, 62%)`, ink: `hsl(${h}, 40%, 32%)` };
}

// ── 工程フローのモック（上から下、StepFlowView と同じ配色） ────

function Flow({
  groups,
  ops,
  edges,
  title,
  groupStyle,
  menu,
}: {
  groups: Group[];
  ops: Op[];
  edges: E[];
  title: string;
  groupStyle: "band" | "badge";
  menu?: { x: number; y: number; kind: "executed" | "planned" };
}) {
  const by = Object.fromEntries(ops.map((o) => [o.id, o]));
  const gby = Object.fromEntries(groups.map((g) => [g.id, g]));
  const bottom = Math.max(...groups.map((g) => g.y + g.h), ...ops.map((o) => o.y + NH));
  const H = bottom + (menu ? 150 : 40);
  const menuPos = menu ? { x: 360, y: bottom + 24 } : null;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground mb-2">
        {title}
        <span className="ml-2 text-[10px]">（右パネル「工程」サブタブの絵。本文には出ない）</span>
      </p>
      <svg width={760} height={H} className="block max-w-full" style={{ fontSize: 12 }}>
        <defs>
          <marker id="pg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
          <marker id="pg-arrow-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <circle cx="5" cy="5" r="3" fill="var(--color-card)" stroke="context-stroke" strokeWidth="1.5" />
          </marker>
        </defs>
        {groupStyle === "band" &&
          groups.map((g) => {
            const c = groupColors(groups.indexOf(g));
            return (
              <g key={g.id}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={12} fill={c.fill} stroke={c.stroke} strokeWidth={1} strokeDasharray="6 4" />
                <text x={g.x + 14} y={g.y + 20} fontSize={12} fontWeight={700} fill={c.ink}>
                  {g.name}
                </text>
                <text x={g.x + 14} y={g.y + 36} fontSize={10} fill={c.ink} opacity={0.75}>
                  表の行 {ops.filter((o) => o.group === g.id).length}
                </text>
              </g>
            );
          })}
        {edges.map((e, i) => {
          const a = by[e.from];
          const b = by[e.to];
          const sameRow = a.y === b.y;
          const x1 = sameRow ? a.x + NW : a.x + NW / 2;
          const y1 = sameRow ? a.y + NH / 2 : a.y + NH;
          const x2 = sameRow ? b.x : b.x + NW / 2;
          const y2 = sameRow ? b.y + NH / 2 : b.y;
          // 同じ帯の中（同じ行）の線は右から左へ水平に、それ以外は下から上へ
          const d = sameRow
            ? `M${x1} ${y1} C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2 - 2} ${y2}`
            : `M${x1} ${y1} C${x1} ${y1 + 40} ${x2} ${y2 - 40} ${x2} ${y2 - 2}`;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const halo = e.selected ? <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={8} opacity={0.18} /> : null;
          if (e.kind === "planned" || e.kind === "plannedOrder") {
            const order = e.kind === "plannedOrder";
            return (
              <g key={i}>
                {halo}
                <path
                  d={d}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth={1.5}
                  strokeDasharray={order ? "2 4" : "5 4"}
                  markerEnd={order ? "url(#pg-arrow-open)" : "url(#pg-arrow)"}
                />
                <Badge x={mx} y={my} text={order ? "予定（順序）" : "予定"} tone="muted" />
              </g>
            );
          }
          if (e.kind === "both") {
            return (
              <g key={i}>
                {halo}
                <path d={d} fill="none" stroke="var(--forest)" strokeWidth={2} markerEnd="url(#pg-arrow)" />
                <Badge x={mx} y={my} text="計画どおり" tone="forest" />
              </g>
            );
          }
          return (
            <g key={i}>
              {halo}
              <path d={d} fill="none" stroke="var(--amber)" strokeWidth={2} markerEnd="url(#pg-arrow)" />
              <Badge x={mx} y={my} text="計画外" tone="amber" />
            </g>
          );
        })}
        {ops.map((o) => {
          const g = gby[o.group];
          const c = groupColors(groups.indexOf(g));
          return (
            <g key={o.id}>
              <rect x={o.x} y={o.y} width={NW} height={NH} rx={8} fill="var(--color-card)" stroke={ACTIVITY_BLUE} strokeWidth={1.5} />
              <rect x={o.x} y={o.y} width={NW} height={18} rx={8} fill="var(--color-label-activity-bg)" />
              <circle cx={o.x + 12} cy={o.y + 9} r={3} fill={ACTIVITY_BLUE} />
              <text x={o.x + 22} y={o.y + 13} fontSize={11} fontWeight={700} fill={ACTIVITY_BLUE}>
                {o.name}
              </text>
              {groupStyle === "badge" ? (
                <g>
                  <rect x={o.x + 8} y={o.y + 24} width={g.name.length * 11 + 12} height={14} rx={7} fill={c.fill} stroke={c.stroke} strokeWidth={0.5} />
                  <text x={o.x + 14} y={o.y + 34} fontSize={9.5} fontWeight={600} fill={c.ink}>
                    {g.name}
                  </text>
                </g>
              ) : (
                <text x={o.x + 10} y={o.y + 35} fontSize={10} fill="var(--color-muted-foreground)">
                  ノートを開く
                </text>
              )}
            </g>
          );
        })}
        {menu && menuPos && (
          <g>
            <EdgeMenu x={menuPos.x} y={menuPos.y} kind={menu.kind} />
          </g>
        )}
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
      <text x={x} y={y + 4} fontSize={10} fontWeight={700} fill={color} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

// 線を選んだときのメニュー（StepFlowView の edgeMenu と同じ位置づけ）
function EdgeMenu({ x, y, kind }: { x: number; y: number; kind: "executed" | "planned" }) {
  const items =
    kind === "executed"
      ? [
          { label: "根拠を見る", sub: "焼き 002 の手順「成形」が 生地 A の出力「生地」を使用 → ノートを開く" },
          { label: "予定に加える", sub: "計画の表の入力元に書き足して「計画どおり」にする" },
        ]
      : [
          { label: "根拠を見る", sub: "計画の表「生地 B」の入力元 → 表の行へ" },
          { label: "物を渡すにする", sub: "今は順序だけの予定。前の工程の出力を使う予定に変える" },
          { label: "予定を外す", sub: "" },
        ];
  const w = 330;
  const rowH = 34;
  const h = 10 + items.length * rowH;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={1} style={{ filter: "drop-shadow(0 4px 12px rgba(30,20,10,0.16))" }} />
      {items.map((it, i) => (
        <g key={it.label}>
          <text x={x + 14} y={y + 22 + i * rowH} fontSize={12} fontWeight={600} fill="var(--color-foreground)">
            {it.label}
          </text>
          {it.sub && (
            <text x={x + 14} y={y + 36 + i * rowH} fontSize={9.5} fill="var(--color-muted-foreground)">
              {it.sub}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

// ── 計画ノートの表（3 表） ─────────────────────────────

function PlanTables({ highlightOrder }: { highlightOrder?: boolean }) {
  const tables: { name: string; cols: string[]; rows: string[][] }[] = [
    { name: "生地", cols: ["生地", "入力元", "加水"], rows: [["@生地 A", "", "65%"], ["@生地 B", highlightOrder ? "生地 A（順序）" : "生地 A", "72%"]] },
    { name: "焼成", cols: ["焼成", "入力元", "温度"], rows: [["@焼き 001", "生地 A", "230℃"], ["@焼き 002", "生地 B", "250℃"]] },
    { name: "評価", cols: ["評価", "入力元", ""], rows: [["@試食まとめ", "焼き 001、焼き 002", ""]] },
  ];
  return (
    <div className="flex gap-4 flex-wrap">
      {tables.map((t, ti) => {
        const c = groupColors(ti);
        return (
          <div key={t.name} className="text-xs">
            <p className="mb-1 font-semibold" style={{ color: c.ink }}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: c.stroke }} />
              {t.name}
              <span className="ml-1 font-normal text-muted-foreground">（表のキャプション）</span>
            </p>
            <div className="rounded-md border border-border overflow-hidden" style={{ minWidth: 260 }}>
              <div className="bg-secondary text-muted-foreground" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.7fr" }}>
                {t.cols.map((h, i) => (
                  <div key={i} className="px-2 py-1 border-r border-border last:border-r-0">
                    {h}
                  </div>
                ))}
              </div>
              {t.rows.map((r, i) => (
                <div key={i} className="border-t border-border" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.7fr" }}>
                  <div className="px-2 py-1.5 border-r border-border text-primary underline decoration-dotted">{r[0]}</div>
                  <div className="px-2 py-1.5 border-r border-border">{r[1] || <span className="text-muted-foreground">—</span>}</div>
                  <div className="px-2 py-1.5 text-muted-foreground">{r[2]}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── データ ───────────────────────────────────────────

const GROUPS: Group[] = [
  { id: "dough", name: "生地", x: 20, y: 20, w: 720, h: 96 },
  { id: "bake", name: "焼成", x: 20, y: 156, w: 720, h: 96 },
  { id: "eval", name: "評価", x: 20, y: 292, w: 720, h: 96 },
];

const OPS: Op[] = [
  { id: "doughA", name: "生地 A", group: "dough", x: 200, y: 46 },
  { id: "doughB", name: "生地 B", group: "dough", x: 460, y: 46 },
  { id: "bake1", name: "焼き 001", group: "bake", x: 200, y: 182 },
  { id: "bake2", name: "焼き 002", group: "bake", x: 460, y: 182 },
  { id: "taste", name: "試食まとめ", group: "eval", x: 330, y: 318 },
];

const EDGES: E[] = [
  { from: "doughA", to: "bake1", kind: "both" },
  { from: "doughB", to: "bake2", kind: "both" },
  { from: "doughA", to: "bake2", kind: "executed" },
  { from: "bake1", to: "taste", kind: "both" },
  { from: "bake2", to: "taste", kind: "planned" },
];

// バッジ案は帯が無いので、ノードを詰めて描く
const OPS_TIGHT: Op[] = OPS.map((o) => ({ ...o, y: o.y - (o.group === "dough" ? 20 : o.group === "bake" ? 60 : 100) }));
const GROUPS_TIGHT: Group[] = GROUPS.map((g) => ({ ...g, h: 0 }));

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Proposal/工程の表ごとのグループ",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "計画ノートの工程グラフを、インデックステーブルごとの帯で束ねる提案。線のメニューに根拠と予定の種類も足す。" } },
  },
};
export default meta;
type Story = StoryObj;

export const Bands: Story = {
  name: "1. 表ごとの帯で囲む",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="表 = 層。帯で囲む"
          points={[
            "計画ノートの各インデックステーブルが 1 つの帯になる。帯の名前は表のキャプション、色相は表の並び順で等間隔に振る（同じ計画の中で見分けがつくことを優先）。",
            "帯の順番は本文での表の順。帯の中は今までどおり ELK が並べる。",
            "線は帯をまたいで引ける（入力元は表をまたいで解決できる。今の仕組みのまま）。",
            "キャプションの無い表は「表 1」「表 2」。表が 1 つだけの計画は帯を描かない（今の絵と同じ）。",
            "時系列ビューの「折りたたみ」案で欲しかった層は、この帯で出るはず。時系列は時間軸の絵に徹する。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTables />
        <Flow title="工程フロー（帯）" groups={GROUPS} ops={OPS} edges={EDGES} groupStyle="band" />
      </div>
    </Frame>
  ),
};

export const Badges: Story = {
  name: "2. 比較: バッジだけ（枠なし）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="帯を描かず、ノードに表名のバッジ"
          points={[
            "レイアウトは今のまま（ELK の自由配置）。ノードの 2 行目に表名の色付きバッジ。",
            "利点: 実装が軽い（ノードのカードにバッジを足すだけ）。線が帯を横切る問題も無い。",
            "欠点: 層は「読める」が「見える」わけではない。工程が増えると色だけでは追えない。",
            "1 と見比べて、帯の圧迫感と層の見やすさのどちらを取るか。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTables />
        <Flow title="工程フロー（バッジ）" groups={GROUPS_TIGHT} ops={OPS_TIGHT} edges={EDGES} groupStyle="badge" />
      </div>
    </Frame>
  ),
};

export const EvidenceMenu: Story = {
  name: "3. 線のメニュー: 根拠を見る",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="「なぜ繋がっているか」に答える"
          points={[
            "実績の線（計画どおり / 計画外）は、工程ノートの手順が前の工程の出力を入力に選んだ参照が根拠。今はその根拠が線からは分からない。",
            "線を選ぶと「根拠を見る」: どの手順が、どの出力を使ったかを 1 行で示し、押すとその工程ノートを手順の位置で開く。",
            "実績の線の「種類」は変えられない。変えるなら工程ノート側の手順を直す（記録の書き換えを工程グラフからはしない）。",
            "計画外の線には「予定に加える」も出す。計画の表の入力元に書き足すだけ（相手ノートには書かない）。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <Flow
          title="工程フロー（計画外の線を選択）"
          groups={GROUPS}
          ops={OPS}
          edges={EDGES.map((e) => (e.from === "doughA" && e.to === "bake2" ? { ...e, selected: true } : e))}
          groupStyle="band"
          menu={{ x: 441, y: 230, kind: "executed" }}
        />
      </div>
    </Frame>
  ),
};

export const PlannedKinds: Story = {
  name: "4. 予定の 2 種類: 物を渡す / 順序だけ",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="予定の線に「順序だけ」を足す"
          points={[
            "今の予定の線は「前の工程の出力を使うつもり」だけ。同じ生地を使わないが順番は決まっている、を書けない。",
            "「順序だけ」の予定は、細かい点線 + 丸い先端。作業手順タブの informed_by（順序のみ）と同じ意味。",
            "表では入力元セルに「生地 A（順序）」のように印を付ける（列は増やさない）。列を分ける案も可。",
            "線のメニューで「順序だけにする」「物を渡すにする」を切り替える。書き込み先は計画の表のセルだけ。",
            "実績側に「順序だけ」が付いたときの照合は、informed_by の cross-note 参照と突き合わせる。",
          ]}
        />
      }
    >
      <div className="space-y-4">
        <PlanTables highlightOrder />
        <Flow
          title="工程フロー（生地 A → 生地 B は順序だけの予定）"
          groups={GROUPS}
          ops={OPS}
          edges={[{ from: "doughA", to: "doughB", kind: "plannedOrder", selected: true }, ...EDGES]}
          groupStyle="band"
          menu={{ x: 405, y: 68, kind: "planned" }}
        />
      </div>
    </Frame>
  ),
};
