// PC 向けメモギャラリービュー
// サイドバーの「メモ」クリックで表示。カード一覧 + エディタへの挿入機能

import { useCallback, useState } from "react";
import { StickyNote, Trash2, ClipboardCopy, Check } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";

function MemoCard({
  entry,
  onInsert,
  onDelete,
  insertDisabled,
}: {
  entry: CaptureEntry;
  onInsert?: () => void;
  onDelete?: () => void;
  insertDisabled?: boolean;
}) {
  const t = useT();
  const usedCount = entry.usedIn?.length ?? 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4 group hover:border-primary/30 transition-colors">
      {/* テキスト */}
      <p className="text-sm text-foreground whitespace-pre-wrap mb-2">
        {entry.text}
      </p>

      {/* メタ情報 + アクション */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(entry.createdAt)}
          </span>
          {usedCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              {t("memo.usedCount", { count: String(usedCount) })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onInsert && (
            <button
              onClick={onInsert}
              disabled={insertDisabled}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
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

// 挿入確認ダイアログ
function InsertConfirmDialog({
  onInsertAndKeep,
  onInsertAndDelete,
  onCancel,
}: {
  onInsertAndKeep: () => void;
  onInsertAndDelete: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("memo.insertConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("memo.insertConfirmMessage")}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onInsertAndKeep}
            className="w-full px-3 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("memo.insertAndKeep")}
          </button>
          <button
            onClick={onInsertAndDelete}
            className="w-full px-3 py-2 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("memo.insertAndDelete")}
          </button>
          <button
            onClick={onCancel}
            className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
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
  insertDisabled,
}: {
  captureIndex: CaptureIndex | null;
  loading: boolean;
  onBack: () => void;
  onInsertMemo?: (captureId: string, text: string, deleteAfter: boolean) => void;
  onDeleteMemo?: (captureId: string) => void;
  /** ノートが開かれていない場合 true（挿入ボタンを無効化） */
  insertDisabled?: boolean;
}) {
  const t = useT();
  const captures = captureIndex?.captures ?? [];
  // 挿入確認ダイアログ用の state
  const [pendingInsert, setPendingInsert] = useState<{ id: string; text: string } | null>(null);

  const handleInsertAndKeep = useCallback(() => {
    if (!pendingInsert || !onInsertMemo) return;
    onInsertMemo(pendingInsert.id, pendingInsert.text, false);
    setPendingInsert(null);
  }, [pendingInsert, onInsertMemo]);

  const handleInsertAndDelete = useCallback(() => {
    if (!pendingInsert || !onInsertMemo) return;
    onInsertMemo(pendingInsert.id, pendingInsert.text, true);
    setPendingInsert(null);
  }, [pendingInsert, onInsertMemo]);

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

      {/* 挿入先のヒント */}
      {insertDisabled && captures.length > 0 && (
        <div className="px-6 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs text-muted-foreground">{t("memo.insertHint")}</p>
        </div>
      )}

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
                onInsert={onInsertMemo ? () => setPendingInsert({ id: entry.id, text: entry.text }) : undefined}
                onDelete={onDeleteMemo ? () => onDeleteMemo(entry.id) : undefined}
                insertDisabled={insertDisabled}
              />
            ))}
          </div>
        )}
      </div>

      {/* 挿入確認ダイアログ */}
      {pendingInsert && (
        <InsertConfirmDialog
          onInsertAndKeep={handleInsertAndKeep}
          onInsertAndDelete={handleInsertAndDelete}
          onCancel={() => setPendingInsert(null)}
        />
      )}
    </div>
  );
}
