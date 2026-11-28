// 新しい版が入ったことを知らせる帯（スマホの捕獲ホームのヘッダー直下）。
//
// ホーム画面に追加したアプリは裏で生き続けるので、新しい版が取り込まれても
// 画面は古いコードのまま残る。ここで知らせて、利用者のタップで読み込み直す。
// 勝手には読み込み直さない（入力中のメモを消さないため）。

import { RefreshCw } from "lucide-react";
import { useLocale } from "../../i18n";

export type UpdateReadyBannerProps = {
  onReload: () => void;
};

export function UpdateReadyBanner({ onReload }: UpdateReadyBannerProps) {
  const { t } = useLocale();
  return (
    <div
      role="status"
      data-testid="update-ready-banner"
      className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-primary/10 text-xs"
    >
      <span className="text-foreground min-w-0">{t("mobile.update.ready")}</span>
      <button
        onClick={onReload}
        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground font-medium active:opacity-80 transition-opacity"
      >
        <RefreshCw size={12} />
        {t("mobile.update.reload")}
      </button>
    </div>
  );
}
