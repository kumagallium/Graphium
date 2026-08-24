// 外部参照アウトプットの由来表示 — デザイン比較ストーリー
//
// 「前手順」で別ノートのアウトプットを受け取ったとき、その由来
// （どのノートのどのステップから来たか）をどこに表示するかの案比較。
// BlockNote を起動しない純粋なモック。
//
// 【決定 2026-08-23→24 改訂】受け取りは [インプット] 表の行。由来は行名を
// @ノートリンクと同じ青テキストにし、クリックで参照元を開く（リンク切れは赤）。
// 属性は選択時点の値を列コピー + 参照元の現在値をフローパネルに RO 並記。
// 右横チップ案は「セル外に浮いて隣に被る」ため 1 日で撤回。経緯は design.md。
//
// 見るべきところ:
//   - 由来は参考情報（Tertiary）— step の読み書きを邪魔しない大きさに収まっているか
//   - 「実際に受け取った物（インプット span）」と由来の距離感
//   - リンク切れの伝わり方（赤くしすぎて本文の邪魔をしていないか）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link2, ExternalLink } from "lucide-react";
import "../../app.css";

// ── step ブロックのモック骨格（実装 view.tsx の見た目を再現） ──

function Chip({ text, linked = true }: { text: string; linked?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        height: 20,
        maxWidth: 300,
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        border: `1px solid ${linked ? "var(--color-label-activity)" : "var(--color-border)"}`,
        background: linked ? "var(--color-label-activity-bg)" : "transparent",
        color: linked ? "var(--color-label-activity)" : "var(--color-text-tertiary)",
      }}
    >
      <Link2 size={11} strokeWidth={2.2} style={{ flex: "0 0 auto" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
    </span>
  );
}

function NextStepChip() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 8px",
        height: 20,
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        border: "1px solid var(--color-border)",
        color: "var(--color-text-tertiary)",
      }}
    >
      + 次ステップ
    </span>
  );
}

/** 本文のインプット span（inline-label material の実色） */
function MaterialSpan({ text, broken = false }: { text: string; broken?: boolean }) {
  return (
    <span
      style={{
        padding: "0 0.1em",
        borderRadius: 2,
        background: "rgba(75, 122, 82, 0.18)",
        borderBottom: broken ? "1px dashed var(--color-error)" : "1px solid #4B7A52",
      }}
    >
      {text}
    </span>
  );
}

function StepCard({
  chipText,
  headerExtra,
  children,
}: {
  chipText: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderLeft: "3px solid var(--color-label-activity)",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        borderLeftWidth: 3,
        borderLeftColor: "var(--color-label-activity)",
        background: "var(--color-card)",
        maxWidth: 620,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 12px",
          background: "var(--color-surface-hover)",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700 }}>⋮≡ 粉砕</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <Chip text={chipText} />
          <NextStepChip />
        </span>
        {headerExtra}
      </div>
      <div style={{ padding: "10px 14px 14px 24px", fontSize: 14, lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: "6px 0 18px", fontSize: 12, color: "var(--color-text-tertiary)", maxWidth: 620 }}>
      {children}
    </p>
  );
}

const meta = {
  title: "Blocks/Step/外部参照の由来表示（比較）",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

// ── 現状（ヘッダー下バッジ列） ──

function CurrentBadgeRow({ broken = false }: { broken?: boolean }) {
  return (
    <div style={{ flex: "1 0 100%", display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 26 }}>
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 7px",
          borderRadius: 6,
          border: `1px solid ${broken ? "var(--color-error)" : "var(--color-label-entity)"}`,
          background: broken
            ? "color-mix(in srgb, var(--color-error) 8%, transparent)"
            : "var(--color-label-entity-bg)",
          color: broken ? "var(--color-error)" : "var(--color-label-entity)",
          cursor: "pointer",
          fontSize: 10,
          fontWeight: 500,
        }}
      >
        <ExternalLink size={11} strokeWidth={2.1} />
        <span>
          焼成ペレット
          <span style={{ color: "var(--color-text-tertiary)" }}> ← 焼成実験A › 焼成</span>
          {broken ? " — リンク切れ" : ""}
        </span>
      </button>
    </div>
  );
}

export const 現状: Story = {
  render: () => (
    <div>
      <Note>
        現状: ヘッダーチップとバッジ列が同じ情報を二重表示し、参考情報なのに帯として面積を取る。
      </Note>
      <StepCard
        chipText="← 焼成実験A › 焼成 › 焼成ペレット"
        headerExtra={<CurrentBadgeRow />}
      >
        焼成済み試料を粉砕する。
        <br />
        <MaterialSpan text="焼成ペレット" />
      </StepCard>
    </div>
  ),
};

// ── A 案: span の隣にインライン由来 ──

function InlineOrigin({ broken = false }: { broken?: boolean }) {
  return (
    <button
      type="button"
      title="焼成実験A の 焼成 を開く"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: 6,
        padding: 0,
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: 11,
        color: broken ? "var(--color-error)" : "var(--color-text-tertiary)",
        verticalAlign: "baseline",
      }}
    >
      <ExternalLink size={10} strokeWidth={2} style={{ opacity: 0.7 }} />
      <span>← 焼成実験A › 焼成{broken ? "（リンク切れ）" : ""}</span>
    </button>
  );
}

