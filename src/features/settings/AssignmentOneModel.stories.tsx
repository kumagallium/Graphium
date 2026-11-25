// モデルの割り当て（案）: 登録したモデルが 1 つのときの短い表示のストーリー。アプリにはまだ組み込まない。
// 合意を取るための見本で、今の 3 段（Molecules/ModelFitHint と同じ組み方）と並べて比べられるようにする。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AssignmentOneModelView } from "./AssignmentOneModelView";
import { ModelFitHint } from "./ModelFitHint";
import type { ModelSlot } from "./model-fit";
import { SettingSection } from "./SettingSection";
import { SETTINGS_BLOCK_BODY_CLASS, SETTINGS_BLOCK_TITLE_CLASS } from "./SettingsGroup";

const meta: Meta = {
  title: "Proposals/AssignmentOneModel",
  parameters: { layout: "padded" },
};
export default meta;

const MODEL = "研究室のサーバー";

/** 設定 → AI の「モデルの割り当て」の見出しと字下げで囲む */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl">
      <h3 className={`${SETTINGS_BLOCK_TITLE_CLASS} mb-3`}>モデルの割り当て</h3>
      <div className={`space-y-4 ${SETTINGS_BLOCK_BODY_CLASS}`}>{children}</div>
    </div>
  );
}

function Proposal({ standard = true, precise = true }: { standard?: boolean; precise?: boolean }) {
  const [s, setS] = useState(standard);
  const [p, setP] = useState(precise);
  const [tiers, setTiers] = useState(false);
  return (
    <Frame>
      {tiers ? (
        <>
          <Current />
          <button type="button" onClick={() => setTiers(false)} className="text-xs text-muted-foreground hover:text-foreground">
            ← 短い表示に戻す（見本用）
          </button>
        </>
      ) : (
        <AssignmentOneModelView
          modelName={MODEL}
          standardOn={s}
          preciseOn={p}
          onToggleStandard={() => setS((v) => !v)}
          onTogglePrecise={() => setP((v) => !v)}
          onShowTiers={() => setTiers(true)}
        />
      )}
    </Frame>
  );
}

type Row = { slot: ModelSlot; title: string; summary: string; empty: string };
const TIERS: Row[] = [
  { slot: "default", title: "軽い処理のモデル", summary: "軽い処理（チャット・点検・出典照合・題付け）に使います。ほかの段を空欄にすれば、すべてこのモデルで動きます", empty: `サーバーデフォルト (${MODEL})` },
  { slot: "standard", title: "標準の処理のモデル", summary: "ナレッジ化・トピックの整理・手順の抽出に使います。空欄なら軽い処理のモデル", empty: "軽い処理のモデルと同じ" },
  { slot: "precise", title: "高度な処理のモデル", summary: "翻訳・計画・洞察・清書に使います。空欄なら標準の処理のモデル", empty: "標準の処理のモデルと同じ" },
];

/** 今の 3 段（モデルが 1 つのとき。どの欄も選べるのは同じ 1 つ） */
function Current() {
  return (
    <>
      {TIERS.map((r) => (
        <SettingSection key={r.slot} title={r.title} summary={r.summary} details={<p>（くわしく）</p>}>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
              defaultValue=""
              aria-label={r.title}
            >
              <option value="">{r.empty}</option>
              <option>{MODEL}</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          <ModelFitHint slot={r.slot} />
        </SettingSection>
      ))}
    </>
  );
}

/** 案: モデルが 1 つのときは「3 段とも ○○ を使います」の 1 行と、段のスイッチだけ */
export const OneModel: StoryObj = { render: () => <Proposal /> };

/** 案: 高度な処理を止めたところ（手元のモデルで重い仕事が難しいとき） */
export const OneModelPreciseOff: StoryObj = { render: () => <Proposal precise={false} /> };

/** 比べる用: 今の 3 段（モデルが 1 つのとき） */
export const CurrentThreeTiers: StoryObj = {
  render: () => (
    <Frame>
      <Current />
    </Frame>
  ),
};
