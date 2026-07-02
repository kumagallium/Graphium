// GroundingScopeChip のビジュアル確認用ストーリー。
// 外部参照 / 内部参照 / ノート内参照 の 3 状態と、トグルの操作感を確認する。

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
          "Cmd+K Composer の grounding スコープ切り替え。外部参照（Web 検索を強制・調査向け）/ 内部参照（引用＋蓄積した知識を横断検索・着想/構成向け）/ ノート内参照（引用したものだけ・執筆/引用/検証向け）の 3 状態セグメント。",
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

/** 外部参照。Web 検索を強制して世界の知見を取り込む（調査向け）。 */
export const External: Story = {
  render: () => <Interactive initial="external" />,
};

/** 既定（内部参照）。着想・構成段階で引用＋蓄積した知識を横断検索して渡す。 */
export const Internal: Story = {
  render: () => <Interactive initial="internal" />,
};

/** ノート内参照。執筆・引用・検証段階で引用したものだけに絞って渡す。 */
export const Notes: Story = {
  render: () => <Interactive initial="notes" />,
};

/** Composer 下段（ショートカット行の右）に置いたときの並びイメージ。 */
export const InShortcutRow: Story = {
  render: () => {
    function Row() {
      const [scope, setScope] = useState<GroundingScope>("internal");
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
