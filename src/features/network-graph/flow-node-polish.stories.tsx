// 【提案モック】フロービューのノードの見た目そろえ
//
// 機能が固まったので、見た目を詰めるための比較用。実装は入れず、
// 静的な div でノードだけを並べる（合意した案を本実装へ反映する）。
//
// 論点は 2 つ:
//   1. ステップと Entity が別の作りに見える
//      現在: ステップ = 白地に左の青エッジ / Entity = 色付きヘッダー帯
//      → 4 種類が 1 つの家族に見えないので、どちらかに寄せたい
//   2. 選択の表し方
//      現在: 枠線が 1px → 1.5px（Entity は 1.5 → 2px）に太くなる
//      → ノードの実寸が変わるので React Flow が測り直し、
//        レイアウトが微妙にずれる。太さは固定してリングで示したい

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { LocaleProvider } from "../../i18n";

const meta: Meta = {
  title: "Proposal/ノードの見た目そろえ",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ padding: 24, background: "var(--color-background)", minHeight: "100vh" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

type Kind = "step" | "material" | "tool" | "output";

const PALETTE: Record<Kind, { main: string; bg: string; text: string }> = {
  step: { main: "#5b8fb9", bg: "var(--color-label-activity-bg)", text: "#3f6c92" },
  material: { main: "#4B7A52", bg: "var(--color-label-entity-bg)", text: "#2d4a32" },
  tool: { main: "#c08b3e", bg: "var(--color-label-parameter-bg)", text: "#7a5a22" },
  output: { main: "#c26356", bg: "var(--color-label-result-bg)", text: "#a8513f" },
};

const LABEL: Record<Kind, string> = {
  step: "混合",
  material: "Ni粉末",
  tool: "乳鉢",
  output: "混合粉",
};

/** 種類を示す点。ツールだけ菱形（design.md のグラフ形状に合わせる） */
function KindDot({ kind }: { kind: Kind }) {
  const c = PALETTE[kind];
  return (
    <span
      style={{
        width: 8,
        height: 8,
        flexShrink: 0,
        borderRadius: kind === "tool" ? 1 : "50%",
        transform: kind === "tool" ? "rotate(45deg)" : undefined,
        background: c.main,
      }}
    />
  );
}

function CountChip({ n }: { n: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        color: "var(--color-text-tertiary)",
      }}
    >
      <SlidersHorizontal size={10} />
      {n}
    </span>
  );
}

// ── 現在 ──────────────────────────────────────────────

function NodeNow({ kind, selected, count }: { kind: Kind; selected: boolean; count: number }) {
  const c = PALETTE[kind];
  if (kind === "step") {
    return (
      <div
        style={{
          minWidth: 180,
          borderRadius: 8,
          background: "var(--color-card)",
          borderTop: selected ? `1.5px solid ${c.main}` : "1px solid var(--color-border)",
          borderRight: selected ? `1.5px solid ${c.main}` : "1px solid var(--color-border)",
          borderBottom: selected ? `1.5px solid ${c.main}` : "1px solid var(--color-border)",
          borderLeft: `3px solid ${c.main}`,
          boxShadow: selected ? "var(--shadow-2)" : "var(--shadow-1)",
        }}
      >
        <div style={{ padding: "7px 8px 5px 10px", fontSize: 13, fontWeight: 700, color: "var(--color-foreground)" }}>
          {LABEL[kind]}
        </div>
        {count > 0 && <div style={{ padding: "0 10px 5px" }}><CountChip n={count} /></div>}
      </div>
    );
  }
  return (
    <div
      style={{
        minWidth: 140,
        borderRadius: 8,
        background: "var(--color-card)",
        border: selected ? `2px solid ${c.main}` : `1.5px solid ${c.main}`,
        boxShadow: selected ? "var(--shadow-2)" : "var(--shadow-1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: c.bg,
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        <KindDot kind={kind} />
        {LABEL[kind]}
      </div>
      {count > 0 && <div style={{ padding: "2px 10px 5px" }}><CountChip n={count} /></div>}
    </div>
  );
}

// ── 案A: ヘッダー帯に統一（ステップも色帯を持つ） ──────────────

function NodeHeaderBand({ kind, selected, count }: { kind: Kind; selected: boolean; count: number }) {
  const c = PALETTE[kind];
  return (
    <div
      style={{
        minWidth: kind === "step" ? 180 : 140,
        borderRadius: 8,
        background: "var(--color-card)",
        border: `1.5px solid ${c.main}`,
        // 実寸を変えずに選択を示す（測り直しが起きない）
        boxShadow: selected ? `0 0 0 3px ${c.main}33, var(--shadow-2)` : "var(--shadow-1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: c.bg,
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        <KindDot kind={kind} />
        {LABEL[kind]}
      </div>
      {count > 0 && <div style={{ padding: "2px 10px 5px" }}><CountChip n={count} /></div>}
    </div>
  );
}

// ── 案B: 左エッジに統一（Entity の色帯をやめる） ───────────────

function NodeLeftEdge({ kind, selected, count }: { kind: Kind; selected: boolean; count: number }) {
  const c = PALETTE[kind];
  return (
    <div
      style={{
        minWidth: kind === "step" ? 180 : 140,
        borderRadius: 8,
        background: "var(--color-card)",
        borderTop: "1px solid var(--color-border)",
        borderRight: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        borderLeft: `3px solid ${c.main}`,
        boxShadow: selected ? `0 0 0 3px ${c.main}33, var(--shadow-2)` : "var(--shadow-1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 8px 6px 10px",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--color-foreground)",
        }}
      >
        <KindDot kind={kind} />
        {LABEL[kind]}
      </div>
      {count > 0 && <div style={{ padding: "0 10px 6px 21px" }}><CountChip n={count} /></div>}
    </div>
  );
}

// ── 並べて比較 ────────────────────────────────────────

const KINDS: Kind[] = ["step", "material", "tool", "output"];

function Column({
  title,
  note,
  Node,
}: {
  title: string;
  note: string;
  Node: (p: { kind: Kind; selected: boolean; count: number }) => ReactNode;
}) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-foreground)", paddingBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", paddingBottom: 12, minHeight: 30 }}>{note}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {KINDS.map((k) => (
          <Node key={k} kind={k} selected={false} count={k === "step" ? 2 : k === "material" ? 3 : 0} />
        ))}
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", paddingTop: 10 }}>選択中</div>
        {KINDS.map((k) => (
          <Node key={`sel-${k}`} kind={k} selected count={k === "step" ? 2 : k === "material" ? 3 : 0} />
        ))}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" };

export const NodeFamily: Story = {
  name: "ノードの family（現在 / 案A / 案B）",
  render: () => (
    <div style={wrapStyle}>
      <Column
        title="現在"
        note="ステップだけ作りが違う。選択で枠が太くなり実寸が変わる"
        Node={NodeNow}
      />
      <Column
        title="案A: ヘッダー帯にそろえる"
        note="4 種類が同じ形。色が強く出るので、グラフ全体は賑やかになる"
        Node={NodeHeaderBand}
      />
      <Column
        title="案B: 左エッジにそろえる"
        note="色は左の 3px と点だけ。静かで、名前が読みやすい"
        Node={NodeLeftEdge}
      />
    </div>
  ),
};
