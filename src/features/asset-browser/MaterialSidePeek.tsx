// 素材サイドピーク（material as note）
// 軽量の右側スライドインビュー。
// 構成: ヘッダー（共通） + viewer + Metadata（共通、Name 編集可）+ Asset graph
//
// Asset graph も含めるのは discoverability のため：素材ノードをグラフ経由で
// 辿れる価値が Full view まで上げないと気づけないという問題があったので、
// SidePeek 段階でも折り畳みセクションとして見えるようにしている（default open）。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MediaIndex, MediaIndexEntry, MediaSharedRef } from "./media-index";
import { MediaPreview } from "./media-preview";
import type { CitationSource } from "./SelectionPill";
import {
  AssetGraphPanel,
  shouldShowAssetGraph,
  type KnowledgeKindLookup,
} from "./asset-graph-panel";
import { MaterialDetailHeader } from "./material-detail-header";

// SidePeek 用の Asset graph 折り畳みセクション。
// 親 SidePeek の縦スタックの一段として収まる想定（高さ固定 + 内部 grid）。
function GraphSection({
  entry,
  mediaIndex,
  getKnowledgeKind,
  onNavigateNote,
  onOpenNoteSidePeek,
  onSwitchAsset,
}: {
  entry: MediaIndexEntry;
  mediaIndex?: MediaIndex | null;
  getKnowledgeKind?: KnowledgeKindLookup;
  onNavigateNote: (noteId: string) => void;
  onOpenNoteSidePeek?: (noteId: string) => void;
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!shouldShowAssetGraph(entry, mediaIndex)) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        background: "var(--color-card)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: open ? 240 : 32,
        transition: "height 0.2s ease-out",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          color: "var(--color-text-secondary)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          textAlign: "left",
          flexShrink: 0,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Asset graph
      </button>
      {open && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <AssetGraphPanel
            entry={entry}
            mediaIndex={mediaIndex}
            getKnowledgeKind={getKnowledgeKind}
            onNavigateNote={onNavigateNote}
            onOpenNoteSidePeek={onOpenNoteSidePeek}
            onSwitchAsset={onSwitchAsset}
            showLegend={false}
          />
        </div>
      )}
    </div>
  );
}

export type MaterialSidePeekProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  /** Full view へ昇格 — 渡された場合のみ Maximize2 ボタンを表示 */
  onToggleFull?: () => void;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /** 使用ノートへ遷移 */
  onNavigateNote?: (noteId: string) => void;
  /** 指定時：アセットグラフの利用ノードクリックで離脱せず右に SidePeek で開く */
  onOpenNoteInSidePeek?: (noteId: string) => void;
  /** タイトル / Metadata Name 編集 */
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /** Knowledge 化（URL / PDF 限定） */
  onIngest?: (entry: MediaIndexEntry) => void;
  /** PROV ラベル付きノート生成（URL / PDF 限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** PDF を原文構成のまま UI 言語へ全文翻訳して 1 ノート化（PDF 限定） */
  onTranslatePdf?: (entry: MediaIndexEntry) => void;
  /** PDF 各ページを画像として抽出 */
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /** Word (.docx) 素材の埋め込み画像を子素材として抽出 */
  onExtractDocxImages?: (
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
  /** PDF 内テキストの選択を新規メモとして保存 */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
  /** URL Reader で表示中の記事画像を Graphium の画像アセットとして保存 */
  onSaveImageAsAsset?: (imageUrl: string, sourceEntry: MediaIndexEntry) => Promise<void>;
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
  onTranslatePdf,
  onOpenNoteInSidePeek,
  onExtractPdfPages,
  onExtractDocxImages,
  onSharedRefUpdated,
  knowledgeWikiNoteId,
  mediaIndex,
  getKnowledgeKind,
  onSwitchAsset,
  onSaveSelectionAsMemo,
  onSaveImageAsAsset,
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
        onTranslatePdf={onTranslatePdf}
        onExtractPdfPages={onExtractPdfPages}
        onExtractDocxImages={onExtractDocxImages}
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
        <MediaPreview
          entry={entry}
          onSaveSelectionAsMemo={onSaveSelectionAsMemo}
          onSaveImageAsAsset={onSaveImageAsAsset}
        />
      </div>

      {/* Metadata は SidePeek では非表示（面積圧迫のため）— Full view の右パネルから確認 */}

      {/* Asset graph（関連ノート + 派生）— default open で discoverability 確保 */}
      {onNavigateNote && (
        <GraphSection
          entry={entry}
          mediaIndex={mediaIndex}
          getKnowledgeKind={getKnowledgeKind}
          onNavigateNote={onNavigateNote}
          onOpenNoteSidePeek={onOpenNoteInSidePeek}
          onSwitchAsset={onSwitchAsset}
        />
      )}
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}
