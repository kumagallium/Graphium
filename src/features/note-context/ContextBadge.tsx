// 文脈ラベル（noteContexts）表示用のバッジ。
// PROV ブロックラベルのバッジ（NoteListView の LABEL_HEX ゴーストスタイル）と同じトンマナ
// （淡い背景 + 濃いテキスト + 薄ボーダー）だが、色は名前ハッシュ由来の HSL で別パレットにし、
// 自動抽出ラベルと人手の文脈が視覚的に混同しないようにする。

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { noteContextHue } from "./context-tags";
import { useT } from "../../i18n";

export function ContextBadge({
  value,
  onRemove,
  removeLabel,
  className,
}: {
  value: string;
  /** 指定すると末尾に削除ボタン（×）を表示する */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const t = useT();
  const h = noteContextHue(value);
  // ライト/ダーク両対応: 中間トーンの色を基準に、背景=低アルファ、境界=中アルファ。
  // PROV バッジ（固定 hex + 不透明度）と同じ「淡背景に濃文字」の構造を HSL で再現する。
  const base = `hsl(${h} 45% 45%)`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium rounded-full whitespace-nowrap align-middle",
        className,
      )}
      style={{
        padding: onRemove ? "0px 3px 0px 8px" : "0px 8px",
        backgroundColor: `hsl(${h} 45% 45% / 0.12)`,
        color: base,
        border: `1px solid hsl(${h} 45% 45% / 0.30)`,
        lineHeight: 1.7,
      }}
    >
      <span className="truncate max-w-[140px]">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={removeLabel ?? t("nav.removeContextValue", { value })}
          title={removeLabel ?? t("nav.removeContextValue", { value })}
          className="inline-flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
          style={{ color: base }}
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
