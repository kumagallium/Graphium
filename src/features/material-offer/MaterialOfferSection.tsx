// 取り込みの画面の「届いたもの」区画。外の AI から届いて、まだ選んでいない申し出の一覧。
//
// 隅の知らせを「あとで」で閉じた分や、知らせに出し切れなかった分をここで選ぶ。
// 待っているものが無ければ何も出さない（区画ごと消える）。

import { Inbox, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { MaterialOfferItem } from "./MaterialOfferItem";
import type { MaterialOffer } from "./types";

export type MaterialOfferSectionProps = {
  offers: MaterialOffer[];
  pasteToNote: Record<string, boolean>;
  onPasteToNoteChange: (id: string, value: boolean) => void;
  /** 処理中の申し出の id（"all" はまとめて取り込み中） */
  busy: string | null;
  onAccept: (offer: MaterialOffer) => void;
  onDecline: (offer: MaterialOffer) => void;
  onAcceptAll: () => void;
  /** 承認されないまま消えるまでの日数（説明の文に出す） */
  expireDays: number;
};

export function MaterialOfferSection({
  offers,
  pasteToNote,
  onPasteToNoteChange,
  busy,
  onAccept,
  onDecline,
  onAcceptAll,
  expireDays,
}: MaterialOfferSectionProps) {
  const t = useT();
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="material-offer-heading" className="flex flex-col gap-2" data-testid="material-offer-section">
      <div className="flex items-center gap-2">
        <Inbox size={14} className="text-primary shrink-0" />
        <h3 id="material-offer-heading" className="flex-1 min-w-0 text-sm font-medium text-foreground">
          {t("materialOffer.section.title", { count: String(offers.length) })}
        </h3>
        {offers.length >= 2 && (
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={busy !== null}
            className="px-2.5 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {busy === "all" && <Loader2 size={12} className="animate-spin" />}
            {t("materialOffer.acceptAll", { count: String(offers.length) })}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("materialOffer.section.rule", { days: String(expireDays) })}
      </p>
      <ul className="rounded-lg border border-border divide-y divide-border">
        {offers.map((offer) => {
          const running = busy === offer.id || busy === "all";
          return (
            <li key={offer.id} className="p-3 text-xs flex items-start gap-3" data-testid="material-offer-row">
              <div className="flex-1 min-w-0">
                <MaterialOfferItem
                  offer={offer}
                  pasteToNote={pasteToNote[offer.id] ?? Boolean(offer.noteTitle)}
                  onPasteToNoteChange={(v) => onPasteToNoteChange(offer.id, v)}
                  disabled={running}
                />
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
