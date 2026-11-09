// ノートに紐づかないチャットの横に並べる全体グラフの枠。
//
// 見出し（題・この答えで使ったページの数・閉じる）と、中身のグラフ（children）だけを持つ。
// グラフそのもの（GlobalGraphView の compact 表示）と、使ったページの重みは呼び出し側が渡す。
// 光らせるのは答えが返ったときだけ（graph-firing の once）で、グラフ全体は動かさない。

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";

/** グラフの「使った」緑（global-graph-view の act の濃い側）に合わせた点 */
const USED_DOT = "#2f6b3a";
const EARLIER_DOT = "#a9bfad";

export function ChatGraphPane({
  latestCount,
  earlierCount,
  onClose,
  children,
}: {
  /** いちばん新しい答えで使ったページの数（グラフにあるものだけ） */
  latestCount: number;
  /** それより前の答えで使ったページの数 */
  earlierCount: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="flex flex-col h-full min-h-0" aria-label={t("standaloneChat.graphTitle")}>
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <span className="text-xs font-bold text-foreground">{t("standaloneChat.graphTitle")}</span>
        <span
          className="flex items-center gap-3 text-[11px] text-muted-foreground min-w-0"
          data-tooltip={t("standaloneChat.graphHint")}
        >
          {latestCount === 0 && earlierCount === 0 ? (
            <span className="truncate">{t("standaloneChat.graphNone")}</span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: USED_DOT }} />
                {t("standaloneChat.graphUsed", { n: String(latestCount) })}
              </span>
              {earlierCount > 0 && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: EARLIER_DOT }} />
                  {t("standaloneChat.graphUsedEarlier", { n: String(earlierCount) })}
                </span>
              )}
            </>
          )}
        </span>
        <button
          onClick={onClose}
          aria-label={t("standaloneChat.hideGraph")}
          data-tooltip={t("standaloneChat.hideGraph")}
          className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}
