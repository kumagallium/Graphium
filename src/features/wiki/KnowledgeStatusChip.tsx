// 通常ノートが Knowledge 化済みかを示すチップ。
// - 未化: 「Add to Knowledge」を促すアウトラインバッジボタン
// - 化済 (1 件以上): 派生 wiki エントリへ飛ぶ「In Knowledge」バッジ
//
// note ヘッダーと side peek の両方から使われる。

import { BookOpen, BookPlus } from "lucide-react";
import type { NoteIndexEntry } from "../navigation";
import { useT } from "../../i18n";

type Props = {
  /** このノートを派生元として参照する wiki エントリ。0 件なら未化扱い */
  wikiEntries: NoteIndexEntry[];
  /** 未化のときに「Add to Knowledge」ボタンを押すと呼ばれる。undefined なら未化チップは表示しない */
  onAdd?: () => void;
  /** 化済チップ押下時に対応 wiki ノートを開く。複数あれば最新（先頭）を開く */
  onOpen?: (wikiNoteId: string) => void;
  /** ボタンの disable 状態（ingest 進行中など） */
  disabled?: boolean;
  className?: string;
};

export function KnowledgeStatusChip({ wikiEntries, onAdd, onOpen, disabled, className }: Props) {
  const t = useT();

  if (wikiEntries.length > 0) {
    const target = wikiEntries[0];
    const label = wikiEntries.length === 1
      ? t("knowledge.inKnowledge")
      : t("knowledge.inKnowledgeCount", { count: String(wikiEntries.length) });
    return (
      <button
        type="button"
        onClick={() => onOpen?.(`wiki:${target.noteId}`)}
        disabled={!onOpen || disabled}
        title={t("knowledge.openInKnowledge")}
        className={`inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold transition-colors hover:bg-primary/20 disabled:opacity-60 disabled:cursor-default ${className ?? ""}`}
      >
        <BookOpen size={12} />
        {label}
      </button>
    );
  }

  if (!onAdd) return null;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      title={t("knowledge.addToKnowledge")}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-transparent text-muted-foreground px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-default ${className ?? ""}`}
    >
      <BookPlus size={12} />
      {t("knowledge.addToKnowledge")}
    </button>
  );
}
