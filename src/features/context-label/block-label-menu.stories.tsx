// ⠿（ドラッグハンドル）メニューに「ラベル ▸」サブメニューを足す案 Y-1 の見た目モック。
//
// 目的: ブロック全体の Entity 化の入口を ⠿ メニューに集約する（テーブル / メディア /
// 見出しを同じ場所で扱う）。span（テキストの一部）の Entity 化は浮上ツールバー据え置き。
//
// これは「小さなコンポーネント単位で合意する」ためのビジュアルモックであり、
// アプリ配線・BlockNote 依存は持たない（label-badge.stories.tsx と同じ方針）。

import type { Meta, StoryObj } from "@storybook/react-vite";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
  menuBg: "#ffffff",
  menuBorder: "#e3e8e2",
  menuShadow: "0 6px 24px rgba(20,40,24,0.12)",
};

// ── ラベル定義（内部キー / 表示名(JA) / 色） ──
type LabelDef = { key: string; name: string; color: string };

const ENTITY_LABELS: LabelDef[] = [
  { key: "material", name: "インプット", color: "#4B7A52" },
  { key: "tool", name: "ツール", color: "#c08b3e" },
  { key: "attribute", name: "パラメータ", color: "#8a8a8a" },
  { key: "output", name: "アウトプット", color: "#c26356" },
];

const HEADING_LABELS: LabelDef[] = [
  { key: "procedure", name: "ステップ", color: "#5b8fb9" },
  { key: "plan", name: "計画", color: "#5b8fb9" },
  { key: "result", name: "結果", color: "#c26356" },
];

// ── 小さな色ドット ──
function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 9999,
        background: color,
        flex: "0 0 auto",
      }}
    />
  );
}

// ── メニュー項目（通常） ──
function MenuItem({
  label,
  hasSubmenu = false,
  hovered = false,
  danger = false,
}: {
  label: string;
  hasSubmenu?: boolean;
  hovered?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        fontSize: 13,
        color: danger ? "#b3463b" : tokens.fg,
        fontFamily: tokens.font,
        borderRadius: 6,
        background: hovered ? tokens.muted : "transparent",
        cursor: "default",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubmenu && (
        <span style={{ color: tokens.mutedFg, fontSize: 12 }}>▸</span>
      )}
    </div>
  );
}

// ── ラベル選択項目（ドット付き） ──
function LabelMenuItem({ def }: { def: LabelDef }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        fontSize: 13,
        color: tokens.fg,
        fontFamily: tokens.font,
        borderRadius: 6,
        cursor: "default",
        whiteSpace: "nowrap",
      }}
    >
      <Dot color={def.color} />
      <span>{def.name}</span>
    </div>
  );
}

// ── メニューパネル枠 ──
function MenuPanel({
  children,
  width = 180,
}: {
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      style={{
        minWidth: width,
        background: tokens.menuBg,
        border: `1px solid ${tokens.menuBorder}`,
        borderRadius: 10,
        boxShadow: tokens.menuShadow,
        padding: 4,
      }}
    >
      {children}
    </div>
  );
}

function MenuDivider() {
  return (
    <div style={{ height: 1, background: tokens.menuBorder, margin: "4px 6px" }} />
  );
}

// ── サブメニューのヒント行 ──
function SubmenuHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "6px 10px 2px",
        fontSize: 11,
        lineHeight: 1.5,
        color: tokens.mutedFg,
        fontFamily: tokens.font,
        whiteSpace: "normal",
        maxWidth: 220,
      }}
    >
      {text}
    </div>
  );
}

// ── ⠿ ボタン ──
function HandleButton() {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        color: tokens.mutedFg,
        background: tokens.muted,
        fontSize: 11,
        letterSpacing: 1,
      }}
    >
      ⠿
    </div>
  );
}

// ── ⠿ メニュー（開いた状態） + サブメニュー flyout ──
function DragHandleMenu({
  submenu,
  hint,
  submenuWidth = 170,
}: {
  submenu?: LabelDef[];
  hint?: string;
  submenuWidth?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <HandleButton />
      {/* メインメニュー */}
      <MenuPanel>
        <MenuItem label="削除" danger />
        <MenuItem label="色" />
        {/* ← 新規追加する項目 */}
        <MenuItem label="ラベル" hasSubmenu hovered={!!submenu} />
        <MenuDivider />
        <MenuItem label="派生ノートを作成" />
        <MenuItem label="AI アシスタント" />
      </MenuPanel>
      {/* サブメニュー flyout（「ラベル」hover 時） */}
      {submenu && (
        <div style={{ marginTop: 56 }}>
          <MenuPanel width={submenuWidth}>
            {submenu.map((d) => (
              <LabelMenuItem key={d.key} def={d} />
            ))}
            {hint && (
              <>
                <MenuDivider />
                <SubmenuHint text={hint} />
              </>
            )}
          </MenuPanel>
        </div>
      )}
    </div>
  );
}

// ── ブロックのプレビュー（左に ⠿ メニュー、右にブロック本体） ──
function BlockRow({
  block,
  children,
}: {
  block: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        padding: 24,
        background: tokens.bg,
        fontFamily: tokens.font,
      }}
    >
      <div style={{ flex: "0 0 auto" }}>{children}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{block}</div>
    </div>
  );
}

