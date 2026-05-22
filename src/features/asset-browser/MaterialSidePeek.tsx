// 素材サイドピーク（material as note）
// 軽量の右側スライドインビュー。
// 構成: ヘッダー（共通） + viewer + Metadata（共通、Name 編集可）
// Asset graph は Full view 側に表示する（このサイドピークには含めない）。

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { MediaIndex, MediaIndexEntry, MediaSharedRef } from "./media-index";
import { MediaPreview } from "./media-preview";
import type { KnowledgeKindLookup } from "./asset-graph-panel";
import { MaterialDetailHeader } from "./material-detail-header";
import { MaterialMetadataSection } from "./material-metadata-section";

export type MaterialSidePeekProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  /** Full view へ昇格 — 渡された場合のみ Maximize2 ボタンを表示 */
  onToggleFull?: () => void;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /** 使用ノートへ遷移 */
  onNavigateNote?: (noteId: string) => void;
  /** タイトル / Metadata Name 編集 */
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /** Knowledge 化（URL / PDF 限定） */
  onIngest?: (entry: MediaIndexEntry) => void;
  /** PROV ラベル付きノート生成（URL / PDF 限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** PDF 各ページを画像として抽出 */
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /** team-shared storage 共有成功時 */
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  /** 既存 Knowledge wiki の ID（あれば「In Knowledge」表示） */
  knowledgeWikiNoteId?: string;
  /** Asset graph のためのインデックス（Full view 側で使う、ここでは未使用だが prop は受けて pass-through 想定） */
  mediaIndex?: MediaIndex | null;
  /** Wiki kind ルックアップ（Full view 側で使う） */
  getKnowledgeKind?: KnowledgeKindLookup;
  /** Full view 側で使う */
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
  /**
   * inline=true: 親 flex に flex item として組み込まれる（ノートのサイドピーク同等）
   * inline=false（デフォルト）: 画面右端から portal で fixed 表示
   */
  inline?: boolean;
};

export function MaterialSidePeek({
  entry,
  onClose,
  onToggleFull,
  onDelete,
  onNavigateNote,
  onRename,
  onIngest,
  onCreateProvNote,
  onExtractPdfPages,
  onSharedRefUpdated,
  knowledgeWikiNoteId,
  inline = false,
}: MaterialSidePeekProps) {
  // ESC で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const containerStyle: React.CSSProperties = inline
    ? {
        position: "relative",
        height: "100%",
        flexShrink: 0,
        width: 480,
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      }
    : {
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "55%",
        minWidth: 400,
        maxWidth: 800,
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border-subtle)",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      };

  const body = (
    <div data-side-peek style={containerStyle}>
      <MaterialDetailHeader
        entry={entry}
        onClose={onClose}
        onRename={onRename}
        onIngest={onIngest}
        onCreateProvNote={onCreateProvNote}
        onExtractPdfPages={onExtractPdfPages}
        onSharedRefUpdated={onSharedRefUpdated}
        onNavigateNote={onNavigateNote}
        knowledgeWikiNoteId={knowledgeWikiNoteId}
        onToggleFull={onToggleFull}
        fullMode={false}
        onDelete={onDelete}
      />

      {/* 本体 viewer */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "var(--color-surface)",
          overflow: "auto",
          minHeight: 0,
        }}
      >
        <MediaPreview entry={entry} />
      </div>

      {/* メタデータ（Name 編集可） */}
      <MaterialMetadataSection
        entry={entry}
        onNavigateNote={onNavigateNote}
        onRename={onRename}
      />
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}
