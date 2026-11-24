// 受け取り待ちの 1 件の中身（見た目・名前・大きさ・どこから・元の場所・ノートに貼るか）。
// 画面の隅の知らせ（MaterialOfferNoticeView）と、取り込み画面の「届いたもの」
// （MaterialOfferSection）で同じものを使う。
//
// 元の場所は必ず見せる。中身に仕込まれた指示で、利用者が添付していないファイルが
// 申し出られることがありうるので、どこから来たか分からないまま承認させない。

import { File, FileText, Image as ImageIcon } from "lucide-react";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import type { MaterialOffer } from "./types";

/** ホームフォルダを ~ に縮め、長ければ最後の 2 段だけ残す（全体は吹き出しで見せる） */
export function shortenSourcePath(path: string, maxChars = 44): string {
  const home = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
  if (home.length <= maxChars) return home;
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  const parts = home.split(sep).filter(Boolean);
  if (parts.length <= 2) return home;
  return `…${sep}${parts.slice(-2).join(sep)}`;
}

function KindIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon size={18} />;
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) return <FileText size={18} />;
  return <File size={18} />;
}

type MaterialOfferItemProps = {
  offer: MaterialOffer;
  pasteToNote: boolean;
  onPasteToNoteChange: (value: boolean) => void;
  disabled?: boolean;
};

export function MaterialOfferItem({ offer, pasteToNote, onPasteToNoteChange, disabled }: MaterialOfferItemProps) {
  const t = useT();
  const checkboxId = `material-offer-paste-${offer.id}`;
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="size-10 shrink-0 rounded-md border border-border-subtle bg-muted/50 overflow-hidden flex items-center justify-center text-muted-foreground">
        {offer.previewUrl ? (
          <img src={offer.previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <KindIcon mimeType={offer.mimeType} />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="text-foreground font-medium [overflow-wrap:anywhere]">{offer.name}</div>
        <div className="text-muted-foreground">
          {t("materialOffer.meta", { size: formatBytes(offer.size), client: offer.client })}
        </div>
        <div
          className="text-muted-foreground/80 font-mono text-[11px] truncate"
          data-tooltip={offer.sourcePath}
          data-testid="material-offer-source"
        >
          {t("materialOffer.source", { path: shortenSourcePath(offer.sourcePath) })}
        </div>
        {offer.noteTitle && (
          <label htmlFor={checkboxId} className="mt-1 flex items-start gap-1.5 text-foreground cursor-pointer">
            <input
              id={checkboxId}
              type="checkbox"
              className="accent-primary mt-0.5 shrink-0"
              checked={pasteToNote}
              disabled={disabled}
              onChange={(e) => onPasteToNoteChange(e.target.checked)}
            />
            <span className="min-w-0 line-clamp-2 [overflow-wrap:anywhere]">{t("materialOffer.pasteToNote", { title: offer.noteTitle })}</span>
          </label>
        )}
      </div>
    </div>
  );
}
