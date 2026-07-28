// 従来ホーム（実験フラグ OFF）に出す実験オプトインカード。
//
// スマホからは設定モーダルの「モバイル連携」トグルを消したので（デスクトップ語彙）、
// スマホで実験に入る唯一の入口はこのカード: [試す] → ストレージ選択
// （StoragePickerSheet）→ 接続 → ホームがキュー前提に切り替わる（内部的には
// 既存の実験フラグを立てるだけ）。
//
// ×（閉じる）は意図的に付けない: フラグ OFF の間は最小設定シート（⚙）も出さない
// ため、一度 × で消すと再表示の入口が無くなる。永続 dismiss を持ち込む代わりに、
// AiUpgradeNotice の card 様式（rounded-lg + bg-muted/40）を踏襲した控えめな見た目で
// 常設の圧を下げる。実験から出た人（設定シートの「この実験をやめる」）が従来ホームに
// 戻ってきたときの再入口も、このカードがそのまま担う。

import { Smartphone } from "lucide-react";
import { useT } from "../../i18n";

export function MobileOptInCard({ onTry }: { onTry: () => void }) {
  const t = useT();

  return (
    <div
      className="rounded-lg border border-border bg-muted/40 p-3 space-y-2"
      data-testid="mobile-optin-card"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Smartphone size={14} className="text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground truncate">
          {t("mobile.optIn.title")}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
          {t("settings.mobileInboxFlag.badge")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("mobile.optIn.body")}
      </p>
      <div className="pt-0.5">
        <button
          onClick={onTry}
          className="inline-flex items-center px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium active:opacity-80 transition-opacity"
        >
          {t("mobile.optIn.try")}
        </button>
      </div>
    </div>
  );
}
