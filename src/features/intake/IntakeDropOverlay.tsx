// 全画面ドロップ案内
//
// ウィンドウのどこかにファイルをドラッグしている間だけ、画面全体に「ここに
// 落とせば入る」ことを知らせる。イベントは一切奪わない（pointer-events: none）。
// ドロップの実際の受け取りは useGlobalFileDrop 側が window の drop で行う。

import { createPortal } from "react-dom";
import { FolderInput } from "lucide-react";
import { useT } from "@/i18n";

type IntakeDropOverlayProps = {
  visible: boolean;
};

export function IntakeDropOverlay({ visible }: IntakeDropOverlayProps) {
  const t = useT();
  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] pointer-events-none">
      <div className="absolute inset-3 rounded-xl border-2 border-dashed border-primary bg-accent/40" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="rounded-xl bg-background border border-border shadow-lg px-6 py-5 flex flex-col items-center gap-2 text-center">
          <FolderInput size={28} className="text-primary" />
          <p className="text-sm font-medium">{t("intake.dropOverlay")}</p>
          <p className="text-xs text-muted-foreground">{t("intake.rule")}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
