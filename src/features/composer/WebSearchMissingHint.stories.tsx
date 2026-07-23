// WebSearchMissingHint のビジュアル確認用ストーリー。
// 外部参照（external）選択時に Web 検索手段（サブスクモデル/検索 MCP）が無い構成で
// GroundingScopeChip の下へ出す警告行。単体と、チップと組み合わせた実配置を確認する。

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
          "外部参照を選んだのに Web 検索手段が無い構成への警告行。「使えない」ではなく「Web を見ずに回答する」劣化の告知なので、バナーより軽い 1 行 + 設定（AI タブ）への導線に留める。表示判定は use-web-search-availability.ts（サブスクモデル or 検索系 MCP の heuristic）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof WebSearchMissingHint>;

/** 単体。--color-warning の控えめな 1 行警告 + 設定リンク。 */
export const Default: Story = {
  render: () => (
    <LocaleProvider>
      <div style={{ padding: 24, maxWidth: 420, background: "var(--paper)" }}>
        <WebSearchMissingHint />
      </div>
    </LocaleProvider>
  ),
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
