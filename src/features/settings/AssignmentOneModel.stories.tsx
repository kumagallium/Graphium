// モデルの割り当て: 登録したモデルが 1 つのときの短い表示と、説明を用途だけにした 3 段のストーリー。
// 組み込む前の 3 段（CurrentThreeTiers・TwoOrMoreModels）と並べて比べられるようにしてある。
// 短い表示にするのは「モデルが 1 つ」かつ「段ごとのモデルをまだ選んでいない」ときだけ。それ以外は今の 3 段のまま。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AssignmentOneModelView } from "./AssignmentOneModelView";
import { ModelFitHint } from "./ModelFitHint";
import type { ModelSlot } from "./model-fit";
import { SettingSection } from "./SettingSection";
import { useLocale } from "../../i18n";
import { modelFitEvaluationUrl } from "./model-fit";
import { SETTINGS_BLOCK_BODY_CLASS, SETTINGS_BLOCK_TITLE_CLASS } from "./SettingsGroup";

const meta: Meta = {
  title: "Molecules/AssignmentOneModel",
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
function Current({ extra = [] }: { extra?: string[] }) {
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
              {extra.map((m) => <option key={m}>{m}</option>)}
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

/** モデルが 2 つ以上のとき: 段ごとに選ぶものがあるので、案でも今の 3 段のまま出す */
export const TwoOrMoreModels: StoryObj = {
  render: () => (
    <Frame>
      <Current extra={["claude-opus-5"]} />
    </Frame>
  ),
};

/** 案: 説明は用途だけ（「空欄なら〜」は選ぶ欄に出ているので消す）。目安の注記は「くわしく」の中へ。
 *  札（✓ − ×）は残し、「測った結果」のリンクは最後に 1 つだけ */
function Trimmed({ extra = [] }: { extra?: string[] }) {
  const { t, locale } = useLocale();
  const url = modelFitEvaluationUrl(locale);
  const rows: { slot: ModelSlot; title: string; uses: string; help: string; empty: string }[] = [
    { slot: "default", title: t("settings.model"), uses: t("settings.assignTrim.uses.default"), help: t("settings.modelHelp"), empty: `サーバーデフォルト (${MODEL})` },
    { slot: "standard", title: t("settings.standardModel"), uses: t("settings.assignTrim.uses.standard"), help: t("settings.standardModelHelp"), empty: t("settings.standardModelSameAsDefault") },
    { slot: "precise", title: t("settings.preciseModel"), uses: t("settings.assignTrim.uses.precise"), help: t("settings.preciseModelHelp"), empty: t("settings.preciseModelSameAsStandard") },
  ];
  return (
    <>
      {rows.map((r) => (
        <SettingSection
          key={r.slot}
          title={r.title}
          summary={r.uses}
          details={
            <>
              <p>{r.help}</p>
              <p className="mt-1">{t(`settings.modelFit.note.${r.slot}`)}</p>
            </>
          }
        >
          <div className="relative">
            <select
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
              defaultValue=""
              aria-label={r.title}
            >
              <option value="">{r.empty}</option>
              <option>{MODEL}</option>
              {extra.map((m) => <option key={m}>{m}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          <ModelFitHint slot={r.slot} showNote={false} />
        </SettingSection>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {t("settings.assignTrim.fitSource")}{" "}
        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {t("settings.modelFit.link")}
        </a>
      </p>
    </>
  );
}

/** 案: モデルが 2 つ以上のとき。説明を用途だけにし、注記を「くわしく」へ移した 3 段 */
export const TwoOrMoreModelsTrimmed: StoryObj = {
  render: () => (
    <Frame>
      <Trimmed extra={["claude-opus-5"]} />
    </Frame>
  ),
};

/** 比べる用: 今の 3 段（モデルが 1 つのとき） */
export const CurrentThreeTiers: StoryObj = {
  render: () => (
    <Frame>
      <Current />
    </Frame>
  ),
};
