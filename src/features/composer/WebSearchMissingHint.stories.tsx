// WebSearchMissingHint のビジュアル確認用ストーリー。
// 外部参照（external）選択時に Web 検索手段（サブスクモデル/検索 MCP）が無い構成で
// チャット入力の直上（panel）/ チップ行の下（Composer）へ出す警告バナー。
// 単体・× 付き・チップと組み合わせた実配置を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider } from "@/i18n";
import { WebSearchMissingHint } from "./WebSearchMissingHint";
import { GroundingScopeChip } from "./GroundingScopeChip";
import type { GroundingScope } from "../../lib/grounding-scope";

const meta: Meta<typeof WebSearchMissingHint> = {
  title: "Atoms/WebSearchMissingHint",
  component: WebSearchMissingHint,
  parameters: {
    docs: {
      description: {
        component:
          "外部参照を選んだのに Web 検索手段が無い構成への警告バナー。「使えない」ではなく「Web を見ずに回答する」劣化の告知なので、no-models バナーより軽く、× で閉じられる（onDismiss は呼び出し側が state 管理）。表示判定は use-web-search-availability.ts（サブスクモデル or 検索系 MCP の heuristic）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof WebSearchMissingHint>;

/** 単体。--color-warning 系のバナー + 設定リンク（× なし）。 */
export const Default: Story = {
  render: () => (
    <LocaleProvider>
      <div style={{ padding: 24, maxWidth: 420, background: "var(--paper)" }}>
        <WebSearchMissingHint />
      </div>
    </LocaleProvider>
  ),
};

/** × 付き（チャットパネルの実配置と同じ）。閉じると消え、リセットで戻せる。 */
export const Dismissible: Story = {
  render: () => {
    function Demo() {
      const [dismissed, setDismissed] = useState(false);
      return (
        <div style={{ padding: 24, maxWidth: 420, background: "var(--paper)" }}>
          {dismissed ? (
            <button
              type="button"
              onClick={() => setDismissed(false)}
              style={{ fontSize: 11, color: "var(--ink-4)" }}
            >
              閉じた（クリックでリセット）
            </button>
          ) : (
            <WebSearchMissingHint onDismiss={() => setDismissed(true)} />
          )}
        </div>
      );
    }
    return (
      <LocaleProvider>
        <Demo />
      </LocaleProvider>
    );
  },
};

/** GroundingScopeChip と組み合わせた実配置（external 選択時のみ表示）。 */
export const WithScopeChip: Story = {
  render: () => {
    function Combo() {
      const [scope, setScope] = useState<GroundingScope>("external");
      return (
        <div
          style={{
            width: 420,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "flex-end",
            background: "var(--paper)",
          }}
        >
          <GroundingScopeChip value={scope} onChange={setScope} />
          {scope === "external" && (
            <div style={{ alignSelf: "stretch" }}>
              <WebSearchMissingHint />
            </div>
          )}
        </div>
      );
    }
    return (
      <LocaleProvider>
        <Combo />
      </LocaleProvider>
    );
  },
};