export const A案_spanの隣にインライン: Story = {
  render: () => (
    <div>
      <Note>
        A 案: 受け取ったインプット span の直後に淡色の小さな由来。クリックで参照元を Side
        Peek。ヘッダー下のバッジ列は廃止。
      </Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット">
        焼成済み試料を粉砕する。
        <br />
        <MaterialSpan text="焼成ペレット" />
        <InlineOrigin />
      </StepCard>
      <div style={{ height: 18 }} />
      <Note>リンク切れ時: span の下線が破線の赤になり、由来も赤い注記になる。</Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット (リンク切れ)">
        焼成済み試料を粉砕する。
        <br />
        <MaterialSpan text="焼成ペレット" broken />
        <InlineOrigin broken />
      </StepCard>
    </div>
  ),
};

// ── B 案: ヘッダーチップに集約 ──

export const B案_ヘッダーチップに集約: Story = {
  render: () => (
    <div>
      <Note>
        B 案: バッジ列を廃止し、既存のヘッダーチップだけにする。チップのメニューに「参照元を開く」を追加。本文には由来を出さない。
      </Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット">
        焼成済み試料を粉砕する。
        <br />
        <MaterialSpan text="焼成ペレット" />
      </StepCard>
    </div>
  ),
};

// ── C 案: ホバーでのみ表示 ──

export const C案_ホバーでのみ表示: Story = {
  render: () => (
    <div>
      <Note>
        C 案: span
        に控えめな二重下線だけ付け、ホバーで由来ポップオーバー（下のモックは常時表示している）。最も静かだがモバイルで到達不能。
      </Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット">
        焼成済み試料を粉砕する。
        <br />
        <span
          style={{
            padding: "0 0.1em",
            borderRadius: 2,
            background: "rgba(75, 122, 82, 0.18)",
            borderBottom: "3px double #4B7A52",
          }}
        >
          焼成ペレット
        </span>
        <span
          style={{
            display: "inline-block",
            marginLeft: 10,
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "var(--color-card)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            fontSize: 11,
            color: "var(--color-text-secondary)",
          }}
        >
          ← 焼成実験A › 焼成
        </span>
      </StepCard>
    </div>
  ),
};

// ── 全案を縦に並べた比較 ──

export const 比較_全案: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {現状.render?.({} as never, {} as never)}
      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />
      {A案_spanの隣にインライン.render?.({} as never, {} as never)}
      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />
      {B案_ヘッダーチップに集約.render?.({} as never, {} as never)}
      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />
      {C案_ホバーでのみ表示.render?.({} as never, {} as never)}
    </div>
  ),
};

// ── D 案: インプット表の行として受け取る ──
//
// 既存の「グラフからの追加は表に行を足す」哲学（F 案 / appendEntityRowToTable）に
// cross-note の受け取りも乗せる案。span ではなく [インプット] 表が育つ。

function InputTable({
  rows,
  withAttrs = false,
}: {
  rows: { name: string; origin?: string; broken?: boolean; attrs?: string[] }[];
  withAttrs?: boolean;
}) {
  const cellStyle: React.CSSProperties = {
    border: "1px solid var(--color-border)",
    padding: "4px 10px",
    fontSize: 13,
    minWidth: 90,
  };
  return (
    <div style={{ margin: "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 7px",
            borderRadius: 6,
            background: "rgba(75, 122, 82, 0.15)",
            color: "#4B7A52",
          }}
        >
          インプット
        </span>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <th style={{ ...cellStyle, background: "var(--color-surface-hover)", fontWeight: 600 }}>
              名前
            </th>
            {withAttrs && (
              <th style={{ ...cellStyle, background: "var(--color-surface-hover)", fontWeight: 600 }}>
                温度
              </th>
            )}
          </tr>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={cellStyle}>
                <span
                  style={
                    r.broken
                      ? { borderBottom: "1px dashed var(--color-error)" }
                      : undefined
                  }
                >
                  {r.name}
                </span>
                {r.origin && (
                  <button
                    type="button"
                    title={`${r.origin} を開く`}
                    style={{
                      marginLeft: 8,
                      padding: 0,
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 10.5,
                      color: r.broken ? "var(--color-error)" : "var(--color-text-tertiary)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <ExternalLink size={10} strokeWidth={2} style={{ opacity: 0.7 }} />
                    ← {r.origin}
                    {r.broken ? "（リンク切れ）" : ""}
                  </button>
                )}
              </td>
              {withAttrs && <td style={cellStyle}>{r.attrs?.[0] ?? ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const D案_インプット表の行として受け取る: Story = {
  render: () => (
    <div>
      <Note>
        D-1: 受け取りは [インプット] 表の行になる（表が無ければ作る）。行の名前セル内に淡色の由来。
        属性は持ってこない — 条件は参照元を開いて見る。
      </Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット">
        焼成済み試料を粉砕する。
        <InputTable rows={[{ name: "焼成ペレット", origin: "焼成実験A › 焼成" }]} />
      </StepCard>
      <div style={{ height: 18 }} />
      <Note>
        D-2: 「条件も取り込む」を選ぶと、選択時点の属性がふつうの編集可能セルとしてコピーされる
        （スナップショット。以後は独立して編集できる）。
      </Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット">
        焼成済み試料を粉砕する。
        <InputTable
          withAttrs
          rows={[{ name: "焼成ペレット", origin: "焼成実験A › 焼成", attrs: ["900C"] }]}
        />
      </StepCard>
      <div style={{ height: 18 }} />
      <Note>リンク切れ時: 行の名前に破線赤下線、由来が赤い注記になる。</Note>
      <StepCard chipText="← 焼成実験A › 焼成 › 焼成ペレット (リンク切れ)">
        焼成済み試料を粉砕する。
        <InputTable rows={[{ name: "焼成ペレット", origin: "焼成実験A › 焼成", broken: true }]} />
      </StepCard>
    </div>
  ),
};
