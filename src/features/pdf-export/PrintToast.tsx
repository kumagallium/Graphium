// 印刷の準備が長引いたときだけ出すトースト。
//
// 準備（画像の読み込み待ち・PROV グラフの描画）はたいてい一瞬で終わり、すぐ
// 印刷パネルが出る。ただし画像の多いノートでは待たされることがあり、その間
// メニューの中の「準備中...」は開き直さないと見えない。気づかないまま固まった
// と思われないよう、遅いときだけ OcrToast と同じ右下ピルで知らせる。

import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";

export function PrintToast({ visible }: { visible: boolean }) {
  const t = useT();
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-popover shadow-lg pl-3 pr-3.5 py-1.5 text-xs transition-all duration-300"
      role="status"
    >
      <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />
      <span className="text-foreground">{t("pdf.preparing")}</span>
    </div>
  );
}
