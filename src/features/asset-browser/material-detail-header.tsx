// 素材詳細ビューの共通ヘッダー
// MaterialSidePeek と MaterialFullView から共有して使う。
//
// variant ごとに構成が変わる:
//
//   "sidePeek": サイドピーク用のコンパクトな inline-style ヘッダー
//     [X 閉じる] [Maximize] [type] [名前] [meta] [Knowledge済みバッジ(状態)] [3-dot menu]
//     アクション系（Knowledge化 / 手順抽出 / PDF画像抽出 / Share / Delete）は
//     3-dot メニュー内に集約。peek/full でメニュー位置を揃え、混雑と
//     "peek→full でボタンが消える" 感覚を解消する。
//
//   "titleBar": フル画面用、Note の title bar と同じ Tailwind クラス
//     [type] [filename (編集可)] [meta] ………… [Minimize] [3-dot menu]
//     3-dot メニュー内に Knowledge / PROV / Extract / Share / Delete を集約。
//     X 閉じるは無し（フル画面は左ナビをオーバーレイしない inline 描画なので、
//     ESC や Minimize 経由 / サイドバーで遷移する）。

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  Video,
  Volume2,
  FileText,
  Files,
  Paperclip,
  Link as LinkIcon,
  Bot,
  StickyNote,
  Plus,
  Loader2,
  Table,
} from "lucide-react";
import { useT } from "../../i18n";
import { ContextBadge } from "../note-context/ContextBadge";
import { resolveAssetFolders, type NoteFolderLookup } from "./asset-folders";

/** 参照表が渡らない文脈用（自分で付けたフォルダだけになる） */
const EMPTY_LOOKUP: NoteFolderLookup = new Map();
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import type { MediaIndexEntry, MediaSharedRef, MediaType } from "./media-index";
import { SharedBadge } from "./share-media-dialog";
import { MaterialActionsMenu } from "./material-actions-menu";

const TYPE_HEX: Record<MediaType, string> = {
  image: "#5b8fb9",
  video: "#5b8fb9",
  audio: "#c08b3e",
  pdf: "#c26356",
  url: "#4B7A52",
  document: "#6f5b8b",
  data: "#3f7c85",
  memo: "#b08d3a",
  other: "#7a7a7a",
};

function TypeIcon({ type, size = 14 }: { type: MediaType; size?: number }) {
  switch (type) {
    case "image":
      return <ImageIcon size={size} />;
    case "video":
      return <Video size={size} />;
    case "audio":
      return <Volume2 size={size} />;
    case "pdf":
      return <FileText size={size} />;
    case "url":
      return <LinkIcon size={size} />;
    case "document":
      return <Files size={size} />;
    case "data":
      return <Table size={size} />;
    case "memo":
      return <StickyNote size={size} />;
    default:
      return <Paperclip size={size} />;
  }
}

export type MaterialDetailHeaderProps = {
  /** ノート id → フォルダ。使われているノートのフォルダを導出するために使う */
  noteFolderLookup?: NoteFolderLookup;
  entry: MediaIndexEntry;
  onClose: () => void;
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  onIngest?: (entry: MediaIndexEntry) => void;
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  onTranslatePdf?: (entry: MediaIndexEntry) => void;
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /** Word (.docx) 素材の埋め込み画像を子素材として抽出する */
  onExtractDocxImages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  onNavigateNote?: (noteId: string) => void;
  knowledgeWikiNoteId?: string;
  /** Full view と SidePeek の切替トグル */
  onToggleFull?: () => void;
  fullMode?: boolean;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /**
   * 未登録 URL（transient エントリ）を素材として登録する。
   * 渡された場合のみ「素材に登録」ボタンを表示する（呼び出し側が未登録判定を行う）。
   */
  onRegisterAsset?: (entry: MediaIndexEntry) => void;
  variant?: "sidePeek" | "titleBar";
};

