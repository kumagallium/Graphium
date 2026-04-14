// モバイル専用クイックキャプチャビュー
// メモ + メディア（画像・動画・音声）を時系列カードで表示 + キャプチャバー

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Plus, Trash2, Camera, Video, Mic, Image, Volume2, Search, X, Link } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { UrlBookmarkModal } from "../asset-browser/UrlBookmarkModal";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";
import { CaptureDialog } from "./CaptureDialog";

// ── 統合タイムラインアイテム ──

type TimelineItem =
  | { kind: "memo"; entry: CaptureEntry; timestamp: string }
  | { kind: "media"; entry: MediaIndexEntry; timestamp: string };

// ── モバイル用メモ編集モーダル ──

function MobileMemoEditModal({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: CaptureEntry;
  onClose: () => void;
  onEdit?: (captureId: string, newText: string) => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(entry.text);

  const handleSave = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === entry.text || !onEdit) {
      setEditing(false);
      setEditText(entry.text);
      return;
    }
    onEdit(entry.id, trimmed);
    setEditing(false);
  }, [editText, entry, onEdit]);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[80dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <StickyNote size={16} className="text-primary shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              {formatRelativeTime(entry.createdAt)}
            </span>
            {entry.modifiedAt && (
              <span className="text-[10px] text-muted-foreground truncate">
                ({t("memo.modified")}: {formatRelativeTime(entry.modifiedAt)})
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onDelete && (
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-auto p-4">
          {editing ? (
            <div className="flex flex-col gap-3 h-full">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoFocus
                className="flex-1 w-full min-h-[120px] resize-none bg-background border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setEditing(false); setEditText(entry.text); }}
                  className="px-4 py-2 text-xs rounded-lg border border-border text-foreground active:bg-muted transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground active:opacity-80 transition-opacity"
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`${onEdit ? "cursor-pointer active:bg-muted/50 rounded-lg p-2 -m-2 transition-colors" : ""}`}
              onClick={() => { if (onEdit) setEditing(true); }}
            >
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {entry.text}
              </p>
              {onEdit && (
                <p className="text-[10px] text-muted-foreground mt-3">
                  {t("memo.clickToEdit")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// メモカード
function MemoCard({
  entry,
  onTap,
  onDelete,
}: {
  entry: CaptureEntry;
  onTap?: () => void;
  onDelete?: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="relative bg-card border border-border rounded-lg p-3 transition-colors active:bg-muted/30 cursor-pointer"
      onClick={() => onTap?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowDelete((v) => !v);
      }}
    >
      <p className="text-sm text-foreground line-clamp-4 whitespace-pre-wrap mb-1.5">
        {entry.text}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {formatRelativeTime(entry.createdAt)}
      </p>
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

// メディアカード（サムネイル付き）
function MediaCard({ entry }: { entry: MediaIndexEntry }) {
  const icon = entry.type === "video" ? <Video size={20} /> :
               entry.type === "audio" ? <Volume2 size={20} /> :
               <Image size={20} />;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {entry.type === "image" ? (
        <img
          src={entry.thumbnailUrl}
          alt={entry.name}
          className="w-full h-24 object-cover bg-muted"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-24 flex items-center justify-center bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="p-2">
        <p className="text-[11px] text-foreground truncate">{entry.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatRelativeTime(entry.uploadedAt)}
        </p>
      </div>
    </div>
  );
}

export function MobileCaptureView({
  captureIndex,
  mediaIndex,
  loading,
  onCreateCapture,
  onDeleteCapture,
  onEditCapture,
  onUploadMedia,
  onAddUrlBookmark,
  creating,
}: {
  captureIndex: CaptureIndex | null;
  mediaIndex?: MediaIndex | null;
  loading: boolean;
  onCreateCapture: (text: string) => Promise<void>;
  onDeleteCapture?: (captureId: string) => Promise<void>;
  onEditCapture?: (captureId: string, newText: string) => void;
  onUploadMedia?: (file: File) => Promise<string>;
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  creating: boolean;
}) {
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [detailEntry, setDetailEntry] = useState<CaptureEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  // メモ + メディアを時系列で統合
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    // メモ
    for (const entry of captureIndex?.captures ?? []) {
      items.push({ kind: "memo", entry, timestamp: entry.createdAt });
    }
    // メディア（image, video, audio のみ。URL や PDF はスキップ）
    for (const entry of mediaIndex?.media ?? []) {
      if (entry.type === "image" || entry.type === "video" || entry.type === "audio") {
        items.push({ kind: "media", entry, timestamp: entry.uploadedAt });
      }
    }
    // 新しい順
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  }, [captureIndex, mediaIndex]);

  // 検索フィルタ
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return timeline;
    const q = searchQuery.trim().toLowerCase();
    return timeline.filter((item) => {
      if (item.kind === "memo") return item.entry.text.toLowerCase().includes(q);
      if (item.kind === "media") return item.entry.name.toLowerCase().includes(q);
      return false;
    });
  }, [timeline, searchQuery]);

  // テキストメモ送信
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

  // メディアアップロード共通
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onUploadMedia) return;
      setUploading(true);
      try {
        await onUploadMedia(file);
      } catch (err) {
        console.error("メディアアップロードに失敗:", err);
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    },
    [onUploadMedia]
  );

  const mediaDisabled = !onUploadMedia || uploading;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-6 h-6" />
          <h1 className="text-base font-semibold text-foreground">
            Graphium
          </h1>
        </div>
        <span className="text-xs text-muted-foreground">
          {loading
            ? t("common.loading")
            : t("memo.count", { count: String(filtered.length) })}
        </span>
      </div>

      {/* 検索バー */}
      {timeline.length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("memo.searchPlaceholder")}
              className="w-full text-xs pl-8 pr-8 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* タイムライン一覧 */}
      <div className="flex-1 overflow-auto px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim() ? t("nav.noMatchingNotes") : t("memo.empty")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((item) =>
              item.kind === "memo" ? (
                <MemoCard
                  key={item.entry.id}
                  entry={item.entry}
                  onTap={() => setDetailEntry(item.entry)}
                  onDelete={
                    onDeleteCapture
                      ? () => handleDelete(item.entry.id)
                      : undefined
                  }
                />
              ) : (
                <MediaCard
                  key={item.entry.fileId}
                  entry={item.entry}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* クイックキャプチャバー */}
      <div className="border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {uploading && (
          <p className="text-xs text-muted-foreground text-center mb-2">
            {t("asset.uploading")}
          </p>
        )}
        <div className="flex items-center gap-2">
          {/* メモ作成ボタン */}
          <button
            onClick={() => setShowCaptureDialog(true)}
            disabled={creating}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
          >
            <Plus size={18} />
            {creating ? t("memo.creating") : t("memo.new")}
          </button>

          {/* ブックマーク追加ボタン */}
          {onAddUrlBookmark && (
            <button
              onClick={() => setShowBookmarkModal(true)}
              className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors"
              title={t("asset.urlRegisterTitle")}
            >
              <Link size={20} />
            </button>
          )}

          {/* メディアキャプチャボタン */}
          {onUploadMedia && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.image")}
              >
                <Camera size={20} />
              </button>
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.video")}
              >
                <Video size={20} />
              </button>
              <button
                onClick={() => audioInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.audio")}
              >
                <Mic size={20} />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}
        </div>
      </div>

      {/* 付箋入力ダイアログ */}
      {showCaptureDialog && (
        <CaptureDialog
          onSubmit={handleSubmit}
          onClose={() => setShowCaptureDialog(false)}
          submitting={creating}
        />
      )}

      {/* メモ詳細・編集モーダル */}
      {detailEntry && (
        <MobileMemoEditModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onEdit={onEditCapture ? (id, text) => {
            onEditCapture(id, text);
            setDetailEntry({ ...detailEntry, text, modifiedAt: new Date().toISOString() });
          } : undefined}
          onDelete={onDeleteCapture ? () => {
            onDeleteCapture(detailEntry.id);
            setDetailEntry(null);
          } : undefined}
        />
      )}

      {/* URL ブックマーク登録モーダル */}
      {showBookmarkModal && onAddUrlBookmark && (
        <UrlBookmarkModal
          onRegister={(entry) => {
            onAddUrlBookmark(entry);
            setShowBookmarkModal(false);
          }}
          onClose={() => setShowBookmarkModal(false)}
        />
      )}
    </div>
  );
}
