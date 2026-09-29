// 倍率を変えたときに出す短い表示（右下ピル）。
//
// 完了トーストの型に合わせる: 数秒で消え、操作ボタンは載せない（design.md）。
// 100% 以外のときだけ、戻し方を続けて添える。出し入れと時間は UiZoomOverlays が持つ。

import { ZoomIn } from "lucide-react";
import { useT } from "../../i18n";
import { formatZoomPercent, zoomShortcutParams } from "./format";

export function ZoomToast({ level, visible }: { level: number; visible: boolean }) {
  const t = useT();
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-popover shadow-lg pl-3 pr-3.5 py-1.5 text-xs transition-all duration-300"
      role="status"
    >
      <ZoomIn size={13} className="text-muted-foreground shrink-0" />
      <span className="text-foreground font-semibold tabular-nums">{formatZoomPercent(level)}</span>
      {level !== 1 && (
        <span className="text-muted-foreground">
          {t("zoom.toast.reset", { shortcut: zoomShortcutParams().reset })}
        </span>
      )}
    </div>
  );
}
