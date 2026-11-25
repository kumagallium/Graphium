// モデルの割り当て（案）: 登録したモデルが 1 つのときの短い表示。Storybook だけで見せる部品で、アプリにはまだ組み込まない。
//
// 今の割り当ては「軽い処理・標準の処理・高度な処理」の 3 段に、選ぶ欄・モデルの目安・注意書きが付く。
// モデルが 1 つしかない人には 3 つの欄の答えがどれも同じで、意味のない選択肢を 3 つ見せている。
//
// 守ること:
// - 隠さない。「3 段とも ○○ を使います」と事実を 1 行で見せる（#947 で割り当てを束に畳んだら、
//   最小限で使いたい人がモデルを選べなくなった。その反省で、選ぶものがあるときは今の 3 段を出す）
// - 段のスイッチは残す。モデルが 1 つでも、手元のモデルで重い仕事が難しいときに止める意味がある
// - 「段ごとのくわしい設定」で今の 3 段（目安つき）へ 1 押しで行ける
// - モデルの目安の注意は消さない。どの大きさのモデルかはアプリに分からないので、
//   「このモデルだと」とは言わず、測った結果（model-fit.ts）のとおりの一般の注意を 1 行出す
//   （標準・高度の段は上位のクラウドだけが「向く」。オープンな大型は条件つき、ローカルは条件つきか向かない）
//
// 見た目だけの部品。状態は持たない。

import { AlertTriangle } from "lucide-react";
import { useLocale } from "../../i18n";
import { openExternalUrl } from "../../lib/external-link";
import { modelFitEvaluationUrl } from "./model-fit";
import { SETTINGS_CARD_CLASS } from "./SettingsGroup";
import { SwitchButton } from "./SettingToggle";

export type AssignmentOneModelViewProps = {
  /** 登録している唯一のモデルの表示名 */
  modelName: string;
  standardOn: boolean;
  preciseOn: boolean;
  onToggleStandard: () => void;
  onTogglePrecise: () => void;
  /** 今の 3 段の表示へ */
  onShowTiers: () => void;
};

export function AssignmentOneModelView({
  modelName,
  standardOn,
  preciseOn,
  onToggleStandard,
  onTogglePrecise,
  onShowTiers,
}: AssignmentOneModelViewProps) {
  const { t, locale } = useLocale();
  const fitUrl = modelFitEvaluationUrl(locale);
  const rows = [
    { key: "standard", on: standardOn, onChange: onToggleStandard, label: t("settings.tier.useStandard"), uses: t("settings.assignOneModel.standardUses") },
    { key: "precise", on: preciseOn, onChange: onTogglePrecise, label: t("settings.tier.usePrecise"), uses: t("settings.assignOneModel.preciseUses") },
  ];

  return (
    <div className={`${SETTINGS_CARD_CLASS} space-y-3 p-3 text-left`}>
      <div>
        <p className="text-xs text-foreground">
          {t("settings.assignOneModel.allTiers", { name: modelName })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.assignOneModel.why")}</p>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2">
            <SwitchButton checked={r.on} onChange={r.onChange} label={r.label} />
            <div className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{r.label}</span>
              <span className="block text-xs text-muted-foreground">
                {r.on ? r.uses : t("settings.assignOneModel.off")}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* 重い段を使うときだけ出す（両方止めていれば、気をつけることが無い） */}
      {(standardOn || preciseOn) && (
        <p className="flex items-start gap-1 text-xs text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t("settings.assignOneModel.fitCaution")}{" "}
            <a
              href={fitUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                // デスクトップ版の WebView は target=_blank を開かないので、既定の外部リンクの開き方に任せる
                e.preventDefault();
                void openExternalUrl(fitUrl);
              }}
              className="underline underline-offset-2"
            >
              {t("settings.assignOneModel.fitLink")}
            </a>
          </span>
        </p>
      )}

      <button type="button" onClick={onShowTiers} className="text-xs text-primary underline-offset-2 hover:underline">
        {t("settings.assignOneModel.showTiers")} →
      </button>
    </div>
  );
}