export function MaterialDetailHeader({
  entry,
  noteFolderLookup,
  onClose,
  onRename,
  onIngest,
  onCreateProvNote,
  onTranslatePdf,
  onExtractPdfPages,
  onExtractDocxImages,
  onSharedRefUpdated,
  onNavigateNote,
  knowledgeWikiNoteId,
  onToggleFull,
  fullMode = false,
  onDelete,
  onRegisterAsset,
  variant = "sidePeek",
}: MaterialDetailHeaderProps) {
  const t = useT();
  const titleBarMode = variant === "titleBar";

  // ── 素材登録（未登録 URL の transient エントリ用） ──
  // 登録はメタデータ取得（最大 5 秒）を挟むため、完了までスピナー表示にする。
  // 完了は「呼び出し側が entry を実エントリへ差し替える / onRegisterAsset が
  // undefined になる」ことで現れるため、ここでは完了通知を受け取らない。
  const [registering, setRegistering] = useState(false);
  useEffect(() => {
    setRegistering(false);
  }, [entry.fileId]);

  // ── 名前編集 ──
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [renaming, setRenaming] = useState(false);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  useEffect(() => {
    if (!editing) setEditName(entry.name);
  }, [entry.name, editing]);

  const handleRename = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === entry.name || !onRename) {
      setEditing(false);
      setEditName(entry.name);
      return;
    }
    setRenaming(true);
    try {
      await onRename(entry, trimmed);
      setEditing(false);
    } catch {
      setEditName(entry.name);
      setEditing(false);
    } finally {
      setRenaming(false);
    }
  }, [editName, entry, onRename]);

  const isShared = !!entry.sharedRef;
  const usageNoteCount = new Set(entry.usedIn.map((u) => u.noteId)).size;
  // 属するフォルダ（自分で付けたもの + 使われているノートのフォルダ）
  const folders = resolveAssetFolders(entry, noteFolderLookup ?? EMPTY_LOOKUP);

  // 名前 + メタチップを共通レンダリング
  const renderNameBlock = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
      {editing ? (
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          {...compositionHandlers}
          onKeyDown={(e) => {
            // IME 変換確定の Enter では確定しない（WKWebView の
            // compositionend → keydown(13) 順対応。lib/ime-enter.ts 参照）
            if (e.key === "Enter" && !isImeKey(e)) handleRename();
            if (e.key === "Escape") {
              setEditing(false);
              setEditName(entry.name);
            }
          }}
          disabled={renaming}
          autoFocus
          className="text-sm font-semibold text-foreground bg-transparent border-b-2 border-primary outline-none min-w-[120px] flex-1"
        />
      ) : (
        <span
          className={`text-sm font-medium truncate ${titleBarMode ? "text-muted-foreground" : "text-foreground"} ${onRename ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
          title={onRename ? t("asset.clickToRename") : entry.name}
          onClick={() => { if (onRename) setEditing(true); }}
        >
          {entry.name}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground shrink-0">
        {entry.type === "url" ? entry.urlMeta?.domain ?? "" : entry.mimeType}
      </span>
      {usageNoteCount > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {t("asset.usedInCount", { count: String(usageNoteCount) })}
        </span>
      )}
      {/* 入っているフォルダ（ノートと同じ体系）。ノート由来は薄く出し、
          「外すならノート側」という違いを見せる */}
      {folders.map((f) => (
        <ContextBadge
          key={f.value}
          value={f.value}
          className={f.derived ? "shrink-0 opacity-60" : "shrink-0"}
        />
      ))}
      {isShared && <SharedBadge />}
    </div>
  );

  // Knowledge 化済みバッジ（状態表示）。peek/full 共通で使う。
  // AI で生成された状態を Bot アイコンで示し、クリックで Wiki ノートへジャンプ。
  const renderKnowledgeBadge = () =>
    knowledgeWikiNoteId ? (
      <button
        onClick={() => onNavigateNote?.(`wiki:${knowledgeWikiNoteId}`)}
        className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 shrink-0"
        title={t("knowledge.openInKnowledge")}
      >
        <Bot size={14} />
        {t("knowledge.inKnowledge")}
      </button>
    ) : null;

  // 「素材に登録」ボタン（未登録 URL の transient エントリのみ）。
  // 未登録状態では 3-dot メニューがほぼ空になるため、隠さずヘッダーに直接出す。
  const renderRegisterButton = () =>
    onRegisterAsset ? (
      <button
        onClick={() => {
          if (registering) return;
          setRegistering(true);
          onRegisterAsset(entry);
        }}
        disabled={registering}
        className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60"
        title={t("asset.registerFromPeekHint")}
      >
        {registering ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {registering ? t("asset.urlRegistering") : t("asset.registerFromPeek")}
      </button>
    ) : null;

  const actionsMenu = (
    <MaterialActionsMenu
      entry={entry}
      noteFolderLookup={noteFolderLookup}
      onIngest={onIngest}
      onCreateProvNote={onCreateProvNote}
      onTranslatePdf={onTranslatePdf}
      onExtractPdfPages={onExtractPdfPages}
      onExtractDocxImages={onExtractDocxImages}
      onSharedRefUpdated={onSharedRefUpdated}
      onNavigateNote={onNavigateNote}
      knowledgeWikiNoteId={knowledgeWikiNoteId}
      onDelete={onDelete}
    />
  );

  // ── titleBar variant ──
  if (titleBarMode) {
    return (
      <div className="px-3 md:px-4 py-2.5 md:py-2 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 4,
            borderRadius: 4,
            background: TYPE_HEX[entry.type] + "18",
            color: TYPE_HEX[entry.type],
            flexShrink: 0,
          }}
        >
          <TypeIcon type={entry.type} size={12} />
        </span>
        {renderNameBlock()}
        {renderRegisterButton()}
        {renderKnowledgeBadge()}
        {onToggleFull && (
          <button
            onClick={onToggleFull}
            title={fullMode ? t("asset.exitFull") : t("asset.openInFull")}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            {fullMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
        {actionsMenu}
      </div>
    );
  }

  // ── sidePeek variant ──
  // ナビゲーション系（閉じる / 全画面）は Note SidePeek と揃えて左側に置く。
  // アクション系はすべて 3-dot メニューに集約し、混雑と "peek→full でボタンが消える"
  // 感覚を解消する。Knowledge 化済みバッジだけは状態表示として peek にも残す。
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-surface)",
        flexShrink: 0,
      }}
    >
      <button
        onClick={onClose}
        title={t("common.close")}
        style={{
          display: "flex",
          alignItems: "center",
          padding: 6,
          borderRadius: 4,
          color: "var(--color-text-secondary)",
        }}
        className="hover:bg-muted transition-colors"
      >
        <X size={14} />
      </button>

      {onToggleFull && (
        <button
          onClick={onToggleFull}
          title={fullMode ? t("asset.exitFull") : t("asset.openInFull")}
          style={{
            display: "flex",
            alignItems: "center",
            padding: 6,
            borderRadius: 4,
            color: "var(--color-text-secondary)",
          }}
          className="hover:bg-muted transition-colors"
        >
          {fullMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      )}

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: 4,
          borderRadius: 4,
          background: TYPE_HEX[entry.type] + "18",
          color: TYPE_HEX[entry.type],
          flexShrink: 0,
        }}
      >
        <TypeIcon type={entry.type} size={12} />
      </span>

      {renderNameBlock()}

      {renderRegisterButton()}

      {renderKnowledgeBadge()}

      {actionsMenu}
    </div>
  );
}
