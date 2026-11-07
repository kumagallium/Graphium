// モデルの割り当て枠の下に出す「モデルの目安」（向く大きさの区分）。
//
// 設定画面で「どのモデルを選べばよいか」を、測った結果から 1 行で示す。
// 個別のモデル名は出さず、大きさの区分（上位のクラウド／オープンな大型／このパソコンの 30B 級・10B 級）
// ごとに、向く・条件つき・向かないの 3 段で並べる。色だけに頼らず記号（✓ △ ×）も付ける。
// 区分の説明はチップの title、測り方と数字は「測った結果」のリンク先（検証の記録）にある。

import { Check, ExternalLink, Minus, X } from "lucide-react";
import { useLocale } from "../../i18n";
import { openExternalUrl } from "../../lib/external-link";
import { MODEL_CLASSES, MODEL_FIT, modelFitEvaluationUrl, type FitLevel, type ModelSlot } from "./model-fit";

const LEVEL_STYLE: Record<FitLevel, string> = {
  good: "bg-success-bg text-success border-success-border",
  partial: "bg-warning-bg text-warning border-warning-border",
  // 向かないは目立たせない（選ぶ人を責めない）。色に頼らず × と破線の枠で示す
  poor: "bg-background text-muted-foreground border-border border-dashed",
};

const LEVEL_ICON = { good: Check, partial: Minus, poor: X } as const;

export type ModelFitHintProps = {
  slot: ModelSlot;
};

export function ModelFitHint({ slot }: ModelFitHintProps) {
  const { t, locale } = useLocale();
  const fit = MODEL_FIT[slot];
  const url = modelFitEvaluationUrl(locale);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("settings.modelFit.label")}</span>
        {MODEL_CLASSES.map((cls) => {
          const level = fit[cls];
          const Icon = LEVEL_ICON[level];
          return (
            <span
              key={cls}
              title={`${t(`settings.modelFit.class.${cls}.help`)} — ${t(`settings.modelFit.level.${level}`)}`}
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] ${LEVEL_STYLE[level]}`}
            >
              <Icon size={10} aria-hidden="true" />
              <span>{t(`settings.modelFit.class.${cls}`)}</span>
              <span className="sr-only">: {t(`settings.modelFit.level.${level}`)}</span>
            </span>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t(`settings.modelFit.note.${slot}`)}{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            // デスクトップ版の WebView は target=_blank を開かないので、既定の外部リンクの開き方に任せる
            e.preventDefault();
            void openExternalUrl(url);
          }}
          className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
        >
          {t("settings.modelFit.link")}
          <ExternalLink size={10} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
