// GroundingScopeChip のビジュアル確認用ストーリー。
// 俯瞰 / 原典 の 2 状態と、トグルの操作感を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider } from "@/i18n";
import { GroundingScopeChip } from "./GroundingScopeChip";
import type { GroundingScope } from "../../lib/grounding-scope";

const meta: Meta<typeof GroundingScopeChip> = {
  title: "Atoms/GroundingScopeChip",
  component: GroundingScopeChip,
  parameters: {
    docs: {
      description: {
        component:
          "Cmd+K Composer の grounding スコープ切り替え。俯瞰（派生知識+Wiki を含め広く・着想/構成向け）/ 原典（原文＋派生メモに絞る・執筆/引用/検証向け）の 2 状態セグメント。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof GroundingScopeChip>;

function Interactive({ initial }: { initial: GroundingScope }) {
  const [scope, setScope] = useState<GroundingScope>(initial);
  return (
    <LocaleProvider>
      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "flex-start",
          background: "var(--paper)",
        }}
      >
        <GroundingScopeChip value={scope} onChange={setScope} />
        <code style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
          scope = {scope}
        </code>
      </div>
    </LocaleProvider>
  );
}

/** 既定（俯瞰）。着想・構成段階で派生知識＋Wiki を含めて広く渡す。 */
export const Overview: Story = {
  render: () => <Interactive initial="overview" />,
};

/** 原典に絞った状態。執筆・引用・検証段階で原文＋派生メモのみ渡す。 */
export const Primary: Story = {
  render: () => <Interactive initial="primary" />,
};

/** Composer 下段（ショートカット行の右）に置いたときの並びイメージ。 */
export const InShortcutRow: Story = {
  render: () => {
    function Row() {
      const [scope, setScope] = useState<GroundingScope>("overview");
      return (
        <div
          style={{
            width: 520,
            padding: "0 16px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "var(--paper)",
          }}
        >
          <span style={{ fontSize: 10, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
            ↑↓ #label / @author · ⌘+Enter to send · Esc to close
          </span>
          <GroundingScopeChip value={scope} onChange={setScope} />
        </div>
      );
    }
    return (
      <LocaleProvider>
        <div style={{ padding: 24 }}>
          <Row />
        </div>
      </LocaleProvider>
    );
  },
};
