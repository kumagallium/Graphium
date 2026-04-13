// モバイル専用クイックキャプチャビュー
// 付箋インデックス（.graphium-captures.json）をカード形式で表示し、素早く投稿できる

import { useCallback, useState } from "react";
import { StickyNote, Plus, Trash2 } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";
import { CaptureDialog } from "./CaptureDialog";

// 付箋カード（1枚分）
function CaptureCard({
  entry,
  onDelete,
}: {
  entry: CaptureEntry;
  onDelete?: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="relative bg-card border border-border rounded-lg p-3 transition-colors"
      onContextMenu={(e) => {
        e.preventDefault();
        setShowDelete((v) => !v);
      }}
    >
      {/* テキスト */}
      <p className="text-sm text-foreground line-clamp-4 whitespace-pre-wrap mb-1.5">
        {entry.text}
      </p>

      {/* 作成日時 */}
      <p className="text-[10px] text-muted-foreground">
        {formatRelativeTime(entry.createdAt)}
      </p>

      {/* 削除ボタン（長押しで表示） */}
      {showDelete && onDelete && (
        <button
          className="absolute top-2 right-2 p-1.5 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
            setShowDelete(false);
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export function MobileCaptureView({
  captureIndex,
  loading,
  onCreateCapture,
  onDeleteCapture,
  creating,
}: {
  captureIndex: CaptureIndex | null;
  loading: boolean;
  onCreateCapture: (text: string) => Promise<void>;
  onDeleteCapture?: (captureId: string) => Promise<void>;
  creating: boolean;
}) {
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const t = useT();

  const captures = captureIndex?.captures ?? [];

  // キャプチャ送信
  const handleSubmit = useCallback(
    async (text: string) => {
      await onCreateCapture(text);
      setShowCaptureDialog(false);
    },
    [onCreateCapture]
  );

  // 削除
  const handleDelete = useCallback(
    async (captureId: string) => {
      if (!onDeleteCapture) return;
      await onDeleteCapture(captureId);
    },
    [onDeleteCapture]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">
          {t("memo.title")}
        </h1>
        <span className="text-xs text-muted-foreground">
          {loading
            ? t("nav.loadingNotes")
            : t("memo.count", { count: String(captures.length) })}
        </span>
      </div>

      {/* カード一覧 */}
      <div className="flex-1 overflow-auto px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        ) : captures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t("memo.empty")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {captures.map((entry) => (
              <CaptureCard
                key={entry.id}
                entry={entry}
                onDelete={
                  onDeleteCapture
                    ? () => handleDelete(entry.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* クイックキャプチャバー */}
      <div className="border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setShowCaptureDialog(true)}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
        >
          <Plus size={18} />
          {creating ? t("memo.creating") : t("memo.new")}
        </button>
      </div>

      {/* 付箋入力ダイアログ */}
      {showCaptureDialog && (
        <CaptureDialog
          onSubmit={handleSubmit}
          onClose={() => setShowCaptureDialog(false)}
          submitting={creating}
        />
      )}
    </div>
  );
}
