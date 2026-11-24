// 外の AI から素材が届いたことを画面の右下で知らせ、その場で取り込むか断るかを選んでもらう。
//
// 見た目は「外のアプリで編集された素材」の知らせ（OpenedCopyNotice）にそろえる。
// 自動では消さない（承認が要る知らせなので、見落とすと一時ファイル由来の申し出が溜まる）。
// × は「あとで」— 隅からは消えるが、受け取り待ちには残り、取り込みの画面から選べる。
// カードは 2 枚まで。それより多いときは残りの件数と「取り込みを開く」だけを出す（まとめて取り込むのは
// 取り込みの画面で、全件が見えているときだけ。隅で押すと、見ていない 3 件目以降まで入ってしまう）。

import { Check, Inbox, Loader2, X } from "lucide-react";
import { useT } from "@/i18n";
import { MaterialOfferItem } from "./MaterialOfferItem";
import type { MaterialOffer } from "./types";

/** 隅に並べるカードの上限 */
export const NOTICE_MAX_CARDS = 2;

export type MaterialOfferResult =
  | { kind: "added"; name: string; noteTitle?: string }
  | { kind: "addedMany"; count: number }
  | { kind: "duplicate"; name: string }
  | { kind: "declined"; name: string }
  | { kind: "failed"; name: string };

export type MaterialOfferNoticeViewProps = {
  offers: MaterialOffer[];
  /** id → ノートに貼るか（既定はノートがあれば貼る） */
  pasteToNote: Record<string, boolean>;
  onPasteToNoteChange: (id: string, value: boolean) => void;
  /** 処理中の申し出の id（"all" はまとめて取り込み中） */
  busy: string | null;
  result: MaterialOfferResult | null;
  onAccept: (offer: MaterialOffer) => void;
  onDecline: (offer: MaterialOffer) => void;
  onLater: (offer: MaterialOffer) => void;
  onOpenIntake: () => void;
};

export function MaterialOfferNoticeView({
  offers,
  pasteToNote,
  onPasteToNoteChange,
  busy,
  result,
  onAccept,
  onDecline,
  onLater,
  onOpenIntake,
}: MaterialOfferNoticeViewProps) {
  const t = useT();
  const shown = offers.slice(0, NOTICE_MAX_CARDS);
  const rest = offers.length - shown.length;
  if (shown.length === 0 && !result) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-[360px] max-w-[calc(100vw-2rem)] flex flex-col gap-2">
      {shown.map((offer) => {
        const running = busy === offer.id || busy === "all";
        return (
          <div
            key={offer.id}
            role="status"
            data-testid="material-offer-card"
            className="rounded-lg border border-border bg-popover shadow-lg p-3 text-xs flex flex-col gap-2.5"
          >
            <div className="flex items-center gap-1.5">
              <Inbox size={14} className="text-primary shrink-0" />
              <span className="flex-1 min-w-0 text-foreground font-medium">
                {t("materialOffer.arrived", { client: offer.client })}
              </span>
              <button
                type="button"
                onClick={() => onLater(offer)}
                disabled={running}
                aria-label={t("materialOffer.later")}
                data-tooltip={t("materialOffer.laterTooltip")}
                className="p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            <MaterialOfferItem
              offer={offer}
              pasteToNote={pasteToNote[offer.id] ?? Boolean(offer.noteTitle)}
              onPasteToNoteChange={(v) => onPasteToNoteChange(offer.id, v)}
              disabled={running}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onDecline(offer)}
                disabled={running}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                {t("materialOffer.decline")}
              </button>
              <button
                type="button"
                onClick={() => onAccept(offer)}
                disabled={running}
                className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {running && <Loader2 size={12} className="animate-spin" />}
                {t("materialOffer.accept")}
              </button>
            </div>
          </div>
        );
      })}
      {rest > 0 && (
        <div
          role="status"
          data-testid="material-offer-more"
          className="rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs flex flex-col gap-1.5"
        >
          <span className="text-muted-foreground">{t("materialOffer.more", { count: String(rest) })}</span>
          <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onOpenIntake}
            className="px-2.5 py-1 rounded-md border border-border text-foreground hover:bg-muted"
          >
            {t("materialOffer.openIntake")}
          </button>
          </div>
        </div>
      )}
      {result && (
        <div
          role="status"
          className={`rounded-full border shadow-lg px-3.5 py-1.5 text-xs self-end flex items-center gap-1.5 ${
            result.kind === "failed"
              ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
              : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
          }`}
        >
          {result.kind !== "failed" && <Check size={13} className="text-emerald-600 shrink-0" />}
          <span className="text-foreground">{resultText(result, t)}</span>
        </div>
      )}
    </div>
  );
}

function resultText(result: MaterialOfferResult, t: ReturnType<typeof useT>): string {
  switch (result.kind) {
    case "added":
      return result.noteTitle
        ? t("materialOffer.result.addedToNote", { name: result.name, title: result.noteTitle })
        : t("materialOffer.result.added", { name: result.name });
    case "addedMany":
      return t("materialOffer.result.addedMany", { count: String(result.count) });
    case "duplicate":
      return t("materialOffer.result.duplicate", { name: result.name });
    case "declined":
      return t("materialOffer.result.declined", { name: result.name });
    case "failed":
      return t("materialOffer.result.failed", { name: result.name });
  }
}