// ── ブロック本体プレビュー ──
function TablePreview() {
  const cell: React.CSSProperties = {
    border: `1px solid ${tokens.border}`,
    padding: "4px 10px",
    fontSize: 13,
    color: tokens.fg,
  };
  const head: React.CSSProperties = { ...cell, background: tokens.muted, fontWeight: 600 };
  return (
    <table style={{ borderCollapse: "collapse", fontFamily: tokens.font }}>
      <tbody>
        <tr>
          <td style={head}>試薬</td>
          <td style={head}>量</td>
          <td style={head}>温度</td>
        </tr>
        <tr>
          <td style={cell}>NaCl</td>
          <td style={cell}>5 g</td>
          <td style={cell}>25 ℃</td>
        </tr>
        <tr>
          <td style={cell}>H₂O</td>
          <td style={cell}>100 mL</td>
          <td style={cell}>25 ℃</td>
        </tr>
      </tbody>
    </table>
  );
}

function MediaPreview() {
  return (
    <div
      style={{
        width: 220,
        height: 130,
        borderRadius: 8,
        border: `1px solid ${tokens.border}`,
        background: "linear-gradient(135deg,#eef3ec,#dfe9dd)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: tokens.mutedFg,
        fontSize: 13,
        fontFamily: tokens.font,
      }}
    >
      🖼 画像ブロック
    </div>
  );
}

function HeadingPreview() {
  return (
    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: tokens.fg, fontFamily: tokens.font }}>
      合成手順
    </h2>
  );
}

// ──────────────────────────────────────────────
const meta: Meta = {
  title: "ContextLabel/BlockLabelMenu (案Y-1)",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "案 Y-1: ブロック全体の Entity 化を ⠿ メニューの「ラベル ▸」に集約する見た目モック。" +
          "テーブル / メディア / 見出しが同じ入口に乗る。span（テキストの一部）は浮上ツールバー据え置き。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

// 1) ⠿ メニュー（閉じたサブメニュー状態）— 新項目「ラベル」の位置を確認
export const MenuWithLabelItem: Story = {
  name: "① ⠿ メニューに「ラベル」を追加",
  render: () => (
    <BlockRow block={<TablePreview />}>
      <DragHandleMenu />
    </BlockRow>
  ),
};

// 2) テーブル: ラベルサブメニュー（行→Entity 展開のヒント付き）
export const SubmenuTable: Story = {
  name: "② テーブル → ラベル ▸",
  render: () => (
    <BlockRow block={<TablePreview />}>
      <DragHandleMenu
        submenu={ENTITY_LABELS}
        hint="各行が 1 Entity に展開されます（2 行 → 2 Entity / 列見出し = 属性キー）。パラメータを選ぶと手順の params になります。"
      />
    </BlockRow>
  ),
};

// 3) メディア: ラベルサブメニュー（ブロック=1 Entity）
export const SubmenuMedia: Story = {
  name: "③ メディア → ラベル ▸",
  render: () => (
    <BlockRow block={<MediaPreview />}>
      <DragHandleMenu
        submenu={ENTITY_LABELS}
        hint="このブロック全体が 1 つの Entity になります。"
      />
    </BlockRow>
  ),
};

// 4) 見出し: ラベルサブメニュー（section / phase）
export const SubmenuHeading: Story = {
  name: "④ 見出し → ラベル ▸",
  render: () => (
    <BlockRow block={<HeadingPreview />}>
      <DragHandleMenu
        submenu={HEADING_LABELS}
        hint="見出しは手順（Activity）の境界やフェーズ（計画 / 結果）を表します。"
      />
    </BlockRow>
  ),
};

// 5) 全体像: 3 ブロック種別が同じ入口に乗ることを一覧で示す
export const Overview: Story = {
  name: "⑤ 全体像（同じ入口に集約）",
  render: () => (
    <div
      style={{
        padding: 32,
        background: tokens.bg,
        fontFamily: tokens.font,
        color: tokens.fg,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16 }}>
        ブロック全体の Entity 化 → すべて ⠿ メニューの「ラベル ▸」に集約
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: tokens.mutedFg, lineHeight: 1.6, maxWidth: 640 }}>
        テキストの一部（span）の Entity 化は浮上ツールバーのまま。ブロック全体（テーブル /
        メディア / 見出し）は ⠿ メニューに統一し、「テーブルだけ #」の非対称をなくす。
        保存先はハンドラ内で分岐（テーブル・見出し → labels[] / メディア → mediaInlineLabels[]）。
      </p>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 8 }}>テーブル</div>
          <DragHandleMenu submenu={ENTITY_LABELS} hint="各行が 1 Entity に展開。" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 8 }}>メディア</div>
          <DragHandleMenu submenu={ENTITY_LABELS} hint="ブロック全体 = 1 Entity。" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 8 }}>見出し</div>
          <DragHandleMenu submenu={HEADING_LABELS} hint="手順 / フェーズの境界。" />
        </div>
      </div>
    </div>
  ),
};
