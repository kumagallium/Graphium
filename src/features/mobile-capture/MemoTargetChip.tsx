// メモを書くダイアログの「付け先」チップ。
// このメモが何についてのものか（ブロック・ノート・素材）を、書く前に見せる。
// ✕ で外すと、どこにも付かないメモとして保存される（removable のとき）。
// 種類ごとのアイコン: ブロック＝¶、ノート＝書類、素材＝素材の種類のアイコン。

import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Paperclip,
  Pilcrow,
  Table2,
  Video,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useT } from "../../i18n";
import type { MediaType } from "../asset-browser/media-index";
import { formatMemoEdgeLabel } from "./memo-edge";
import type { MemoTarget } from "./memo-target";

const ASSET_ICON: Partial<Record<MediaType, LucideIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Volume2,
  pdf: FileText,
  url: LinkIcon,
  data: Table2,
};

export type MemoTargetChipProps = {
  target: MemoTarget;
  /** ✕ で外せるか。外したら onRemove が呼ばれる */
  removable?: boolean;
  onRemove?: () => void;
  /** 外している最中は触れない（送信中） */
  disabled?: boolean;
};

export function MemoTargetChip({ target, removable = false, onRemove, disabled = false }: MemoTargetChipProps) {
  const t = useT();
  if (target.kind === "none") return null;

  let Icon: LucideIcon;
  let label: string;
  if (target.kind === "block" && target.asset) {
    // 素材ブロック（画像・動画・PDF）は素材の名前と種類のアイコンで見せる
    Icon = ASSET_ICON[target.asset.type] ?? Paperclip;
    label = target.asset.name;
  } else if (target.kind === "block") {
    Icon = Pilcrow;
    label = target.blockText || t("memo.linkedBlock");
  } else if (target.kind === "note") {
    Icon = FileText;
    label = target.title || t("memoTarget.thisNote");
  } else if (target.kind === "edge") {
    Icon = ArrowRight;
    label = formatMemoEdgeLabel(target.edge);
  } else {
    Icon = ASSET_ICON[target.type] ?? Paperclip;
    label = target.name;
  }

  return (
    <div className="flex items-center gap-1.5 px-4 pt-2.5 text-xs text-muted-foreground" data-test="memoTargetChip">
      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-muted/40 py-0.5 pl-2 pr-2"
        style={removable ? { paddingRight: 4 } : undefined}
        role="group"
        aria-label={t("memoTarget.label", { name: label })}
      >
        <Icon size={12} className="shrink-0" aria-hidden />
        <span className="truncate" title={label}>
          {label}
        </span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            data-tooltip={t("memoTarget.removeName")}
            data-tooltip-usage={t("memoTarget.removeUsage")}
            aria-label={t("memoTarget.removeName")}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X size={10} aria-hidden />
          </button>
        )}
      </span>
    </div>
  );
}
