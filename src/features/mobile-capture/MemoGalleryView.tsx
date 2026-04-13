// PC 向けメモギャラリービュー
// サイドバーの「メモ」クリックで表示。カード一覧 + エディタへの挿入機能

import { useCallback, useState } from "react";
import { StickyNote, Trash2, ClipboardCopy } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";

function MemoCard({
  entry,
  onInsert,
  onDelete,
}: {
  entry: CaptureEntry;
  onInsert?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  return (
    <div className="bg-card border border-border rounded-lg p-4 group hover:border-primary/30 transition-colors">
      {/* テキスト */}
      <p className="text-sm text-foreground whitespace-pre-wrap mb-2">
        {entry.text}
      </p>

      {/* メタ情報 + アクション */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(entry.createdAt)}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onInsert && (
            <button
              onClick={onInsert}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title={t("memo.insert")}
            >
              <ClipboardCopy size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MemoGalleryView({
  captureIndex,
  loading,
  onBack,
  onInsertMemo,
  onDeleteMemo,
}: {
  captureIndex: CaptureIndex | null;
  loading: boolean;
  onBack: () => void;
  onInsertMemo?: (text: string) => void;
  onDeleteMemo?: (captureId: string) => void;
}) {
  const t = useT();
  const captures = captureIndex?.captures ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.back")}
        </button>
        <h1 className="text-base font-semibold text-foreground">{t("memo.title")}</h1>
        <span className="text-xs text-muted-foreground">
          {loading ? t("common.loading") : t("memo.count", { count: String(captures.length) })}
        </span>
      </div>

      {/* カード一覧 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : captures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("memo.emptyDesktop")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
            {captures.map((entry) => (
              <MemoCard
                key={entry.id}
                entry={entry}
                onInsert={onInsertMemo ? () => onInsertMemo(entry.text) : undefined}
                onDelete={onDeleteMemo ? () => onDeleteMemo(entry.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
