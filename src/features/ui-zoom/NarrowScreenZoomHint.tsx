// 画面が狭い環境でだけ、一度だけ出す拡大縮小の案内（右下の小さなカード）。
//
// 拡大縮小できることに気づかない人向け。何も探さない人に届く唯一の経路なので、
// 数秒で消える通知にはしない（集中している最中に出ても目に入らないため。design.md の
// 範囲選択の案内と同じ判断）。× か、ボタンを押すまで出ておく。
// 出す条件・記録は notice.ts、出し入れは UiZoomOverlays が持つ。

import { X } from "lucide-react";
import { Button } from "@ui/button";
import { useT } from "../../i18n";
import { formatZoomPercent } from "./format";
import { ZOOM_HINT_APPLY_LEVEL } from "./notice";
import { ZoomKeys } from "./ZoomKeys";

export function NarrowScreenZoomHint({
  isDesktop,
  onDismiss,
  onApply,
  mac,
}: {
  /** デスクトップアプリか（ブラウザ版は「ブラウザの拡大縮小です」を添え、ボタンは「閉じる」だけ） */
  isDesktop: boolean;
  /** × / 「閉じる」 */
  onDismiss: () => void;
  /** 「90% にしてみる」（デスクトップのみ） */
  onApply?: () => void;
  /** キーキャップの OS 表記の差し替え（Storybook 用。省略で OS から判定） */
  mac?: boolean;
}) {
  const t = useT();

  return (
    // トーストより 1 段下の z（同じ角に重なったときはトーストが上）
    <div
      className="fixed bottom-4 right-4 z-[9998] w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover shadow-lg p-4 space-y-3"
      role="region"
      aria-label={t("zoom.hint.title")}
    >
      <div className="flex items-start gap-2">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-foreground">
          {t("zoom.hint.title")}
        </h3>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.close")}
          className="-mt-1 -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("zoom.hint.body")}
        {!isDesktop && t("zoom.hint.bodyBrowser")}
      </p>

      <ZoomKeys mac={mac} />

      {isDesktop && <p className="text-xs text-muted-foreground">{t("zoom.hint.settings")}</p>}

      <div className="flex justify-end">
        {isDesktop && onApply ? (
          <Button size="sm" onClick={onApply}>
            {t("zoom.hint.apply", { percent: formatZoomPercent(ZOOM_HINT_APPLY_LEVEL) })}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onDismiss}>
            {t("common.close")}
          </Button>
        )}
      </div>
    </div>
  );
}
