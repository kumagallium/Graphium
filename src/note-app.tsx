// ノートアプリのメイン画面
// Google Drive と連携してノートの作成・保存・読み込みを行う

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Save, FileDown, Share2, MoreHorizontal, Network, GitBranch, Bot, History, FileText, PanelLeftOpen, BookPlus, BookOpen, Trash2, Archive, ArchiveRestore, StickyNote, Link2, Check, Pin, MoveHorizontal } from "lucide-react";
import { apiBase, isTauri, tauriDetectionDetail } from "./lib/platform";
import { onMenuAction } from "./lib/menu-events";
import { ensureSidecar } from "./lib/sidecar";
import { SandboxEditor } from "./base/editor";
import type { SlashMenuItem } from "./base/slash-menu-types";
import { bookmarkSlashItem, setBookmarkPickerCallback, setBookmarkPeekCallback } from "./blocks/bookmark";
import { calloutSlashItem } from "./blocks/callout";
import { mathSlashItem } from "./blocks/math";
import { calcSlashItem } from "./blocks/calc";
import { inlineMathSlashItem } from "./features/inline-math/spec";
import { parseMarkdownToBlocksWithMath } from "./features/math/markdown-math";
import { stepSlashItem } from "./blocks/step";
import { columnsSlashItem } from "./blocks/multi-column";
import { customBlockEntries, KNOWN_BLOCK_TYPES, KNOWN_INLINE_TYPES, sanitizeBlocksForLoad } from "./blocks/registry";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
  useProvLabelsEnabled,
  useLabelStore,
} from "./features/context-label";
import {
  MediaInlineLabelProvider,
  useMediaInlineLabelStore,
} from "./features/inline-label/media-store";
import {
  MediaOcrProvider,
  useMediaOcrStore,
  useAutoImageOcr,
  OcrToast,
} from "./features/media-ocr";
import {
  BlockAlignmentProvider,
  useBlockAlignmentStore,
  AlignmentStyleLayer,
} from "./features/block-alignment";
import { regenInlineEntitiesInBlocks } from "./features/inline-label/regen-on-paste";
import {
  ProvIndicatorLayer,
  BlockHoverHighlight,
  ScopeHighlight,
  setOnPrevStepLinkSelected,
} from "./features/context-label/prov-indicator";
import {
  IndexTableIconLayer,
  indexTableSlashItem,
  setIndexTableCallbacks,
  setRegisterIndexTableCallback,
} from "./features/index-table";
import { SidePeek } from "./features/index-table/side-peek";
import {
  logTableSlashItem,
  setRegisterLogTableCallback,
  applyLogTableTimestamps,
  primeLogTableRowTracking,
} from "./features/log-table";
import {
  TableMetaStoreProvider,
  useTableMetaStore,
  TableCaptionLayer,
  migrateTableMeta,
  hasColumnType,
  readFirstColumnName,
  type ColumnType,
  type TableSource,
} from "./features/table-meta";
import {
  DataImportModal,
  buildTableSource,
  toTableBlock,
  defaultCaption,
  isDelimitedDataFile,
  readDataFileText,
  type DataImportResult,
  type DelimitedImportOptions,
} from "./features/data-import";
import {
  chartSlashItem,
  ChartAssetSourceFlow,
  setChartAssetSourceCallback,
  type ChartAssetSourceResult,
} from "./blocks/chart";
import { buildSavedPageFields } from "./features/note-save";
import { DocumentSearchBar } from "./features/document-search/DocumentSearchBar";
import { setupLabelAutoAssign } from "./features/context-label/label-auto";
import {
  LinkStoreProvider,
  useLinkStore,
} from "./features/block-link";
import { useBlockLifecycle } from "./features/block-lifecycle";
import {
  GRAPHIUM_CLIPBOARD_MIME,
  applyClipboardPayload,
  buildClipboardPayload,
  computeIdMap,
  embedPayloadInHtml,
  extractPayloadFromHtml,
  flattenBlockIds,
  parseClipboardPayload,
} from "./features/block-lifecycle/clipboard";
import {
  getHeadingSuggestions,
  getNoteSuggestions,
  getAssetSuggestions,
  getCreateNoteSuggestion,
  CREATE_NEW_NOTE_ID,
  insertNoteMentionInline,
  resolveMentionTargetFromLinks,
} from "./features/block-link/mention-menu";
import { useNewNoteNamePrompt } from "./features/block-link/new-note-name-dialog";
import { buildMentionPatterns, rewriteMentionRunsForBlock } from "./features/block-link/mention-rename";
import {
  ProvGraphPanel,
} from "./features/prov-generator";
import {
  GraphLinksPanel,
  GlobalGraphView,
  ProcessGalleryView,
  buildGlobalGraph,
  parseExternalSource,
} from "./features/network-graph";
import { ReleaseNotesPanel } from "./features/release-notes";
import {
  AiAssistantProvider,
  AiAssistantPanel,
  useAiAssistant,
  runAgent,
  generateTitle,
  buildAiDerivedDocument,
} from "./features/ai-assistant";
import type { AttachedNote } from "./features/ai-assistant/panel";
import type { AgentChatMessage, AgentRunRequest } from "./features/ai-assistant";
import { buildAttachmentSuffix } from "./features/ai-assistant/attachment-suffix";
import { buildQuotedChatMessage, buildQuotedRetrievalQuery } from "./features/ai-assistant/quoted-context";
import { buildPageRetrievalQuery } from "./features/ai-assistant/retrieval-topic";
import {
  chatRunManager,
  buildRunScopeChat,
  type ChatRunState,
  type ChatRunApplyHandle,
} from "./features/ai-assistant/chat-run-manager";
import { upsertChat } from "./features/ai-assistant/store";
import { saveNoteDoc } from "./features/note-save";
import { extractLabelMarkersFromBlocks, convertExtractedProcedureBlocksToSteps } from "./features/ai-assistant/label-markers";
import { splitSourceMentions, linkifySourceMentions } from "./features/ai-assistant/source-mentions";
import { isDocumentNote, assembleCitedDocumentContext, assembleCitedAssetContext, gatherDerivedKnowledge, blocksToPlainText, type GroundingScope } from "./features/ai-assistant/cited-document-context";
import { DEFAULT_GROUNDING_SCOPE, includesCrossSearch } from "./lib/grounding-scope";
import { SettingsModal, isAgentConfigured, setAiModelsAvailable, getLLMModels, getSelectedModel, getDisabledTools, getChatSynthesisLLMModel, getChatSynthesisModelName, loadSettings, isAtomLayerEnabled, isSynthesisEnabled, type ExperimentalSettings } from "./features/settings";
import { useStorage } from "./lib/storage/use-storage";
import { getActiveProvider } from "./lib/storage/registry";
import { takeSnapshot, listSnapshots, deleteSnapshot, renameSnapshot, loadSnapshot, buildRestoredDocument } from "./features/version-snapshots/snapshot-store";
import type { SnapshotMeta } from "./features/version-snapshots/types";
import type { GraphiumDocument, NoteLink } from "./lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "./lib/document-migration";
import { recordRevision, detectActivityType } from "./features/document-provenance/tracker";
import { loadAuthorIdentity } from "./features/identity";
import { getSharedRoot, getBlobRoot, pickInboxRoot } from "./lib/storage/shared";
// モバイル受信箱（<root>/Inbox/ の未取り込みファイル）。top バレル(./features/mobile-capture)は
// inbox を再export しないため、inbox サブバレルから直接 import する。
import { getInboxRoot, setInboxRoot, getInboxKeepArchive, setInboxKeepArchive, useInboxConfig, runInboxImport, FolderInbox, InboxView } from "./features/mobile-capture/inbox";
import type { CaptureRef } from "./features/mobile-capture/inbox/types";
import {
  shareNote,
  forkSharedNote,
  unshareEntry,
  SharedLibraryView,
  materializeSharedBlobs,
} from "./features/sharing";
import { LocalFolderBlobProvider, type BlobRef } from "./lib/storage/shared";
import { DocumentProvenancePanel } from "./features/document-provenance";
import { cn } from "./lib/utils";
import { NoteListView, TrashView, buildKnowledgeMap, findIncomingReferences, readIndexFile, type GraphiumIndex, type NoteIndexEntry } from "./features/navigation";
import { ContextBadge } from "./features/note-context/ContextBadge";
import { ContextTagPicker } from "./features/note-context/ContextTagPicker";
import { aggregateNoteContexts, addNoteContext, removeNoteContext } from "./features/note-context/context-tags";
import { useHashRouter, type AppRoute, type RouteActions } from "./hooks/use-hash-router";
import {
  WikiListView, WikiLogView, WikiLintView, WikiBanner, WikiContextDrawer,
  IngestToast, type IngestToastState, type IngestToastItem, type IngestStage, type IngestStageStatus,
  ingestNote, ingestFromUrl, ingestFromChat, ingestFromPdf, ingestFromDocx, ingestFromMultiSource,
  extractPlainTextFromDoc,
  type MultiSourcePart,
  buildWikiDocument, mergeIntoWikiDocument, rewriteAndMerge, embedWikiSections,
  // 横断更新
  fetchCrossUpdateProposals, applyCrossUpdate, extractWikiDetail, extractBodyPreview,
  // Lint（自動実行用）
  lintWikis, buildWikiSnapshots,
  // 構造化インデックス
  buildWikiIndex, formatWikiIndexForLLM,
  // Synthesis
  buildClaimSnapshots, MAX_SNAPSHOTS_PER_RUN,
  type ClaimSnapshot,
  type AtomCandidate, getDocEmbedding, pickFarthestSeeds, buildClusterSlice, pickClusterCount,
  rankCandidatesByRelevance,
  // Atom（実験的）
  atomizeConcepts, buildAtomDocument, reinforceAtomWithClaims,
  // Discovery 共通: embedding ベース重複検出
  partitionCandidatesByEmbedding,
  // インライン引用リンク
  buildNoteIndex,
  // 操作ログ
  wikiLog,
} from "./features/wiki";
import { setWikiIndexForRetriever, setWikiTitleMap, setNoteTitleMap } from "./features/wiki/retriever";
import { useLexicalIndexSync } from "./features/lexical-search";
import { KnowledgeStatusChip } from "./features/wiki/KnowledgeStatusChip";
import { attachValidity, checkValidity } from "./features/world-grounding";
import { ingestUrlToProv, ingestPdfToProv, ingestDocxToProv, buildProvNoteDocument, collectLabelVocabulary } from "./features/url-to-prov";
import { translatePdfToNote, translateUrlToNote, fetchReaderArticle, isSameLanguage } from "./features/pdf-translate/translate-service";
import { SkillListView, SkillBanner, SkillDialog, buildSkillDocument, extractSkillPrompt, buildSkillPromptSection, pickActiveSkills } from "./features/skill";
import type { WikiKind } from "./lib/document-types";
import { MobileCaptureView, MemoGalleryView, MemoPickerModal, getMemoSlashMenuItem, setMemoPickerCallback, CaptureDialog, buildMemoInsertBlock, getTrashedCaptures, getArchivedCaptures, resolveMemoBlockLabel } from "./features/mobile-capture";
import { TemplatePickerModal, getTemplateSlashMenuItem, setTemplatePickerCallback, getAllTemplates } from "./features/template";
import {
  CitePickerModal,
  getCiteSlashMenuItems,
  setCitePickerCallback,
  type CitePickerKind,
} from "./features/cite-picker";
import { SharedCitePickerModal } from "./features/sharing/SharedCitePickerModal";
import {
  sharedCitationSlashItem,
  setSharedCitePickerCallback,
  setSharedEntryOpenCallback,
  insertSharedCitations,
} from "./blocks/shared-citation";
import { collectNewSharedCitationSources } from "./blocks/shared-citation/collect";
import type { CaptureEntry } from "./features/mobile-capture";
import {
  AssetGalleryView,
  LabelGalleryView,
  MediaPickerModal,
  NoteMemosSection,
  getMediaSlashMenuItems,
  setMediaPickerCallback,
  DEFAULT_MEDIA_SLASH_TITLES,
  UrlPasteMenu,
  extractDomain,
  generateUrlBookmarkId,
  getFaviconUrl,
  buildUrlPeekEntry,
  buildMemoPeekEntry,
  isHttpUrl,
  computeUrlPasteMenuPosition,
  buildPastedTextContent,
  insertBookmarkBlockFromPaste,
  retroLinkifyPastedUrl,
  registerUrlAsset,
  type MediaType,
  findBlockIdsByMediaUrl,
  type MediaIndexEntry,
  type AssetDisplayMode,
} from "./features/asset-browser";
import { extractEmbeddedPdfImages, embeddedImageToFile } from "./features/asset-browser/pdf-image-extractor";
import { fetchRemoteImageAsFile } from "./features/asset-browser/remote-image";
import { schedulePastedImageCapture } from "./features/asset-browser/paste-image-capture";
import { MaterialSidePeek } from "./features/asset-browser/MaterialSidePeek";
import { useT, t as tStatic, getLocale } from "./i18n";
import { ensureAgentConfigured, localizeAiError, AI_NOT_CONFIGURED_EVENT } from "./lib/ai-error";
import { isAbortError } from "./lib/abort-error";
import { printNote, PrintToast } from "./features/pdf-export";
import { exportNoteToMarkdown } from "./features/markdown-export";
import { blocksToMarkdown } from "./features/markdown-export/blocks-to-markdown";
import { exportProvJsonLd, selectNoteScopedWikiIds, type WikiEntityInfo } from "./features/prov-export";

// hooks
import { useAutoSave } from "./hooks/use-auto-save";
import { useImeEnterGuard } from "./hooks/use-ime-enter-guard";
import { useAutoGrounding } from "./hooks/use-auto-grounding";
import { useProvGeneration } from "./hooks/use-prov-generation";
import { useFileManager } from "./hooks/use-file-manager";
import { useCapture } from "./hooks/use-capture";

// components
import { WelcomeDialog } from "./components/WelcomeDialog";
import { FileSidebar } from "./components/FileSidebar";
import { NoteSideMenu, collectBlockScope, setOpenLinkDropdownFn, setOpenBlockMemoFn } from "./components/side-menu";
import { NoteFormattingToolbar } from "./components/formatting-toolbar";
import { SourceDocPanel, extractBlockTitle } from "./components/SourceDocPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { BackendDownBanner } from "./components/BackendDownBanner";
import { MissingApiKeyBanner } from "./components/MissingApiKeyBanner";
import { MobileHeader } from "./components/MobileHeader";
import { Sheet } from "./ui/sheet";
import { useIsDesktop } from "./hooks/use-media-query";
import { Composer, useComposer, type ComposerSubmission, type DiscoveryCard } from "./features/composer";
import { buildDiscoveryCards, promptForDiscoveryCard } from "./features/composer/discovery-cards";
import { cleanSuggestionText, type KnowledgeCandidate } from "./features/composer/verb-suggestion-doc";
import type { WikiLogEntry } from "./features/wiki/wiki-log";
import { EmptyNoteGuide } from "./features/onboarding";

import type { GraphiumFile } from "./lib/document-types";
import type { NoteGraphData, LineageNode } from "./features/network-graph";
import type { CitationSource } from "./features/asset-browser/SelectionPill";

// URL 原文の Reader 取得（ノート内参照 grounding 用, B-runtime）。LLM 加工前の原語原文を Reader 経由で
// 取り、セッション内キャッシュする。永続保存版（B-persist）は下の persistUrlSourceText / loadMediaText。
const urlTextCache = new Map<string, string>();
async function loadUrlText(url: string): Promise<string | undefined> {
  const cached = urlTextCache.get(url);
  if (cached != null) return cached;
  try {
    const { fetchReaderArticle } = await import("./features/pdf-translate/translate-service");
    const article = await fetchReaderArticle(url);
    const text = (article.textContent || "").trim();
    if (!text) return undefined;
    urlTextCache.set(url, text);
    return text;
  } catch {
    return undefined;
  }
}

// URL の原語原文（LLM 加工前）を永続保存し、保存先メディア ID を返す（B-persist）。
// 空文字・未対応プロバイダ・保存失敗時は undefined を返し、呼び出し側は B-runtime の
// loadUrlText（都度 Reader 取得）にフォールバックする。取り込み/翻訳の成功時に呼ぶ。
async function persistUrlSourceText(text: string): Promise<string | undefined> {
  const trimmed = (text || "").trim();
  if (!trimmed) return undefined;
  const provider = getActiveProvider();
  if (!provider.saveMediaText) return undefined;
  try {
    const fileId = crypto.randomUUID();
    await provider.saveMediaText(fileId, trimmed);
    return fileId;
  } catch {
    return undefined;
  }
}

// 永続保存済みの URL 原文を取得する（B-persist）。cited-document-context の deps に渡し、
// doc.sourceTextFileId があれば loadUrlText より優先してノート内参照 grounding に載せる。
async function loadMediaText(fileId: string): Promise<string | undefined> {
  const provider = getActiveProvider();
  if (!provider.loadMediaText) return undefined;
  try {
    return await provider.loadMediaText(fileId);
  } catch {
    return undefined;
  }
}

/**
 * メモ（capture）のプレーンテキストから最小の GraphiumDocument を組む。
 * 「複数選択メモ → Knowledge 化」で、メモ本文を ingest パイプラインに流すための
 * 一時ドキュメント（保存しない。ノートは作らない）。来歴は external-source.ts の
 * "memo:<captureId>" プレフィックスで derivedFromNotes に記録されるため、
 * ノートを materialize しなくても provenance は保たれる。
 * @param text メモ本文（trim 済みを想定）
 * @param fallbackTitle 先頭が空のときのタイトル
 */
function buildMemoNoteDoc(text: string, fallbackTitle: string): GraphiumDocument {
  const baseProps = { textColor: "default", backgroundColor: "default", textAlignment: "left" };
  // 行ごとに段落ブロック化（空行は空 paragraph = BlockNote 上の改行）
  const blocks = text.split("\n").map((rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    return {
      id: crypto.randomUUID(),
      type: "paragraph",
      props: baseProps,
      content: line.trim() === "" ? [] : [{ type: "text", text: line, styles: {} }],
      children: [],
    };
  });
  // タイトルは先頭の非空行を 40 字で切る
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const title = (firstLine || fallbackTitle).slice(0, 40);
  const now = new Date().toISOString();
  return {
    version: 5,
    title,
    pages: [{
      id: crypto.randomUUID(),
      title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  };
}

/** CitationSource から人間可読の出典ラベルを組み立てる */
function buildCitationSourceLabel(source: CitationSource): string {
  if (source.entry.type === "pdf") {
    return source.pageNumber
      ? `${source.entry.name} · p.${source.pageNumber}`
      : source.entry.name;
  }
  if (source.entry.type === "url") {
    return source.entry.urlMeta?.domain ?? source.entry.name;
  }
  return source.entry.name;
}

// ── ヘッダーメニュー（Notion 風ドロップダウン） ──

function NoteHeaderMenu({
  onSave,
  onTakeSnapshot,
  saveDisabled,
  onExportPdf,
  pdfExporting,
  onExportMarkdown,
  onExportProvJsonLd,
  provExportDisabled,
  onDeriveWholeNote,
  deriveDisabled,
  onIngestToWiki,
  onIngestFromUrl,
  ingestDisabled,
  isWikiDoc,
  inKnowledge,
  onOpenKnowledge,
  archived,
  onArchive,
  archiveDisabled,
  onRestore,
  trashed,
  onRestoreFromTrash,
  onDelete,
  deleteDisabled,
  onShare,
  shareDisabled,
  isShared,
  shareBusy,
  shareDisabledReason,
  onCopyLink,
  fullWidth,
  onToggleFullWidth,
  t,
}: {
  onSave: () => void;
  /** 版を残す（対象外ノートでは undefined にして項目ごと隠す） */
  onTakeSnapshot?: () => void;
  saveDisabled: boolean;
  onExportPdf: () => void;
  pdfExporting: boolean;
  /** ノートを Markdown ファイルとしてエクスポートする */
  onExportMarkdown: () => void;
  onExportProvJsonLd: () => void;
  provExportDisabled: boolean;
  onDeriveWholeNote?: () => void;
  deriveDisabled?: boolean;
  onIngestToWiki?: () => void;
  onIngestFromUrl?: () => void;
  ingestDisabled?: boolean;
  isWikiDoc?: boolean;
  /** このノートが既に Knowledge 化されているか（true なら Add の代わりに「Already in Knowledge」を表示） */
  inKnowledge?: boolean;
  /** 「Already in Knowledge」押下で対応 wiki エントリを開く */
  onOpenKnowledge?: () => void;
  /** このノートがアーカイブ済みか。true ならメニューの「アーカイブ」を「復元」に差し替える */
  archived?: boolean;
  /** ノートをアーカイブ（一覧から退避、ID は残し派生リンクは保持）するコールバック */
  onArchive?: () => void;
  archiveDisabled?: boolean;
  /** アーカイブから復元するコールバック（archived のときに表示） */
  onRestore?: () => void;
  /** このノートがゴミ箱にあるか。true ならメニューを「ゴミ箱から復元」だけにする */
  trashed?: boolean;
  /** ゴミ箱から復元するコールバック（trashed のときに表示） */
  onRestoreFromTrash?: () => void;
  /** ノート削除（ゴミ箱送り）コールバック */
  onDelete?: () => void;
  deleteDisabled?: boolean;
  /** team-shared storage への共有（Phase 2a）。未設定時は undefined */
  onShare?: () => void;
  shareDisabled?: boolean;
  /** 既に共有済みか（メニュー表記が「共有」「再共有」に変わる） */
  isShared?: boolean;
  /** Share 処理中（spinner 表示用） */
  shareBusy?: boolean;
  /** Shared が無効な理由（disabled 時のヒント表示用） */
  shareDisabledReason?: string;
  /** このノートへのリンク（URL）をクリップボードにコピーする。別ノートに貼るとメンション化される。 */
  onCopyLink?: () => void;
  /** 本文をフル幅表示しているか（Notion の Full width 相当）。ON でチェックを表示 */
  fullWidth?: boolean;
  /** フル幅表示の切り替え。undefined なら項目ごと隠す（アーカイブ/ゴミ箱ノート） */
  onToggleFullWidth?: () => void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const itemClass =
    "w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={t("common.menu")}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-md py-1 z-50">
          <button
            className={itemClass}
            disabled={saveDisabled}
            onClick={() => { onSave(); setOpen(false); }}
          >
            <Save size={14} />
            {t("common.save")}
          </button>
          {onTakeSnapshot && (
            <button
              className={itemClass}
              title={`${t("version.take")} (⌘⇧S / ⌘⌥S)`}
              onClick={() => { onTakeSnapshot(); setOpen(false); }}
            >
              <Pin size={14} />
              {t("version.take")}
            </button>
          )}
          <button
            className={itemClass}
            disabled={pdfExporting}
            onClick={() => { onExportPdf(); setOpen(false); }}
          >
            <FileDown size={14} />
            {pdfExporting ? t("pdf.exporting") : t("pdf.export")}
          </button>
          <button
            className={itemClass}
            onClick={() => { onExportMarkdown(); setOpen(false); }}
          >
            <FileText size={14} />
            {t("markdown.export")}
          </button>
          <button
            className={itemClass}
            disabled={provExportDisabled}
            onClick={() => { onExportProvJsonLd(); setOpen(false); }}
          >
            <Share2 size={14} />
            {t("prov.export")}
          </button>
          {onToggleFullWidth && (
            <>
              <div className="my-1 border-t border-border" />
              {/* 本文幅の切り替え（Notion の Full width 相当）。ON なら右端にチェック */}
              <button
                className={itemClass}
                onClick={() => { onToggleFullWidth(); setOpen(false); }}
              >
                <MoveHorizontal size={14} />
                <span className="flex-1 text-left">{t("editor.fullWidth")}</span>
                {fullWidth && <Check size={14} className="text-primary" />}
              </button>
            </>
          )}
          {onCopyLink && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                onClick={() => {
                  onCopyLink();
                  setCopied(true);
                  // コピーしたことが分かるよう少し見せてから閉じる
                  setTimeout(() => {
                    setCopied(false);
                    setOpen(false);
                  }, 1000);
                }}
              >
                {copied ? <Check size={14} /> : <Link2 size={14} />}
                {copied ? t("share.linkCopied") : t("share.copyLink")}
              </button>
            </>
          )}
          {onShare && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                disabled={shareDisabled || shareBusy}
                onClick={() => { onShare(); setOpen(false); }}
                title={shareDisabled ? shareDisabledReason : undefined}
              >
                <Share2 size={14} />
                {shareBusy
                  ? t("share.sharing")
                  : isShared
                    ? t("share.reshareToTeam")
                    : t("share.shareToTeam")}
              </button>
            </>
          )}
          {onDeriveWholeNote && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                disabled={deriveDisabled}
                onClick={() => { onDeriveWholeNote(); setOpen(false); }}
              >
                <GitBranch size={14} />
                {t("editor.deriveWholeNote")}
              </button>
            </>
          )}
          {onIngestToWiki && !isWikiDoc && (
            <>
              <div className="my-1 border-t border-border" />
              {inKnowledge ? (
                <button
                  className={itemClass}
                  disabled={!onOpenKnowledge}
                  onClick={() => { onOpenKnowledge?.(); setOpen(false); }}
                >
                  <BookOpen size={14} />
                  {t("knowledge.alreadyInKnowledge")}
                </button>
              ) : (
                <button
                  className={itemClass}
                  disabled={ingestDisabled}
                  onClick={() => { onIngestToWiki(); setOpen(false); }}
                >
                  <BookPlus size={14} />
                  {t("knowledge.addToKnowledge")}
                </button>
              )}
            </>
          )}
          {(() => {
            // trashed / archived / active で退避・復元の導線を出し分ける。
            //   trashed  → 「ゴミ箱から復元」のみ（アーカイブ/削除は出さない）
            //   archived → 「アーカイブから復元」＋削除（ゴミ箱送り）
            //   active   → 「アーカイブ」＋削除
            const showTrashRestore = trashed && !!onRestoreFromTrash;
            const showArchiveRestore = !trashed && archived && !!onRestore;
            const showArchive = !trashed && !archived && !!onArchive;
            const showDelete = !trashed && !!onDelete;
            const anyItem = showTrashRestore || showArchiveRestore || showArchive || showDelete;
            return (
              <>
                {anyItem && <div className="my-1 border-t border-border" />}
                {showTrashRestore && (
                  <button
                    className={itemClass}
                    onClick={() => { onRestoreFromTrash!(); setOpen(false); }}
                    title={t("trash.trashedHint")}
                  >
                    <ArchiveRestore size={14} />
                    {t("trash.restoreFromTrash")}
                  </button>
                )}
                {showArchiveRestore && (
                  <button
                    className={itemClass}
                    onClick={() => { onRestore!(); setOpen(false); }}
                    title={t("archive.restoreHint")}
                  >
                    <ArchiveRestore size={14} />
                    {t("archive.restore")}
                  </button>
                )}
                {showArchive && (
                  <button
                    className={itemClass}
                    disabled={archiveDisabled}
                    onClick={() => { onArchive!(); setOpen(false); }}
                    title={t("editor.archiveNoteHint")}
                  >
                    <Archive size={14} />
                    {t("editor.archiveNote")}
                  </button>
                )}
                {showDelete && (
                  <button
                    className={`${itemClass} text-destructive hover:bg-destructive/10`}
                    disabled={deleteDisabled}
                    onClick={() => { onDelete!(); setOpen(false); }}
                  >
                    <Trash2 size={14} />
                    {t("editor.deleteNote")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── エディタ本体 ──
type NoteEditorProps = {
  fileId: string | null;
  initialDoc: GraphiumDocument | null;
  onSave: (doc: GraphiumDocument) => void;
  onDeriveNote: (title: string, sourceBlockId: string) => void;
  /** `@` メニューの「新規ノートを作成」用。空ノートを作って ID を返す（ナビゲーションしない） */
  onCreateLinkedNote?: (title: string) => Promise<string | null>;
  /** AI 派生ノートを作成し、生成された新ファイル ID を返す */
  onAiDeriveNote: (doc: GraphiumDocument) => Promise<string>;
  /** knowledge ノート（claim/atom）を作成し、新ファイル ID を返す（R2 / Loop M2 の手動取り込み） */
  onCreateKnowledgeNote?: (doc: GraphiumDocument, kind: "claim" | "atom") => Promise<string>;
  onNavigateNote: (noteId: string, cachedDoc?: GraphiumDocument) => void;
  /**
   * ノート右パネルの Graph タブから素材ノードクリックされたときの遷移ハンドラ。
   * Material gallery に切り替えて該当 fileId を Full view で開く想定。
   * 未指定なら graph 上のメディアノードは反応しない（旧 blob: open はやめた）。
   */
  onOpenMedia?: (fileId: string) => void;
  /**
   * memo:<captureId> ソース（References の @ラベル・グラフ・来歴）クリック時に
   * メモギャラリーの該当メモ詳細を開くハンドラ。未指定なら memo: は無反応。
   */
  onOpenMemoSource?: (captureId: string) => void;
  /** ドキュメントキャッシュ検索（サイドピーク即表示用） */
  getCachedDoc?: (noteId: string) => GraphiumDocument | undefined;
  onRefreshFiles: () => void;
  saving: boolean;
  files: GraphiumFile[];
  noteGraphData: NoteGraphData;
  lineageTree: LineageNode | null;
  /** 派生元ノート（Split View 用、NoteApp が管理） */
  sourceDoc: GraphiumDocument | null;
  onSourceDocChange: (doc: GraphiumDocument | null) => void;
  /** ノートインデックス（@ オートコンプリート用） */
  noteIndex?: GraphiumIndex | null;
  /** アーカイブ・ゴミ箱込みの全件インデックス。履歴パネルの取り込みソース解決で、
   *  重複統合後にアーカイブされた吸収元のタイトルも引けるようにする。 */
  rawNoteIndex?: GraphiumIndex | null;
  /** 来歴ラベル機能（手順の PROV 化）が有効か。false なら全ラベル UI を描画しない。 */
  provLabelsEnabled?: boolean;
  /** 文脈候補（タグ）を全ノートから削除する（ヘッダ文脈ピッカーのゴミ箱）。削除したら true を返す。 */
  onDeleteContextEverywhere?: (value: string) => boolean | Promise<boolean>;
  /** メディアアップロード関数（メディアインデックス自動登録付き） */
  uploadFile?: (file: File) => Promise<string>;
  /**
   * 素材アップロード（fileId まで返す版）。
   * uploadFile は URL しか返さないため、登録した素材の fileId を控えたい経路
   * （データ取り込み → tableMeta.source.fileId）はこちらを使う。
   */
  uploadAsset?: (
    file: File,
  ) => Promise<{ url: string; fileId: string; entry: MediaIndexEntry }>;
  /** メディアインデックス（メディアピッカー用） */
  mediaIndex?: import("./features/asset-browser").MediaIndex | null;
  /** URL ブックマーク登録コールバック */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  /** メモ挿入リクエスト（メモギャラリーから） */
  pendingMemoInsert?: { text: string } | null;
  /** メモ挿入完了コールバック */
  onMemoInserted?: () => void;
  /** メモピッカー用のキャプチャインデックス */
  captureIndex?: import("./features/mobile-capture").CaptureIndex | null;
  /** 右パネル「Memos」タブからメモを追加する（sourceNote は NoteApp 側で付与） */
  onCreateNoteMemo?: (
    text: string,
    block?: { blockId: string; blockText: string },
  ) => void | Promise<void>;
  /** 右パネル「Memos」タブからメモを削除する */
  onDeleteNoteMemo?: (memoId: string) => void;
  /** エディタ参照を親に伝播するコールバック */
  onEditorRef?: (editor: any) => void;
  /** Knowledge に追加コールバック */
  onIngestToWiki?: () => void;
  /** URL から Knowledge コールバック */
  onIngestFromUrl?: () => void;
  /** ノート全体を派生コールバック（ヘッダーメニューから呼ばれる） */
  onDeriveWholeNote?: () => void;
  /** 手動で残した版を下敷きに新ノートを派生する（履歴パネルの版行から呼ばれる） */
  onDeriveSnapshot?: (snapshotId: string) => void;
  /** 版の内容で現在のドキュメントを上書きする（スキルの履歴パネルから呼ばれる） */
  onRestoreSnapshot?: (snapshotId: string) => void;
  /** 派生処理中（ボタンを無効化） */
  derivingDisabled?: boolean;
  /** ノート削除（ゴミ箱送り）コールバック。ヘッダーメニューから呼ばれる */
  onDeleteNote?: () => void;
  /** ノートアーカイブ（一覧から退避）コールバック。ヘッダーメニューから呼ばれる */
  onArchiveNote?: () => void;
  /** チャットから Knowledge コールバック（手動） */
  onIngestChat?: (messages: import("./lib/document-types").ChatMessage[]) => void;
  /** Wiki ドキュメントかどうか */
  isWikiDoc?: boolean;
  /** AI バックエンドが利用可能か（false なら Chat タブを非表示） */
  aiAvailable?: boolean;
  /** AI モデルが 1 件以上登録済みか。false なら Chat タブ・エディタ内 AI ボタン・
   *  Knowledge チップ等の AI UI を非表示にする（バックエンド到達性とは別軸）。
   *  aiAvailable=false かつ Tauri の「診断用に Chat タブを残す」分岐とは独立に効く。 */
  agentConfigured?: boolean;
  /** ローカル Skill のプロンプト（AI チャットに注入） */
  skillPrompts?: string;
  /** Cmd+K Composer を開くコールバック（空ノート予示の ⌘K チップから呼ばれる） */
  onOpenComposer?: () => void;
  /** Composer 送信をノートスコープで受けるための imperative ref。
   *  NoteApp 側で ref を作り、NoteEditorInner が useEffect でハンドラを登録する。
   *  ノート未開時は null のままになり、NoteApp はそれを検知して no-op 扱いする。 */
  composerSubmitRef?: React.MutableRefObject<
    ((submission: ComposerSubmission) => void | Promise<void>) | null
  >;
  /** アーカイブ済みドキュメントの場合 true。エディタを read-only にする */
  archived?: boolean;
  /** アーカイブから復元するコールバック（archived のときヘッダーメニュー / バナーから呼ぶ） */
  onRestoreFromArchive?: () => void;
  /** 任意のノート ID がアーカイブ済みか判定する述語。SidePeek（グラフ/リンク経由で開く
   *  別ノート）が read-only / バナー表示を出し分けるのに使う。NoteEditor が受け取る
   *  noteIndex はアーカイブを除外済みのため、判定にはこの述語が必要。 */
  isArchived?: (noteId: string) => boolean;
  /** SidePeek で開いたアーカイブ済みノートを ID 指定で復元するコールバック */
  onRestoreArchivedById?: (noteId: string) => void;
  /** ゴミ箱にあるドキュメントの場合 true。エディタを read-only にする。
   *  ゴミ箱ノートはノートリンク / @mention / インデックステーブル経由で開けてしまうため、
   *  開いても壊れないよう read-only + バナーで「ゴミ箱にある」ことを明示する。 */
  trashed?: boolean;
  /** ゴミ箱から復元するコールバック（trashed のときヘッダーメニュー / バナーから呼ぶ） */
  onRestoreFromTrash?: () => void;
  /** 任意のノート ID がゴミ箱にあるか判定する述語（SidePeek 用。isArchived と同じ理由）。 */
  isTrashed?: (noteId: string) => boolean;
  /** SidePeek で開いたゴミ箱ノートを ID 指定で復元するコールバック */
  onRestoreTrashedById?: (noteId: string) => void;
  /** SidePeek がストレージ保存に成功したとき、保存済み doc で doc キャッシュと
   *  インデックスを最新化する（fm.reindexNoteFromDoc）。これが無いと、ピークを
   *  閉じて再オープンしたとき stale な cachedDoc が表示され、そこからの保存で
   *  旧タイトルがディスクへ書き戻される。 */
  onPeekSaved?: (noteId: string, savedDoc: GraphiumDocument) => void;
  /** ピークでのタイトル変更を、@メンションで参照している他ノートの本文ラベルへ
   *  伝播する（fm.propagateMentionRename）。skipNoteIds はライブエディタで開いて
   *  いるためファイル書き換えではなくエディタ内で直接更新するノート。 */
  onPropagateMentionRename?: (
    renamedNoteId: string,
    oldTitle: string,
    newTitle: string,
    opts?: { skipNoteIds?: string[] },
  ) => Promise<void>;
  /** Phase 4: PROV-JSON-LD エクスポートに含める Wiki Knowledge Layer のメタ。
   *  NoteApp が wiki state から組み立てて渡す。空配列 / undefined のときは
   *  Wiki Entity を出力しない（ノートの PROV だけになる）。 */
  provWikiEntities?: WikiEntityInfo[];
  /** WikiBanner 等の外部 UI から SidePeek を開くための ref。
   *  NoteEditorInner が useEffect で setSidePeekNoteId を登録する。
   *  composerSubmitRef と同じ流儀。 */
  openSidePeekRef?: React.MutableRefObject<((noteId: string) => void) | null>;
  /**
   * NoteApp 側から素材サイドピークを開くための命令口（openSidePeekRef と同じ流儀）。
   * memo: ソースのその場プレビュー（メモピーク）で使う。
   */
  openMaterialPeekRef?: React.MutableRefObject<((entry: MediaIndexEntry) => void) | null>;
  /** 現在開いているノートの引用（knowledge link）数を取得する ref。
   *  Composer の verb メニュー出し分け（J1.5）に使う。composerSubmitRef と同じ流儀。 */
  composerCitationRef?: React.MutableRefObject<(() => number) | null>;
  /** 実行中チャット run（chat-run-manager）の完了をライブ store に反映するための ref。
   *  NoteApp のディスパッチャが、完了時に元ノートが開かれていればこのハンドル経由で
   *  store へ反映する。NoteEditorInner が useEffect で登録する（composerSubmitRef と
   *  同じ流儀）。 */
  chatRunApplyRef?: React.MutableRefObject<ChatRunApplyHandle | null>;
  /**
   * タイトルバー直下に挟みたい UI（WikiBanner / SkillBanner 等）。
   * 2026-05-22 デザイン議論 D1 案: バナーは title bar の下に置いて、ノートと一貫した
   * 「title bar が最上段」レイアウトを保つ。
   */
  subHeaderSlot?: React.ReactNode;
  /**
   * 本文「下」に展開する関連・文脈 UI（WikiContextDrawer 用、D2 配置）。
   * identity は subHeaderSlot / 本文上に残し、relational なセクションは本文の後ろに
   * 置くことで縦の圧迫を抑える。空のときは呼び出し側が null を渡す。
   */
  contextDrawerSlot?: React.ReactNode;
};

function NoteEditor(props: NoteEditorProps) {
  return (
    <ProvLabelsEnabledProvider enabled={props.provLabelsEnabled ?? true}>
    <LabelStoreProvider>
      <LinkStoreProvider>
        <TableMetaStoreProvider>
        <MediaInlineLabelProvider>
        <MediaOcrProvider>
        <BlockAlignmentProvider>
        {/* モデル未登録（agentConfigured=false）ならエディタ内 AI ボタン群
            （フォーマッティングツールバー / ドラッグメニュー / 選択ツールバーの Bot）も隠す */}
        <AiAssistantProvider aiAvailable={(props.aiAvailable ?? true) && (props.agentConfigured ?? true)}>
          <NoteEditorInner {...props} />
        </AiAssistantProvider>
        </BlockAlignmentProvider>
        </MediaOcrProvider>
        </MediaInlineLabelProvider>
        </TableMetaStoreProvider>
      </LinkStoreProvider>
    </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

// BlockNote スキーマに存在しないブロック型を再帰的に除去する
// 保存済みノートに未登録ブロック（sampleScope 等）が含まれる場合のクラッシュ防止
// 既知の型は src/blocks/registry.ts の KNOWN_BLOCK_TYPES に集約している
// （標準ブロック＋カスタムブロック登録から自動導出）。

// インラインコンテンツから未知の型を除去（mention 等）
// 既知の型は registry.ts の KNOWN_INLINE_TYPES に集約している
// （ここに直接書き足すとブロック側と同じ「片方だけ取りこぼす」事故になる）。

/**
 * まだ画面に生きているエディタか（DOM が繋がっているか）。
 *
 * ノートを切り替えるとエディタは作り直されるが、ピッカーやダイアログが
 * 掴んだ参照は古いインスタンスのまま残る。そこへ挿入しても画面には出ず、
 * 「操作したのに何も起きない」状態になるので、使う直前に確かめる。
 */
function liveEditor(candidate: any): any | null {
  return candidate?.domElement?.isConnected ? candidate : null;
}

function sanitizeInlineContent(content: any): any {
  if (!content) return content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => !c.type || KNOWN_INLINE_TYPES.has(c.type))
      .map((c: any) => {
        // 未知の型をテキストにフォールバック
        if (c.type && !KNOWN_INLINE_TYPES.has(c.type)) {
          return { type: "text", text: c.props?.label ?? c.text ?? "", styles: {} };
        }
        return c;
      });
  }
  return content;
}

// 未知ブロックの除去 + カラム構造の修復は registry の sanitizeBlocksForLoad に
// 集約（SidePeek と共用）。メインエディタは inline content の検査も併せて行う。
function sanitizeBlocks(blocks: any[]): any[] {
  return sanitizeBlocksForLoad(blocks, sanitizeInlineContent);
}

// wiki:/skill: プレフィックス付きフルキーで doc を読む（キャッシュ優先）。
// saveNoteDoc（保存側のプレフィックス振り分け）と対になる読み込みヘルパーで、
// チャット run の書き戻し（閉じられたノートの doc.chats 更新）が使う。
async function loadNoteDocByFullKey(
  fullKey: string,
  getCachedDoc?: (noteId: string) => GraphiumDocument | undefined,
): Promise<GraphiumDocument | null> {
  const cached = getCachedDoc?.(fullKey);
  if (cached) return cached;
  const provider = getActiveProvider();
  try {
    if (fullKey.startsWith("wiki:")) {
      return (await provider.loadWikiFile?.(fullKey.slice(5))) ?? null;
    }
    if (fullKey.startsWith("skill:")) {
      return (await provider.loadSkillFile?.(fullKey.slice(6))) ?? null;
    }
    return await provider.loadFile(fullKey);
  } catch {
    return null;
  }
}

/**
 * Atom reinforcement（支持追加）— discovery の重複候補を捨てずに、一致した既存 Atom の
 * derivedFromClaims へ新しい支持 Claim を取り込む（Atom の成長経路）。
 * 本文は変えない（育った支持集合は次の re-lift / regenerate で本文に反映される）ので
 * embedding の再計算も不要。取り込みに成功した Atom 数を返す。
 */
async function applyAtomReinforcement(opts: {
  // note-app には sampling 用の同名 AtomCandidate（クラスタ候補）があるため、
  // wiki-service の Atom 候補は構造的型で受ける
  duplicates: { candidate: { title: string; derivedFromClaims: string[] }; matchedDocId: string; score?: number }[];
  loadDoc: (key: string) => Promise<GraphiumDocument | null>;
  saveWikiFile: (id: string, doc: GraphiumDocument, options?: { activityType?: import("./features/document-provenance/types").EditActivityType; sources?: string[] }) => Promise<boolean>;
}): Promise<number> {
  let reinforced = 0;
  for (const dup of opts.duplicates) {
    try {
      const existing = await opts.loadDoc(`wiki:${dup.matchedDocId}`);
      if (!existing) continue;
      const result = reinforceAtomWithClaims(existing, dup.candidate);
      if (!result) continue; // 新しい支持 Claim なし → 従来どおり捨てるだけ
      // handleSaveWikiFile は savingRef（エディタ autosave と共有）が塞がっていると
      // false でスキップする。短い保存往復との衝突なので少し待ってリトライし、
      // それでも保存できなければ成功として数えない（偽成功ログを残さない）。
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
        saved = await opts.saveWikiFile(dup.matchedDocId, result.doc, {
          activityType: "wiki_reinforce",
          sources: result.addedClaimIds,
        });
      }
      if (!saved) continue;
      wikiLog.append(
        "merge",
        [dup.matchedDocId],
        `Reinforced "${existing.title}" with ${result.addedClaimIds.length} new claim(s) (folded duplicate "${dup.candidate.title}")`,
        // 監査用: embedding 一致のスコアを残す（偽陽性の事後調査に使う）
        dup.score !== undefined ? { matchScore: dup.score, candidateTitle: dup.candidate.title } : undefined,
      ).catch(() => {});
      reinforced += 1;
    } catch {
      // 支持追加の失敗は無視（従来どおり重複候補が捨てられるだけで、既存動作は壊れない）
    }
  }
  return reinforced;
}

function NoteEditorInner({
  fileId,
  initialDoc,
  onSave,
  onDeriveNote,
  onCreateLinkedNote,
  onAiDeriveNote,
  onCreateKnowledgeNote,
  onNavigateNote,
  onOpenMedia,
  onOpenMemoSource,
  openMaterialPeekRef,
  onRefreshFiles,
  saving,
  files,
  noteGraphData,
  lineageTree,
  sourceDoc,
  onSourceDocChange,
  getCachedDoc,
  noteIndex,
  rawNoteIndex,
  onDeleteContextEverywhere,
  uploadFile,
  uploadAsset,
  mediaIndex,
  onAddUrlBookmark,
  pendingMemoInsert,
  onMemoInserted,
  captureIndex: captureIndexProp,
  onCreateNoteMemo,
  onDeleteNoteMemo,
  onEditorRef,
  onIngestToWiki,
  onIngestFromUrl,
  onDeriveWholeNote,
  onDeriveSnapshot,
  onRestoreSnapshot,
  derivingDisabled,
  onDeleteNote,
  onArchiveNote,
  onIngestChat,
  isWikiDoc,
  aiAvailable = true,
  agentConfigured = true,
  skillPrompts,
  onOpenComposer,
  composerSubmitRef,
  archived = false,
  onRestoreFromArchive,
  isArchived,
  onRestoreArchivedById,
  trashed = false,
  onRestoreFromTrash,
  isTrashed,
  onRestoreTrashedById,
  onPeekSaved,
  onPropagateMentionRename,
  provWikiEntities,
  openSidePeekRef,
  composerCitationRef,
  chatRunApplyRef,
  subHeaderSlot,
  contextDrawerSlot,
}: NoteEditorProps) {
  const provLabelsEnabled = useProvLabelsEnabled();
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const { removeBlockMetadata } = useBlockLifecycle();
  const tableMetaStore = useTableMetaStore();
  // handleContentChange（useCallback）から最新の注釈を読むための ref
  const tableMetaStoreRef = useRef(tableMetaStore);
  tableMetaStoreRef.current = tableMetaStore;
  const mediaInlineLabelStore = useMediaInlineLabelStore();
  const mediaOcrStore = useMediaOcrStore();
  const blockAlignmentStore = useBlockAlignmentStore();
  // 貼られた画像の自動 OCR。handleContentChange から呼ぶが、その useCallback は
  // hook より前に定義されるため ref 経由で最新の scan を渡す。
  const autoOcrRef = useRef<(() => void) | null>(null);
  const aiAssistant = useAiAssistant();
  const isDesktop = useIsDesktop();
  // チャット実行（chat-run-manager）用のノート識別子。doc キャッシュ・saveNoteDoc と
  // 同じ「wiki:/skill: プレフィックス込みフルキー」。未採番の新規ノートは null。
  const chatStorageId = fileId
    ? initialDoc?.source === "ai"
      ? `wiki:${fileId}`
      : initialDoc?.source === "skill"
        ? `skill:${fileId}`
        : fileId
    : null;
  // 未採番の新規ノートで開始したチャット run。オートセーブでファイル id が
  // 確定したら chat-run-manager に書き戻し先を補完する
  const pendingNoteIdRunsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!chatStorageId || pendingNoteIdRunsRef.current.length === 0) return;
    for (const runId of pendingNoteIdRunsRef.current) {
      chatRunManager.assignNoteId(runId, chatStorageId);
    }
    pendingNoteIdRunsRef.current = [];
  }, [chatStorageId]);
  const editorRef = useRef<any>(null);
  // picker callbacks をエディタ単位で登録するために、エディタ実体を state でも持つ。
  // editorRef.current は ref なので useEffect の依存に乗せられない。
  const [mainEditor, setMainEditor] = useState<any>(null);
  // スラッシュメニューのピッカー（media / bookmark / memo）が
  // どのエディタから呼ばれたかを記憶する。SidePeek からも同じ slash
  // items を使うため、選択結果を呼び出し元のエディタに挿入する必要がある。
  const pickerEditorRef = useRef<any>(null);
  // このノートを派生元として参照する wiki エントリ（Knowledge 化済み判定用）
  const knowledgeMap = useMemo(() => buildKnowledgeMap(noteIndex ?? null), [noteIndex]);
  const wikiEntriesForCurrentNote: NoteIndexEntry[] = fileId ? (knowledgeMap.get(fileId) ?? []) : [];
  // AI 回答をノートへ挿入する際、`[Source: "title"]` を青い @title mention に変換するための
  // title → wikiNoteId 逆引き。resolveMentionNoteId（@ クリックの解決元）と同じく noteIndex の
  // AI ノート（Wiki）から引くことで、挿入後のクリック解決とグラフの reference エッジを整合させる。
  const wikiTitleToNoteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of noteIndex?.notes ?? []) {
      if (n.source === "ai" && n.title) map.set(n.title, n.noteId);
    }
    return map;
  }, [noteIndex]);
  // 履歴パネル（成長タイムライン）の取り込みソース解決。
  // EditActivity.used の ID を表示ラベルと SidePeek で開ける ID に解決する。
  // アーカイブ済み（重複統合の吸収元など）も引けるよう rawNoteIndex を優先する。
  const revisionSourceIndex = useMemo(() => {
    const map = new Map<string, { title: string; wikiKind?: string }>();
    for (const n of (rawNoteIndex ?? noteIndex)?.notes ?? []) {
      map.set(n.noteId, { title: n.title, wikiKind: n.wikiKind });
    }
    return map;
  }, [rawNoteIndex, noteIndex]);
  const resolveRevisionSource = useCallback(
    (id: string) => {
      const ext = parseExternalSource(id);
      if (ext) return { label: ext.key, kind: ext.kind };
      const entry = revisionSourceIndex.get(id);
      if (entry) {
        return {
          label: entry.title || id,
          kind: entry.wikiKind ? "wiki" : "note",
          openId: entry.wikiKind ? `wiki:${id}` : id,
        };
      }
      // インデックスに無い（完全削除済み等）→ 生 ID を短縮表示
      return { label: `${id.slice(0, 8)}…`, kind: "note" };
    },
    [revisionSourceIndex],
  );
  // ペーストされたノートリンク（#note/<id>）を現在のタイトルへ解決する。
  // paste リスナーの closure が stale にならないよう、ref 経由で最新の noteIndex/files を参照する。
  const resolveNoteLinkTitleRef = useRef<(fileId: string) => string | null>(() => null);
  resolveNoteLinkTitleRef.current = (fileId: string) => {
    const entry = noteIndex?.notes.find((n) => n.noteId === fileId);
    if (entry) return entry.title;
    const f = files.find((file) => file.id === fileId);
    if (f) return f.name.replace(/\.(graphium|provnote)\.json$/, "");
    return null;
  };
  const [sidePeekNoteId, setSidePeekNoteId] = useState<string | null>(null);
  // @ メニューの「新しいノートを作成」で名前を入力するダイアログ（IME 安全）
  const { promptNoteName, dialog: newNoteNameDialog } = useNewNoteNamePrompt();
  // @ で引用したドキュメント素材（PDF/docx）をクリックしたときに開く素材サイドピーク
  const [materialSidePeekEntry, setMaterialSidePeekEntry] = useState<MediaIndexEntry | null>(null);
  // ピーク保存後のフック: 親のキャッシュ/インデックス更新（onPeekSaved）に加え、
  // タイトルが変わっていたら @メンションのラベルを参照元ノートへ伝播する。
  // このエディタで開いているノート自身はファイル書き換えの対象から外し、ライブの
  // エディタを直接更新する（ファイル直書きは次のオートセーブが旧内容で上書きして
  // 巻き戻るため）。updateBlock は onChange を発火させるので、変更は通常の
  // オートセーブ経路で永続化される。
  const handlePeekSaved = useCallback(
    (peekId: string, savedDoc: GraphiumDocument) => {
      // skill はインデックス非掲載で @メンション候補に出ない = 参照が存在しないため
      // 伝播不要。wiki はリンクレコード上 raw id で参照されるのでプレフィックスを剥がす。
      const isSkill = peekId.startsWith("skill:");
      const isWiki = peekId.startsWith("wiki:");
      const rawPeekId = peekId.replace(/^(wiki|skill):/, "");
      // 旧タイトルは reindex 前のキャッシュ / インデックスから取る
      const prevTitle = isSkill
        ? undefined
        : getCachedDoc?.(peekId)?.title ??
          noteIndex?.notes.find((n) => n.noteId === rawPeekId)?.title;
      onPeekSaved?.(peekId, savedDoc);
      if (isSkill || !prevTitle || prevTitle === savedDoc.title) return;
      void onPropagateMentionRename?.(peekId, prevTitle, savedDoc.title, {
        skipNoteIds: fileId ? [fileId] : undefined,
      });
      const editor = editorRef.current;
      if (!editor) return;
      const patterns = buildMentionPatterns(prevTitle, savedDoc.title, {
        includeWikiLabels: isWiki,
      });
      const allLinks = linkStore.getAllLinks();
      const blockIds = new Set<string>();
      const blockTargets = new Map<string, Set<string>>();
      for (const l of allLinks) {
        if (!l.sourceBlockId || !l.targetNoteId) continue;
        let set = blockTargets.get(l.sourceBlockId);
        if (!set) blockTargets.set(l.sourceBlockId, (set = new Set()));
        set.add(l.targetNoteId);
        if (l.targetNoteId === rawPeekId) blockIds.add(l.sourceBlockId);
      }
      // 同名曖昧ガード（applyMentionRenameToDoc と同じ基準）: 同じブロックに
      // 「別ノートだが現タイトルが旧タイトルと同じ」参照が同居していたら触らない
      for (const l of allLinks) {
        if (!l.sourceBlockId || !blockIds.has(l.sourceBlockId)) continue;
        if (l.targetNoteId && l.targetNoteId !== rawPeekId) {
          const t = noteIndex?.notes.find((n) => n.noteId === l.targetNoteId)?.title;
          if (t === prevTitle) blockIds.delete(l.sourceBlockId);
        }
      }
      for (const bid of blockIds) {
        try {
          const block = editor.getBlock?.(bid);
          if (!block || !Array.isArray(block.content)) continue;
          const nc = rewriteMentionRunsForBlock(block.content, patterns, {
            uniqueFallback: blockTargets.get(bid)?.size === 1,
          });
          if (nc) editor.updateBlock(block, { content: nc });
        } catch {
          // ブロックが削除済み等は無視（伝播はベストエフォート）
        }
      }
    },
    [onPeekSaved, onPropagateMentionRename, fileId, noteIndex, getCachedDoc, linkStore],
  );
  // メインのタイトルリネームをピーク側の本文へライブ反映するための命令口。
  // SidePeek がここに実装を登録する（openSidePeekRef と同じ流儀）。
  const peekMentionRenameRef = useRef<
    | ((rawRenamedId: string, oldTitle: string, newTitle: string, includeWikiLabels: boolean) => void)
    | null
  >(null);
  const noteLinksRef = useRef<NoteLink[]>(initialDoc?.noteLinks ?? []);
  // @ で引用したドキュメント素材（PDF/docx）の fileId 配列。保存時に doc へ書き出す。
  const citedAssetFileIdsRef = useRef<string[]>(initialDoc?.citedAssetFileIds ?? []);
  // ノートの文脈ラベル（ユーザーが手で付ける分類）。ヘッダのピルから編集する。
  // 本文と同じ buildDocument → autosave 経路で保存するため ref も併置（stale closure 回避）。
  const [noteContexts, setNoteContexts] = useState<string[]>(initialDoc?.noteContexts ?? []);
  const noteContextsRef = useRef<string[]>(initialDoc?.noteContexts ?? []);
  // 本文フル幅（Notion の Full width 相当）。ノート単位で doc に保存する。
  // buildDocument はスクラッチで組むため ref も併置（noteContexts と同じ流儀）。
  const [fullWidth, setFullWidth] = useState<boolean>(initialDoc?.fullWidth ?? false);
  const fullWidthRef = useRef<boolean>(initialDoc?.fullWidth ?? false);
  const [headerContextPickerPos, setHeaderContextPickerPos] = useState<{ top: number; left: number } | null>(null);
  // 前回保存時のページ状態（差分計算用）
  const prevPageRef = useRef<import("./lib/document-types").GraphiumPage | null>(
    initialDoc?.pages[0] ?? null,
  );
  // 最新の documentProvenance（保存ごとに更新）
  const [currentProvenance, setCurrentProvenance] = useState(
    initialDoc?.documentProvenance ?? undefined,
  );
  // AI 挿入直後フラグ（次回保存を ai_generation として記録）
  const lastAiInsertRef = useRef(false);
  // 履歴ハイライト対象ブロック ID
  const [highlightBlockIds, setHighlightBlockIds] = useState<string[]>([]);
  // ブロックハイライト: 動的 <style> タグで対象ブロックの背景色を変更
  useEffect(() => {
    const styleId = "doc-provenance-highlight";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (highlightBlockIds.length === 0) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const selectors = highlightBlockIds
      .map((id) => `[data-id="${id}"][data-node-type="blockOuter"]`)
      .join(",\n");
    styleEl.textContent = `${selectors} {
  background: rgba(59, 130, 246, 0.08);
  border-left: 2px solid rgba(59, 130, 246, 0.5);
  transition: background 0.2s ease;
}`;
    return () => { styleEl?.remove(); };
  }, [highlightBlockIds]);
  // @ トリガー時のカーソル位置を保存（ドロップダウン表示後は DOM から取れなくなるため）
  const mentionContextRef = useRef<{ tableBlockId: string | null; rowIndex: number }>({ tableBlockId: null, rowIndex: -1 });
  // 右パネル: null = 閉じた状態（アイコンレールのみ表示）
  const [rightTab, setRightTab] = useState<"graph" | "prov" | "chat" | "history" | "source" | "memos" | null>(null);
  // ブロックメニュー「メモ」から開くブロック紐付きメモ入力（null = 閉）
  const [blockMemoTarget, setBlockMemoTarget] = useState<{ blockId: string; blockText: string } | null>(null);
  const [blockMemoSubmitting, setBlockMemoSubmitting] = useState(false);
  // アイコンレールのトグル: 同じタブクリックで閉じる
  const toggleRightTab = useCallback((tab: "graph" | "prov" | "chat" | "history" | "source" | "memos") => {
    setRightTab((prev) => prev === tab ? null : tab);
    if (tab !== "history") setHighlightBlockIds([]);
  }, []);
  // PROV パネル自動オープンを 1 ノートあたり 1 回に絞るための記憶
  const provAutoOpenedRef = useRef(false);
  const t = useT();
  const [title, setTitle] = useState(initialDoc?.title || tStatic("editor.newNote"));

  // ── PDF エクスポート（状態のみ — ハンドラーは provDoc 宣言後） ──
  const [pdfExporting, setPdfExporting] = useState(false);
  /** 準備が長引いたときだけ立てる。メニューの中の「準備中...」は開き直さないと見えないため。 */
  const [printPreparing, setPrintPreparing] = useState(false);

  // ── メディアピッカー ──
  const [pickerMediaType, setPickerMediaType] = useState<MediaType | null>(null);

  // ── メモピッカーモーダル ──
  const [memoPickerOpen, setMemoPickerOpen] = useState(false);

  // ── 引用ピッカー (/claims, /Insights) ──
  const [citePickerKind, setCitePickerKind] = useState<CitePickerKind | null>(null);
  const [sharedCitePickerOpen, setSharedCitePickerOpen] = useState(false);

  // ── データ取り込み（区切りテキスト → テーブル） ──
  // スラッシュメニュー・ドロップ・素材ギャラリーの 3 経路が同じダイアログに集まる。
  // 開いている間はファイルの中身を持つ（ダイアログ内で範囲や区切りを変えるたびに
  // 再パースするため、File ではなくデコード済みテキストで持つ）。
  const [dataImportFile, setDataImportFile] = useState<
    {
      fileName: string;
      text: string;
      fileId?: string;
      /** 素材未登録のファイル実体（確定時に素材として登録する） */
      file?: File;
      /** 再取り込み時に置き換える対象のテーブルブロック */
      replaceBlockId?: string;
      /** 再取り込み時に復元する前回の設定 */
      initialOptions?: DelimitedImportOptions;
    } | null
  >(null);

  // ── チャートの「素材のデータから」 ──
  // チャートブロックがピッカー（データ素材）→ 取り込みダイアログを求めてきたときの
  // 受け皿。確定結果はブロック側の onDone に返し、こちらは系列を触らない。
  const [chartAssetRequest, setChartAssetRequest] = useState<{
    onDone: (result: ChartAssetSourceResult) => void;
  } | null>(null);

  // スラッシュメニューからピッカーを開くコールバック登録（main editor 用）。
  // SidePeek からは SidePeek 自身が同じ仕組みで登録する。
  useEffect(() => {
    if (!mainEditor) return;
    setMediaPickerCallback(mainEditor, (type) => {
      pickerEditorRef.current = mainEditor;
      setPickerMediaType(type);
    });
    setChartAssetSourceCallback(mainEditor, (onDone) => {
      setChartAssetRequest({ onDone });
    });
    setMemoPickerCallback(mainEditor, () => {
      pickerEditorRef.current = mainEditor;
      setMemoPickerOpen(true);
    });
    setBookmarkPickerCallback(mainEditor, () => {
      pickerEditorRef.current = mainEditor;
      setUrlSlashPickerOpen(true);
    });
    setCitePickerCallback(mainEditor, (kind) => {
      pickerEditorRef.current = mainEditor;
      setCitePickerKind(kind);
    });
    setSharedCitePickerCallback(mainEditor, () => {
      pickerEditorRef.current = mainEditor;
      setSharedCitePickerOpen(true);
    });
    return () => {
      setMediaPickerCallback(mainEditor, null);
      setChartAssetSourceCallback(mainEditor, null);
      setMemoPickerCallback(mainEditor, null);
      setBookmarkPickerCallback(mainEditor, null);
      setCitePickerCallback(mainEditor, null);
      setSharedCitePickerCallback(mainEditor, null);
    };
  }, [mainEditor]);

  // ブックマークカードのクリック → URL 素材としてサイドピークで開く。
  // 既存の URL 素材があればそれを、無ければ URL からアドホックなエントリを組み立てる。
  // mediaIndex を最新に保つため専用の effect（picker 登録とは別依存）にする。
  useEffect(() => {
    if (!mainEditor) return;
    setBookmarkPeekCallback(mainEditor, (url) => {
      if (!url) return;
      setMaterialSidePeekEntry(buildUrlPeekEntry(url, mediaIndex ?? null));
    });
    return () => {
      setBookmarkPeekCallback(mainEditor, null);
    };
  }, [mainEditor, mediaIndex]);

  // スラッシュメニューからテンプレートピッカーを開くコールバック登録
  useEffect(() => {
    setTemplatePickerCallback((triggerBlock: any) => {
      templateTriggerBlockRef.current = triggerBlock;
      setTemplatePickerOpen(true);
    });
    return () => { setTemplatePickerCallback(null); };
  }, []);

  // テーブルブロックの先頭列にふるまいを付ける（先頭列の名前をキーに tableMeta へ記録）。
  // スラッシュメニューのインデックス/時系列テーブル挿入と、テンプレート適用（columnTypes）
  // が同じ経路を通る — どちらも「挿入した表の先頭列に note-link / datetime-auto を付ける」。
  const addFirstColumnType = useCallback(
    (blockId: string, type: ColumnType) => {
      const block = editorRef.current?.getBlock?.(blockId);
      tableMetaStore.addColumnType(blockId, readFirstColumnName(block), type);
    },
    [tableMetaStore],
  );

  // テンプレートを選択してエディタに挿入
  const handleTemplateSelect = useCallback((templateId: string) => {
    setTemplatePickerOpen(false);
    const editor = editorRef.current;
    if (!editor) return;

    const allTemplates = getAllTemplates();
    const tmpl = allTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;

    const triggerBlock = templateTriggerBlockRef.current ?? editor.getTextCursorPosition()?.block;
    if (!triggerBlock) return;

    const { blocks: rawBlocks, labels: rawLabels, provLinks, columnTypes } = tmpl.build(tStatic);

    // テンプレートは旧語彙（procedure/plan/result ラベル付き見出し）で定義されている。
    // 挿入前に step ブロックへ変換する（工程は step が正。ラベルのまま挿すと
    // v6 済みドキュメントに旧形式が永久残留する）。
    // 変換は block id ベースなので一時 id を振り、provLinks / focusPath は
    // 変換前に id へ解決しておく（変換は id を保存するため、挿入後は id で引ける）。
    const assignIds = (list: any[]) => {
      for (const b of list ?? []) {
        if (b && typeof b === "object") {
          if (!b.id) b.id = crypto.randomUUID();
          if (Array.isArray(b.children)) assignIds(b.children);
        }
      }
    };
    assignIds(rawBlocks);
    const idAtPath = (path: number[]): string | null => {
      let nodes: any[] = rawBlocks;
      let node: any = null;
      for (const idx of path) {
        node = nodes?.[idx];
        if (!node) return null;
        nodes = node.children ?? [];
      }
      return node?.id ?? null;
    };
    const linkIds = (provLinks ?? []).map((l) => ({
      sourceId: idAtPath(l.sourcePath),
      targetId: idAtPath(l.targetPath),
      type: l.type,
    }));
    // テーブルの列のふるまい（計画テンプレートの表を note-link = インデックステーブルにする等）。
    // provLinks と同じく変換前に id へ解決しておく
    const columnTypeIds = (columnTypes ?? []).map((c) => ({
      blockId: idAtPath(c.path),
      type: c.type,
    }));
    const focusId = idAtPath(tmpl.focusPath);
    const { blocks, labels } = convertExtractedProcedureBlocksToSteps(
      rawBlocks,
      rawLabels as any,
    );

    const inserted = editor.insertBlocks(blocks, triggerBlock, "after");

    // スラッシュを打ったブロックが空なら削除
    const content = triggerBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" &&
          content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([triggerBlock]);
    }

    // パスから挿入後のブロックを取得
    const resolveByPath = (path: number[]): any | null => {
      let nodes: any[] = inserted as any[];
      let node: any = null;
      for (const idx of path) {
        node = nodes?.[idx];
        if (!node) return null;
        nodes = node.children ?? [];
      }
      return node;
    };

    // ラベル付与・前手順リンク追加・列のふるまい付与（次フレームに延期して、エディタの
    // 状態反映後に実行）。
    // procedure/plan/result は変換で消費済み。リンクは変換前に解決した id で張る
    // （テンプレの step1→step2 informed_by は、見出し id を引き継いだ step 間に張られる）。
    // 列のふるまいはスラッシュメニューのインデックス/時系列テーブル挿入と同じ関数で付ける。
    if (labels.length > 0 || linkIds.length > 0 || columnTypeIds.length > 0) {
      setTimeout(() => {
        for (const { path, label } of labels) {
          const block = resolveByPath(path);
          if (block?.id) {
            labelStore.setLabel(block.id, label);
          }
        }
        for (const link of linkIds) {
          if (link.sourceId && link.targetId) {
            linkStore.addLink({
              sourceBlockId: link.sourceId,
              targetBlockId: link.targetId,
              type: link.type,
              createdBy: "human",
            });
          }
        }
        for (const { blockId, type } of columnTypeIds) {
          if (blockId) addFirstColumnType(blockId, type);
        }
      }, 0);
    }

    // フォーカスブロックにカーソルを移動（id は変換を跨いで保存される）
    if (focusId) {
      try {
        editor.setTextCursorPosition(focusId, "end");
      } catch {
        /* no-op */
      }
    }

    templateTriggerBlockRef.current = null;
    // insertBlocks による onChange で自動的に markDirty される
  }, [labelStore, linkStore, addFirstColumnType]);

  // スラッシュだけの空ブロックかどうか（"/" もしくは空）。
  const isSlashOnlyBlock = useCallback((block: any) => {
    const content = block?.content;
    return (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    );
  }, []);

  // スラッシュ起点で inline コンテンツ（@リンク / ハイパーリンク）を挿入する。
  // スラッシュだけのブロックなら中身を空にしてカーソル位置に差し込み、
  // 本文があるブロックでは現在のカーソル位置にそのまま挿入する。
  const insertInlineAtSlash = useCallback((editor: any, currentBlock: any, inline: any[]) => {
    if (isSlashOnlyBlock(currentBlock)) {
      editor.updateBlock(currentBlock, { type: "paragraph", content: [] });
    }
    const target = editor.getBlock(currentBlock.id) ?? currentBlock;
    editor.setTextCursorPosition(target, "end");
    setTimeout(() => {
      editor.insertInlineContent(inline);
    }, 0);
  }, [isSlashOnlyBlock]);

  // ピッカーで選択されたメディアをエディタに挿入
  // ピッカーを開いたエディタ（main / SidePeek）に挿入する。
  // displayMode:
  //   "embed" → 中身を展開（pdf / file / image / video / audio ブロック）
  //   "link"  → @素材名 の inline リンク（@mention の asset 分岐と同じく citedAssetFileIds に登録）
  const handlePickerSelect = useCallback((entry: MediaIndexEntry, displayMode: AssetDisplayMode) => {
    const editor = pickerEditorRef.current ?? editorRef.current;
    if (!editor) return;

    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) return;

    if (displayMode === "link") {
      // 素材本体を指す @リンク。fileId を citedAssetFileIds に積むことで
      // Cmd-K / チャットの AI がその素材の全文＋ハイライトメモを読めるようになる。
      if (entry.fileId && !citedAssetFileIdsRef.current.includes(entry.fileId)) {
        citedAssetFileIdsRef.current = [...citedAssetFileIdsRef.current, entry.fileId];
      }
      // insertInlineContent が onChange を発火 → 自動 markDirty。
      // citedAssetFileIdsRef は同期的に更新済みなので、その後の save で拾われる。
      insertInlineAtSlash(editor, currentBlock, [
        { type: "text", text: `@${entry.name}`, styles: { textColor: "blue" } },
        { type: "text", text: " ", styles: {} },
      ]);
      return;
    }

    // 区切りテキスト（.csv / .txt / .dat）は添付として貼らず、取り込みダイアログへ回す。
    // 素材として登録済みのファイルなので fileId が取れる = 生まれた表から
    // 元ファイルの素材へ辿れる（source.fileId）。
    if (isDelimitedDataFile(entry.name)) {
      void (async () => {
        try {
          const provider = getActiveProvider();
          const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
          const blob = await (await fetch(blobUrl)).blob();
          const text = await readDataFileText(blob);
          setPickerMediaType(null);
          setDataImportFile({ fileName: entry.name, text, fileId: entry.fileId });
        } catch {
          alert(tStatic("dataImport.readError"));
        }
      })();
      return;
    }

    // 挿入ブロックの選択:
    //   PDF → カスタム pdf ブロック（インラインビューア付き）
    //   Document (.docx 等) → BlockNote 標準 file ブロック（汎用アタッチメント表示）
    //   それ以外（image/video/audio） → 同名の標準ブロック
    const newBlock = entry.type === "pdf"
      ? { type: "pdf", props: { url: entry.url, name: entry.name } }
      : entry.type === "document"
        ? { type: "file", props: { url: entry.url, name: entry.name } }
        : {
            type: entry.type === "video" ? "video" : entry.type === "audio" ? "audio" : "image",
            props: { url: entry.url, name: entry.name },
          };
    editor.insertBlocks([newBlock], currentBlock, "after");

    // 現在のブロックが空（スラッシュだけ）なら削除
    if (isSlashOnlyBlock(currentBlock)) {
      removeBlockMetadata([currentBlock.id]);
      editor.removeBlocks([currentBlock]);
    }
    // onChange が自動的にトリガーされるので markDirty() は不要
  }, [removeBlockMetadata, isSlashOnlyBlock, insertInlineAtSlash]);

  // データ取り込みダイアログの確定 → テーブルブロックを挿入し、出所を注釈に残す。
  //
  // 表そのものは素の Markdown テーブルのまま（tableMeta の方針どおり）。
  // 「どのファイルの何行目を、どう区切って読んだか」と前置きの測定条件は
  // tableMeta.source に置く。ここを通さずに表だけ作ると、あとから
  // 「この数字はどの生データから来たのか」を辿る手段が無くなる。
  const handleDataImportConfirm = useCallback(
    (
      file: {
        fileName: string;
        fileId?: string;
        replaceBlockId?: string;
        /** 素材未登録のファイル実体（スラッシュメニュー・ドロップ経由） */
        file?: File;
      },
      result: DataImportResult
    ) => {
      setDataImportFile(null);
      // ダイアログを開いてから確定するまでの間にノートを切り替えると、
      // pickerEditorRef はアンマウント済みのエディタを指したままになる。そこへ
      // 挿入すると「取り込んだのに何も出ない」（ブロックは死んだエディタに入り、
      // 注釈だけが共有ストアに残る）。DOM が繋がっている方を選ぶ。
      const editor = liveEditor(pickerEditorRef.current) ?? editorRef.current;
      if (!editor) return;
      const block = toTableBlock(result.parsed);
      if (!block) return;

      // 再取り込みは中身だけ差し替える（ブロック ID を保つので、そのテーブルを
      // 参照しているチャート（sourceBlockId）の参照が切れない）
      let blockId: string | undefined;
      let currentBlock: any = null;
      if (file.replaceBlockId && editor.getBlock(file.replaceBlockId)) {
        editor.updateBlock(file.replaceBlockId, { content: block.content });
        blockId = file.replaceBlockId;
      } else {
        currentBlock = editor.getTextCursorPosition()?.block;
        // カーソルが取れない（ドロップ直後など）ときは末尾に足す
        const anchor = currentBlock ?? editor.document[editor.document.length - 1];
        if (!anchor) return;
        const inserted = editor.insertBlocks([block], anchor, "after");
        blockId = (Array.isArray(inserted) ? inserted[0]?.id : undefined) as
          | string
          | undefined;
      }
      if (blockId) {
        // 再取り込みでは人が付け直した名前を尊重する（既に名前があれば触らない）
        if (!tableMetaStore.getCaption(blockId)) {
          tableMetaStore.setCaption(blockId, defaultCaption(file.fileName));
        }
        tableMetaStore.setSource(
          blockId,
          buildTableSource({
            fileName: file.fileName,
            fileId: file.fileId,
            options: result.options,
            parsed: result.parsed,
          })
        );
      }

      if (currentBlock && isSlashOnlyBlock(currentBlock)) {
        removeBlockMetadata([currentBlock.id]);
        editor.removeBlocks([currentBlock]);
      }
      // ブロック挿入の onChange とは別に、tableMeta（キャプション・出所）の変更も
      // 保存させる必要がある。取り込みは失うと痛い量が一度に入るので、
      // 自動保存の待ち時間を挟まずここで保存する。
      //
      // ただし保存は 1 ティック遅らせる。すぐ上の setCaption / setSource は
      // React の state 更新で、保存が読む metasRef はレンダー後にしか新しく
      // ならない。同じティックで保存すると注釈が空のまま書き出され、直後に
      // 再マウントが挟まると表だけ残って出所が消える。
      markDirtyRef.current();
      setTimeout(() => saveNowRef.current?.(), 0);

      // 素材未登録のファイル（スラッシュ・ドロップ経由）は、ここで素材として残す。
      // 表だけ残して生データを捨てると、ファイル名は source に残っても実物へ辿れず、
      // 来歴がここで切れる。登録を確定時にするのは、ダイアログをキャンセルした
      // ファイルまで素材に溜めないため。
      //
      // 中身が同じ素材が既にあれば使い回されるが、その判定は素材登録の入口
      // （`handleUploadAsset`）が全素材まとめて面倒を見る。装置は同じデータを
      // 何度も出すので、取り込みをやり直しても素材は増えない。アップロードは
      // 数秒かかりうるので、表の挿入を待たせず後から source に fileId を足す
      // （URL 素材登録と同じ流儀）。
      const rawFile = file.file;
      if (blockId && !file.fileId && rawFile && uploadAsset) {
        const targetBlockId = blockId;
        void (async () => {
          try {
            const { fileId } = await uploadAsset(rawFile);
            const current = tableMetaStore.getSource(targetBlockId);
            // ダイアログを閉じた後にユーザーがそのテーブルを消した／別のものに
            // 差し替えた場合は書き戻さない
            if (!current || current.fileName !== file.fileName) return;
            tableMetaStore.setSource(targetBlockId, { ...current, fileId });
            markDirtyRef.current();
          } catch (err) {
            // 素材登録に失敗しても表は残っている（fileId が付かず再取り込みができないだけ）
            console.warn("取り込んだデータファイルの素材登録に失敗:", err);
          }
        })();
      }
    },
    [tableMetaStore, isSlashOnlyBlock, removeBlockMetadata, uploadAsset]
  );

  // 取り込み元バッジ → 元ファイルを読み直し、保存済みの設定でダイアログを開く。
  // 確定すると新しい表を足すのではなく、その場のテーブルを置き換える
  // （範囲や区切りを間違えたときに作り直す動線。表の位置とキャプションは保つ）。
  const handleTableReimport = useCallback(
    (blockId: string, source: TableSource) => {
      if (!source.fileId) return;
      void (async () => {
        try {
          const provider = getActiveProvider();
          const blobUrl = await provider.getMediaBlobUrl(source.fileId!);
          const blob = await (await fetch(blobUrl)).blob();
          const text = await readDataFileText(blob);
          setDataImportFile({
            fileName: source.fileName,
            text,
            fileId: source.fileId,
            replaceBlockId: blockId,
            initialOptions: {
              ...source.options,
              customDelimiter: source.options.customDelimiter,
            },
          });
        } catch {
          alert(tStatic("dataImport.readError"));
        }
      })();
    },
    []
  );

  // データ素材ピッカーで「ファイルからアップロード」を選んだとき。
  // まだ素材にしないのは、ダイアログをキャンセルしたファイルまで溜めないため
  // （取り込みを確定した時点で登録する）。
  const handleDataImportFilePicked = useCallback(async (file: File) => {
    try {
      const text = await readDataFileText(file);
      setDataImportFile({ fileName: file.name, text, file });
    } catch {
      alert(tStatic("dataImport.readError"));
    }
  }, []);

  // 引用ピッカーで選択された claim / Insight ノートをエディタに挿入
  // MVP: 各ノートのタイトルを青色テキストの paragraph として並べる
  // （PR3 の Citation block が乗ったら専用ブロックに差し替える前提）
  //
  // 挿入と同時に knowledge レイヤの reference リンクを張る（@mention の note 分岐と同じ）。
  // これにより buildNoteGraph が page.knowledgeLinks を拾い、右パネルの Graph タブに
  // 「現ノート → 引用先 claim/Insight」のエッジとして描画される。
  const handleCitePickerConfirm = useCallback((entries: NoteIndexEntry[]) => {
    const editor = pickerEditorRef.current ?? editorRef.current;
    if (!editor || entries.length === 0) return;

    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) return;

    const newBlocks = entries.map((entry) => ({
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: `@${entry.title || "(untitled)"}`,
          styles: { textColor: "blue" },
        },
      ],
    }));
    const inserted = editor.insertBlocks(newBlocks, currentBlock, "after");

    // 挿入された各ブロックに reference リンクを張る（inserted[i] ↔ entries[i] で対応）。
    const insertedArr = Array.isArray(inserted) ? inserted : [];
    entries.forEach((entry, i) => {
      const blockId = insertedArr[i]?.id;
      if (!blockId) return;
      linkStore.addLink({
        sourceBlockId: blockId,
        targetBlockId: "",
        targetNoteId: entry.noteId,
        type: "reference",
        createdBy: "human",
      });
    });
    // linkStore.links の変更は自動保存トリガー（prevLinksRef 比較）で拾われるため
    // 明示的な markDirty は不要。

    // 現在のブロックが空（スラッシュだけ）なら削除
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      removeBlockMetadata([currentBlock.id]);
      editor.removeBlocks([currentBlock]);
    }
  }, [removeBlockMetadata, linkStore]);

  // スラッシュメニューアイテム（既存メディア・メモから挿入）
  const mediaSlashItems = useMemo(() => getMediaSlashMenuItems(), []);
  const memoSlashItem = useMemo(() => getMemoSlashMenuItem(), []);
  const templateSlashItem = useMemo(() => getTemplateSlashMenuItem(), []);
  const citeSlashItems = useMemo(() => getCiteSlashMenuItems(), []);
  // 「新しいノート」スラッシュコマンド。`@` メニューは IME 変換確定でメニューが
  // 閉じてしまい日本語名を打ち切れないため、名前入力を IME 安全なダイアログに寄せた
  // 確実な作成入口。`/` メニューは矢印キーで選べる（日本語入力不要）ので、名前だけを
  // ダイアログで入れられる。選ぶと空ノートを作成し、本文に @名前 リンクを挿入する。
  const newNoteSlashItem: SlashMenuItem = useMemo(
    () => ({
      // ラベルは getter で遅延評価する。この項目は useMemo で保持されるので、
      // ここで t() を即時評価すると言語を切り替えても古いラベルが残る。
      get title() { return tStatic("slashMenu.newNote.title"); },
      get subtext() { return tStatic("slashMenu.newNote.subtext"); },
      get group() { return tStatic("slashMenu.newNote.group"); },
      aliases: ["note", "newnote", "新しいノート", "新規ノート", "しんきのーと", "あたらしいのーと"],
      onItemClick: (editor: any) => {
        const sourceBlockId = editor?.getTextCursorPosition?.()?.block?.id;
        void (async () => {
          if (!onCreateLinkedNote) return;
          const title = (await promptNoteName(""))?.trim() ?? "";
          if (!title) return;
          const newId = await onCreateLinkedNote(title);
          if (!newId) return;
          if (sourceBlockId) {
            linkStore.addLink({
              sourceBlockId,
              targetBlockId: "",
              targetNoteId: newId,
              type: "reference",
              createdBy: "human",
            });
            const exists = noteLinksRef.current.some((l) => l.targetNoteId === newId);
            if (!exists) {
              noteLinksRef.current = [
                ...noteLinksRef.current,
                { targetNoteId: newId, sourceBlockId, type: "derived_from" },
              ];
            }
          }
          // insertInlineContent の onChange で自動 markDirty される
          setTimeout(() => {
            insertNoteMentionInline(editorRef.current, newId, title);
          }, 50);
        })();
      },
    }),
    [onCreateLinkedNote, promptNoteName, linkStore],
  );

  // テンプレートピッカーモーダル
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templateTriggerBlockRef = useRef<any>(null);

  // ── URL ペースト検知 ──
  const [pastedUrl, setPastedUrl] = useState<{ url: string; position: { x: number; y: number }; blockId: string } | null>(null);
  const pasteListenerRef = useRef<((e: ClipboardEvent) => void) | null>(null);
  const copyListenerRef = useRef<((e: ClipboardEvent) => void) | null>(null);

  // スラッシュメニューからの URL ピッカーモーダル用状態
  const [urlSlashPickerOpen, setUrlSlashPickerOpen] = useState(false);

  // URL 素材の登録完了後に保存を予約するための ref。
  // 登録がオートセーブ（3秒）より後に完了すると、syncUsedIn を再実行する保存
  // イベントが来ず usedIn が空のまま = グラフに URL ノードが出ない。
  // useAutoSave はこの位置より後で宣言されるため ref 経由で参照する。
  // saveNow（即時保存）ではなく markDirty を使う: fetchUrlMetadata は最大 5 秒
  // かかり、その間にノートを切り替えるとアンマウント後の stale save が
  // 「切替先ノートに旧ノートの内容を保存」するデータ破壊になる。markDirty の
  // タイマーは useAutoSave がアンマウント時に必ずクリアするため安全。
  const markDirtyRef = useRef<() => void>(() => {});
  // 取り込みのような「まとまった量が一度に入る」編集は、3 秒の自動保存待ちに
  // 賭けずその場で保存する（待っている間に何かがエディタを作り直すと丸ごと消える）。
  // markDirtyRef と同じく useAutoSave がこの位置より後で宣言されるため ref 経由。
  const saveNowRef = useRef<(() => void) | null>(null);

  // ペースト → ブックマーク選択: モーダルなしで直接挿入 + 裏でアセット登録。
  // 登録後は保存を予約して syncUsedIn を走らせる（オートセーブが先に完了して
  // いた場合、次の編集まで usedIn が埋まらずグラフに出ないのを防ぐ）。
  const handleInsertBookmarkDirect = useCallback((url: string, blockId: string) => {
    setPastedUrl(null);
    const editor = editorRef.current;
    if (!editor) return;
    insertBookmarkBlockFromPaste(editor, url, blockId, removeBlockMetadata);
    registerUrlAsset(url, [], onAddUrlBookmark, () => markDirtyRef.current());
  }, [onAddUrlBookmark, removeBlockMetadata]);

  // ペースト → リンク選択: テキストはインラインリンクのまま + 裏でアセット登録。
  // 登録しないと media index に URL エントリが無く、保存時の syncUsedIn が
  // usedIn を埋められないため、アセットグラフ・近傍グラフに URL が現れない。
  const handleInsertLinkDirect = useCallback((url: string, blockId: string) => {
    setPastedUrl(null);
    retroLinkifyPastedUrl(editorRef.current, url, blockId);
    registerUrlAsset(url, [], onAddUrlBookmark, () => markDirtyRef.current());
  }, [onAddUrlBookmark]);

  // 素材ピーク（未登録 URL の transient エントリ）からの「素材に登録」。
  // AI チャットの挿入や手打ちで本文に入ったリンクを、精査後に後追いで素材化する動線。
  // 貼付メニューと同じ流儀で usedIn は空 + 保存予約し、syncUsedIn に埋めさせる。
  // 登録完了時にピークが同じエントリのまま開いていれば実エントリへ差し替える
  // （登録ボタンが消え、Full view 昇格が解禁される）。
  const handleRegisterUrlFromPeek = useCallback((peekEntry: MediaIndexEntry) => {
    const url = peekEntry.url;
    if (peekEntry.type !== "url" || !url) return;
    registerUrlAsset(url, [], (newEntry) => {
      onAddUrlBookmark?.(newEntry);
      setMaterialSidePeekEntry((cur) => (cur && cur.fileId === peekEntry.fileId ? newEntry : cur));
    }, () => markDirtyRef.current());
  }, [onAddUrlBookmark]);

  // 素材ピークが「未登録 URL の transient エントリ」か（登録ボタンの表示判定）。
  // fileId でなく URL の一致で判定する: ピークを開いたまま裏で同じ URL が登録された
  // 場合（貼付メニュー等との競合）もボタンが正しく消えるようにするため。
  const materialPeekUrlUnregistered =
    materialSidePeekEntry?.type === "url" &&
    !!materialSidePeekEntry.url &&
    !mediaIndex?.media.some(
      (m) => m.type === "url" && m.url === materialSidePeekEntry.url,
    );

  // スラッシュメニューのピッカーから選択 → bookmark ブロック挿入
  // ピッカーを開いたエディタ（main / SidePeek）に挿入する。
  const handleUrlSlashPickerSelect = useCallback((entry: MediaIndexEntry, displayMode: AssetDisplayMode) => {
    const editor = pickerEditorRef.current ?? editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) return;

    if (displayMode === "link") {
      // URL は埋め込みカード（bookmark）ではなくインラインのハイパーリンクとして挿入する。
      insertInlineAtSlash(editor, currentBlock, [
        { type: "link", href: entry.url, content: [{ type: "text", text: entry.name, styles: {} }] },
        { type: "text", text: " ", styles: {} },
      ]);
      setUrlSlashPickerOpen(false);
      return;
    }

    editor.insertBlocks(
      [{
        type: "bookmark",
        props: {
          url: entry.url,
          title: entry.name,
          description: entry.urlMeta?.description ?? "",
          ogImage: entry.urlMeta?.ogImage ?? "",
          domain: entry.urlMeta?.domain ?? extractDomain(entry.url),
        },
      }],
      currentBlock,
      "after",
    );
    // 空のスラッシュブロックを削除
    if (isSlashOnlyBlock(currentBlock)) {
      removeBlockMetadata([currentBlock.id]);
      editor.removeBlocks([currentBlock]);
    }
    setUrlSlashPickerOpen(false);
  }, [removeBlockMetadata, isSlashOnlyBlock, insertInlineAtSlash]);

  // ラベル自動設定のコールバック
  const labelAutoRef = useRef<(() => void) | null>(null);

  // エディタ参照を保持
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    setMainEditor(editor);
    onEditorRef?.(editor);
    // ラベル自動設定をセットアップ
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStore, linkStore);

    // 前回のリスナーがあればクリーンアップ。
    // copy は capture / bubble の両方に登録しているので両方とも removeEventListener する。
    if (pasteListenerRef.current) {
      editor.domElement?.removeEventListener("paste", pasteListenerRef.current, true);
    }
    if (copyListenerRef.current) {
      editor.domElement?.removeEventListener("copy", copyListenerRef.current, true);
      editor.domElement?.removeEventListener("copy", copyListenerRef.current, false);
    }

    // copy: 選択範囲の labels / links をクリップボードに載せて運ぶ（Phase 3）。
    //
    // Chrome は text/plain / text/html / image/* 以外のカスタム MIME を
    // OS clipboard に書き出す際に捨てるため、
    //   1. ブラウザ内のみで完結する場合に備えて application/x-graphium-clipboard にも setData
    //   2. OS clipboard 経由でも生存させるため text/html の先頭に
    //      HTML コメントとして base64 ペイロードを埋め込む
    // capture phase だけだと ProseMirror が後から text/html を上書きしてしまうので、
    // bubble phase の最後でもう一度 embed する（同リスナーを 2 回登録）。
    const copyListener = (e: ClipboardEvent) => {
      try {
        let blockIds: string[] = [];
        const selection = editor.getSelection?.();
        const selectedBlocks = selection?.blocks;
        if (selectedBlocks && selectedBlocks.length > 0) {
          blockIds = flattenBlockIds(selectedBlocks);
        } else {
          // フォールバック: カーソル位置のブロック 1 つ（部分テキスト選択など、
          // selection.blocks が取れないケース）
          const cursorBlock = editor.getTextCursorPosition?.()?.block;
          if (cursorBlock?.id) blockIds = [cursorBlock.id];
        }
        if (blockIds.length === 0) return;
        const payload = buildClipboardPayload({
          blockIds,
          getLabel: (id) => labelStore.getLabel(id),
          getAttributes: (id) => labelStore.getAttributes(id),
          allLinks: linkStore.getAllLinks(),
        });
        if (!payload) return;
        e.clipboardData?.setData(GRAPHIUM_CLIPBOARD_MIME, JSON.stringify(payload));
        const existingHtml = e.clipboardData?.getData("text/html") ?? "";
        e.clipboardData?.setData("text/html", embedPayloadInHtml(payload, existingHtml));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[Graphium copy] error", err);
      }
    };
    copyListenerRef.current = copyListener;

    // URL 単体ペーストならブックマーク選択メニューを出す（段落・リスト項目共通）。
    // 位置はメニュー表示直前に計算する。paste イベント同期時の selection rect は
    // ProseMirror の挿入処理と競合して (0,0) や剥離した rect を返すことがあり、
    // メニューが画面左上に張り付く。挿入完了後なら caret 位置が安定して取れる。
    const maybeShowUrlPasteMenu = (rawText: string | undefined, blockId: string) => {
      const text = rawText?.trim();
      if (!text || !isHttpUrl(text)) return;
      setTimeout(() => {
        setPastedUrl({ url: text, position: computeUrlPasteMenuPosition(editor, blockId), blockId });
      }, 100);
    };

    // 単一トークンの Graphium ノートリンク（…#note/<id>）を @タイトル のメンション
    // に変換する。処理した場合 true を返す（呼び出し元で return する）。
    const tryConvertNoteLinkPaste = (e: ClipboardEvent, pastedText: string): boolean => {
      const noteLinkMatch = /#note\/([^/\s#?]+)/.exec(pastedText);
      if (!noteLinkMatch) return false;
      const linkedFileId = decodeURIComponent(noteLinkMatch[1]);
      const linkedTitle = resolveNoteLinkTitleRef.current(linkedFileId);
      if (!linkedTitle) return false;
      // クリップボードリスナーが二重登録されると同一 paste イベントが 2 回
      // このハンドラに届き、メンションが 2 個入る。イベント単位の既処理フラグ
      // ＋ stopImmediatePropagation で 1 回だけ処理する。
      if ((e as unknown as { __ghNoteLinkHandled?: boolean }).__ghNoteLinkHandled) return true;
      (e as unknown as { __ghNoteLinkHandled?: boolean }).__ghNoteLinkHandled = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      const sourceBlockId = editor.getTextCursorPosition()?.block?.id;
      if (sourceBlockId) {
        linkStore.addLink({
          sourceBlockId,
          targetBlockId: "",
          targetNoteId: linkedFileId,
          type: "reference",
          createdBy: "human",
        });
        const exists = noteLinksRef.current.some((l) => l.targetNoteId === linkedFileId);
        if (!exists) {
          noteLinksRef.current = [
            ...noteLinksRef.current,
            { targetNoteId: linkedFileId, sourceBlockId, type: "derived_from" },
          ];
        }
      }
      // insertInlineContent の onChange で自動 markDirty される
      setTimeout(() => {
        insertNoteMentionInline(editorRef.current, linkedFileId, linkedTitle);
      }, 0);
      return true;
    };

    // paste: Graphium ペイロードを最優先で処理し、なければ既存の URL 検知に流す
    const pasteListener = (e: ClipboardEvent) => {
      // 空のリスト系ブロック（checkListItem / bulletListItem / numberedListItem）に
      // テキストを paste すると BlockNote (prosemirror) がブロック自体を paragraph に
      // 置換してしまう。ユーザー視点では「リスト項目が消える」現象。
      // 該当ケースのみ介入し、ブロック型を保ったまま編集 API でテキストを差し込む。
      const cursorBlock = editor.getTextCursorPosition?.()?.block;
      const listBlockTypes = new Set(["checkListItem", "bulletListItem", "numberedListItem"]);
      if (
        cursorBlock &&
        listBlockTypes.has(cursorBlock.type) &&
        Array.isArray(cursorBlock.content) &&
        cursorBlock.content.length === 0 &&
        e.clipboardData
      ) {
        const graphiumRaw = e.clipboardData.getData(GRAPHIUM_CLIPBOARD_MIME);
        const htmlForPayload = e.clipboardData.getData("text/html");
        const hasGraphiumPayload =
          parseClipboardPayload(graphiumRaw) ?? extractPayloadFromHtml(htmlForPayload);
        const plain = e.clipboardData.getData("text/plain");
        // Graphium ペイロード（複数ブロック想定）はブロック置換でも構造が保たれるためスルー。
        // ここではプレーンテキスト相当の paste のみ救済する。
        if (!hasGraphiumPayload && plain) {
          // 末尾の改行はクリップボードに含まれる「行末コピー」由来で、ブロック内に
          // 持ち込むと BlockNote が hard break を増やすため除去する。
          const cleaned = plain.replace(/\r?\n+$/g, "");
          // 単一トークンのノートリンクは他ブロックと同様にメンション変換する
          const token = cleaned.trim();
          if (token && !/\s/.test(token) && tryConvertNoteLinkPaste(e, token)) return;
          // ProseMirror / BlockNote の paste handler も同じ DOM に付いており、
          // preventDefault だけだと続けて走ってブロックを改行追加 + paragraph 置換してしまう。
          // capture phase で完全に乗っ取るため stopImmediatePropagation も呼ぶ。
          e.preventDefault();
          e.stopImmediatePropagation();
          // URL 単体はネイティブ paste（GFM autolink）と同じくリンクとして挿入する
          // （プレーンテキストだと usedIn スキャンの検出対象にならずグラフに出ない）
          editor.updateBlock(cursorBlock, { content: buildPastedTextContent(cleaned) });
          // URL 単体ならリスト項目でもブックマーク選択メニューを出す
          maybeShowUrlPasteMenu(cleaned, cursorBlock.id);
          return;
        }
      }
      // 全コピペ共通: 挿入後にインライン entityId を再発番する後処理（Phase E, 2026-04-30）
      // 同 entityId 共有は意図しない場合が多いので、コピー範囲内では一貫した
      // 新 ID に置き換える（旧 ID 同一なら新 ID も同一になる remap）。
      // 詳細: features/inline-label/regen-on-paste.ts
      // beforeIdsForRegen はペースト画像の素材取り込み（下の schedulePastedImageCapture）
      // とも共有する paste 直前スナップショット。
      const beforeIdsForRegen = new Set(flattenBlockIds(editor.document));
      const scheduleEntityRegen = () => {
        setTimeout(() => {
          const afterIds = flattenBlockIds(editor.document);
          const newIds = new Set(afterIds.filter((id) => !beforeIdsForRegen.has(id)));
          if (newIds.size > 0) regenInlineEntitiesInBlocks(editor, newIds);
        }, 0);
      };

      // 1) ブラウザ内コピペ（同タブ）はカスタム MIME がそのまま生きる
      // 2) OS clipboard 経由でも text/html の HTML コメントから取り出す
      const graphiumRaw = e.clipboardData?.getData(GRAPHIUM_CLIPBOARD_MIME);
      const htmlData = e.clipboardData?.getData("text/html");
      const payload =
        parseClipboardPayload(graphiumRaw) ?? extractPayloadFromHtml(htmlData);
      if (payload) {
        const beforeIds = new Set(flattenBlockIds(editor.document));
        // BlockNote のネイティブパースを動かしてから、追加されたブロック ID を確定させる
        setTimeout(() => {
          const afterIds = flattenBlockIds(editor.document);
          const newIds = afterIds.filter((id) => !beforeIds.has(id));
          const idMap = computeIdMap(payload.blockIds, newIds);
          if (idMap.size === 0) return;
          applyClipboardPayload(idMap, payload, {
            setLabel: (blockId, label) => labelStore.setLabel(blockId, label),
            setAttributes: (blockId, attrs) => labelStore.setAttributes(blockId, attrs),
            addLink: (params) => linkStore.addLink(params),
          });
        }, 0);
        scheduleEntityRegen();
        schedulePastedImageCapture(editor, beforeIdsForRegen, uploadFile, e);
        return;
      }

      // Graphium ペイロード以外でも entity 再発番は走らせる（プレーン Markdown / HTML 等）
      scheduleEntityRegen();
      // ウェブページ等の HTML ペーストで入った外部 URL / data URL 画像を素材へ取り込む
      // （BlockNote の text/html 経路は uploadFile を通らず、素材に残らないため）
      schedulePastedImageCapture(editor, beforeIdsForRegen, uploadFile, e);

      // Graphium ノートのリンク（…#note/<id>）を単体で貼った場合は、生 URL では
      // なく @タイトル のメンションに変換する（`@` で参照するのと同じ扱い）。
      // 長文中に URL が混ざっているケースは誤爆を避けるため、貼り付けが URL 単体
      // （空白を含まない）のときだけ変換する。
      const pastedText = e.clipboardData?.getData("text/plain")?.trim();
      if (pastedText && !/\s/.test(pastedText)) {
        if (tryConvertNoteLinkPaste(e, pastedText)) return;
      }

      // 既存: URL のみのペーストならブックマーク選択メニューを出す
      const currentBlock = editor.getTextCursorPosition()?.block;
      if (!currentBlock) return;
      maybeShowUrlPasteMenu(e.clipboardData?.getData("text/plain"), currentBlock.id);
    };
    pasteListenerRef.current = pasteListener;

    // .csv / .txt / .dat のドロップは取り込みダイアログに回す。
    // 何もしないと BlockNote が汎用の file ブロック（添付）として貼り付けてしまい、
    // 中身が表にならないまま埋まる。それ以外のファイルは BlockNote に任せる。
    const dropListener = (e: DragEvent) => {
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
        isDelimitedDataFile(f.name)
      );
      if (!file) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // ドロップ位置のブロックにカーソルを移してから開く（挿入位置を合わせるため）
      const pos = editor.getTextCursorPosition?.()?.block;
      if (pos) editor.setTextCursorPosition(pos, "end");
      pickerEditorRef.current = editor;
      void readDataFileText(file)
        .then((text) => setDataImportFile({ fileName: file.name, text, file }))
        .catch(() => alert(tStatic("dataImport.readError")));
    };

    // editor.domElement が ready になるまで rAF で待ってからリスナー登録する。
    // BlockNote の onEditorReady は editor インスタンスはあるが domElement が
    // まだ設定されていない段階でも複数回呼ばれるため、ここでガードする。
    // セーブまでリスナーが付かない不具合を防ぐ。
    let attempts = 0;
    const attachClipboardListeners = () => {
      const domEl = editor.domElement;
      if (!domEl) {
        if (attempts++ < 60) {
          requestAnimationFrame(attachClipboardListeners);
        }
        return;
      }
      // ProseMirror が copy/paste を capture phase で先取りする場合があるため、
      // 自分も capture phase で受け取る。preventDefault はしないので
      // BlockNote のネイティブシリアライズ／パースはそのまま走る。
      domEl.addEventListener("copy", copyListener, true);
      domEl.addEventListener("paste", pasteListener, true);
      domEl.addEventListener("drop", dropListener, true);
      // bubble phase でも copy を補足する（capture phase で setData した内容を
      // ProseMirror が clearData している場合、bubble の最後でもう一度 setData する）
      domEl.addEventListener("copy", copyListener, false);
    };
    attachClipboardListeners();
  }, [labelStore, linkStore, uploadFile]);

  // ── 保存ロジック ──
  const buildDocument = useCallback(async (): Promise<GraphiumDocument> => {
    const blocks = editorRef.current?.document || [];
    // labels / provLinks / knowledgeLinks / blockAlignments の組み立ては
    // SidePeek（side-peek.tsx doSave）と同一なので共有モジュールに集約。
    const {
      labels: labelsObj,
      provLinks,
      knowledgeLinks,
      blockAlignments,
    } = buildSavedPageFields({ labelStore, linkStore, blockAlignmentStore });
    // チャット履歴を収集（現在のアクティブチャットを含む）
    const currentChat = aiAssistant.getCurrentChat();
    const savedChats = [...aiAssistant.chats];
    if (currentChat) {
      const idx = savedChats.findIndex((c) => c.id === currentChat.id);
      if (idx >= 0) {
        savedChats[idx] = currentChat;
      } else {
        savedChats.push(currentChat);
      }
    }
    // テーブル注釈（名前・列のふるまい・行のノート紐付け）を収集。
    // 旧 indexTables / logTables はここに統合済みで、保存は新形式のみ
    const tableMetaSnapshot = tableMetaStore.getSnapshot();
    const hasTableMeta = Object.keys(tableMetaSnapshot).length > 0;
    // メディアインラインラベル（Phase D-3-β）
    const mediaInlineLabelsSnapshot = mediaInlineLabelStore.getSnapshot();
    const hasMediaInlineLabels =
      Object.keys(mediaInlineLabelsSnapshot).length > 0;
    // 画像 OCR テキスト（端末内 Tesseract.js。標準 image ブロックの注釈層）
    const mediaOcrSnapshot = mediaOcrStore.getSnapshot();
    const hasMediaOcr = Object.keys(mediaOcrSnapshot).length > 0;
    let doc: GraphiumDocument = {
      version: LATEST_DOCUMENT_VERSION,
      title,
      pages: [
        {
          id: "main",
          title,
          blocks,
          labels: labelsObj,
          provLinks,
          knowledgeLinks,
          tableMeta: hasTableMeta ? tableMetaSnapshot : undefined,
          mediaInlineLabels: hasMediaInlineLabels
            ? mediaInlineLabelsSnapshot
            : undefined,
          mediaOcr: hasMediaOcr ? mediaOcrSnapshot : undefined,
          blockAlignments,
        },
      ],
      noteLinks: noteLinksRef.current.length > 0 ? noteLinksRef.current : undefined,
      citedAssetFileIds:
        citedAssetFileIdsRef.current.length > 0 ? citedAssetFileIdsRef.current : undefined,
      noteContexts:
        noteContextsRef.current.length > 0 ? noteContextsRef.current : undefined,
      derivedFromNoteId: initialDoc?.derivedFromNoteId,
      derivedFromBlockId: initialDoc?.derivedFromBlockId,
      documentProvenance: currentProvenance,
      chats: savedChats.length > 0 ? savedChats : undefined,
      // Wiki / Skill メタデータを保持（source, wikiMeta, skillMeta, generatedBy）
      source: initialDoc?.source,
      wikiMeta: initialDoc?.wikiMeta,
      skillMeta: initialDoc?.skillMeta,
      generatedBy: initialDoc?.generatedBy,
      // 本文フル幅設定（トグル操作で変わるため ref から読む）
      fullWidth: fullWidthRef.current || undefined,
      // url-to-prov / pdf-to-prov 由来の外部ソースメタデータを保持
      // （来歴ツリーの上流ソース表示・グラフのエッジ生成に必要）
      sourceUrl: initialDoc?.sourceUrl,
      sourceTitle: initialDoc?.sourceTitle,
      sourceFetchedAt: initialDoc?.sourceFetchedAt,
      sourcePdfFileId: initialDoc?.sourcePdfFileId,
      sourcePdfName: initialDoc?.sourcePdfName,
      createdAt: initialDoc?.createdAt || new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    // ドキュメント来歴: リビジョンを追記（buildDocument を async 化）
    // AI 挿入直後かどうかを判定（lastAiInsertRef が true なら ai_generation）
    let actType: import("./features/document-provenance/types").EditActivityType;
    let actLabel: string | undefined;
    if (lastAiInsertRef.current) {
      actType = "ai_generation";
      // 挿入された内容はチャット応答由来なので、Chat & Synthesis モデルを優先。
      // 未設定なら getChatSynthesisLLMModel が default にフォールバックするので
      // 旧来の挙動（default モデル名を記録）も保たれる。
      actLabel = getChatSynthesisLLMModel()?.name ?? getSelectedModel?.() ?? "ai";
      lastAiInsertRef.current = false;
    } else {
      const detected = detectActivityType(doc);
      actType = detected.type;
      actLabel = detected.agentLabel;
    }
    const email = await getActiveProvider().getUserEmail() ?? undefined;
    const author = loadAuthorIdentity() ?? undefined;
    // このリビジョンで新しく挿入された shared:// 引用 → EditActivity.used（prov:used）
    const citedSharedSources = collectNewSharedCitationSources(
      prevPageRef.current?.blocks,
      doc.pages[0]?.blocks,
    );
    doc = await recordRevision(doc, prevPageRef.current, actType, {
      agentLabel: actLabel,
      email,
      author,
      sources: citedSharedSources.length > 0 ? citedSharedSources : undefined,
    });
    // 前回保存状態を更新
    prevPageRef.current = structuredClone(doc.pages[0]);

    return doc;
  }, [title, labelStore, linkStore, tableMetaStore, mediaInlineLabelStore, mediaOcrStore, blockAlignmentStore, aiAssistant, initialDoc, currentProvenance]);

  // sharedRef は initialDoc から初期化し、Share 成功時に即時更新する。
  // initialDoc は親が新しい doc に差し替えない限り変わらないため、ローカル state で持つ。
  // 注意: handleSave より上で宣言しないと、handleSave が buildDocument() の結果に
  //       sharedRef を再注入する経路で参照できない（buildDocument は state から
  //       完全にスクラッチで組むため、毎回保存時に sharedRef が落ちるバグになる）。
  const [sharedRefState, setSharedRefState] = useState(initialDoc?.sharedRef);
  // 別のノートを開いた（initialDoc が変わった）ときは新しい sharedRef に追従する
  useEffect(() => {
    setSharedRefState(initialDoc?.sharedRef);
  }, [initialDoc]);

  // 最後に保存したタイトル。メインエディタのタイトル欄でのリネームを保存時に検知し、
  // @メンションのラベル伝播（onPropagateMentionRename）を発火するための基準。
  // オートセーブは本文編集でも頻繁に走るため、タイトルが実際に変わった保存のときだけ
  // 伝播する。別ノートを開いたら（initialDoc が変わったら）その時点のタイトルに追従する。
  const lastSavedTitleRef = useRef(initialDoc?.title ?? "");
  useEffect(() => {
    lastSavedTitleRef.current = initialDoc?.title ?? "";
  }, [initialDoc]);

  const handleSave = useCallback(async () => {
    const baseDoc = await buildDocument();
    // 通常保存時にも sharedRef を持たせる（buildDocument が落とすため）。
    // これがないと auto-save ごとに sharedRef がディスクから消え、再共有時に
    // 既存 entry を見つけられず author check が発動しない、という連鎖バグになる。
    const doc: GraphiumDocument = sharedRefState
      ? { ...baseDoc, sharedRef: sharedRefState }
      : baseDoc;
    onSave(doc);
    // タイトルが変わった保存なら、@メンションのラベルを参照元ノートへ伝播する。
    // ピークで開いているノートはファイル直書きすると、ピークの次のオートセーブが
    // 旧内容で上書きして伝播が巻き戻るため対象から外し、代わりにピークのエディタを
    // ライブ更新する（peekMentionRenameRef → updateBlock → ピーク自身のオート
    // セーブ経路で永続化）。skill をフルで開いている場合は raw id のまま渡るが、
    // skill は @メンションの参照が構造上存在しないため propagate 側で自然に
    // no-op になる。
    const prevTitle = lastSavedTitleRef.current;
    if (fileId && prevTitle && doc.title && prevTitle !== doc.title) {
      const peekRaw = sidePeekNoteId?.replace(/^(wiki|skill):/, "");
      void onPropagateMentionRename?.(
        isWikiDoc ? `wiki:${fileId}` : fileId,
        prevTitle,
        doc.title,
        { skipNoteIds: peekRaw ? [peekRaw] : undefined },
      );
      peekMentionRenameRef.current?.(fileId, prevTitle, doc.title, isWikiDoc ?? false);
    }
    lastSavedTitleRef.current = doc.title ?? "";
    // 保存後に documentProvenance を state に反映（History パネル更新用）
    if (doc.documentProvenance) {
      setCurrentProvenance(doc.documentProvenance);
    }
    // 保存後に Drive Revision ID を非同期で取得・紐付け
    if (fileId && doc.documentProvenance) {
      const revisions = doc.documentProvenance.revisions;
      const lastRev = revisions[revisions.length - 1];
      if (lastRev && !lastRev.driveRevisionId) {
        getActiveProvider().getRevisionId?.(fileId).then((driveRevId) => {
          if (driveRevId) lastRev.driveRevisionId = driveRevId;
        });
      }
    }
  }, [onSave, buildDocument, fileId, sharedRefState, sidePeekNoteId, isWikiDoc, onPropagateMentionRename]);

  // ── オートセーブ ──
  const { dirty, setDirty, markDirty, saveNow } = useAutoSave(handleSave);
  markDirtyRef.current = markDirty;
  saveNowRef.current = saveNow;

  // ── team-shared storage（Phase 2a / 2b-1） ──
  // sharedRefState は handleSave の上で宣言済み（buildDocument 結果への再注入用）
  const [shareBusy, setShareBusy] = useState(false);
  const isShared = !!sharedRefState;
  const sharedRoot = getSharedRoot();
  const sharedAuthor = loadAuthorIdentity();
  const shareDisabledReason = !isTauri()
    ? t("share.disabled.desktopOnly")
    : !sharedRoot
      ? t("share.disabled.noRoot")
      : !sharedAuthor
        ? t("share.disabled.noIdentity")
        : !fileId
          ? t("share.disabled.unsavedNote")
          : undefined;
  const handleShare = useCallback(async () => {
    if (!sharedRoot || !sharedAuthor) return;
    setShareBusy(true);
    try {
      // 最新の編集を含めて build。
      // buildDocument はローカル state から完全にスクラッチで組み立てるため、
      // sharedRef が落ちる。Update Share では既存 id を維持する必要があるので、
      // ここで sharedRefState を再注入する（initialDoc 経由ではなく、Share 直後に
      // setSharedRefState で更新したばかりの値も拾える）。
      const baseDoc = await buildDocument();
      const docWithRef: GraphiumDocument = sharedRefState
        ? { ...baseDoc, sharedRef: sharedRefState }
        : baseDoc;
      const result = await shareNote(docWithRef, {
        root: sharedRoot,
        author: sharedAuthor,
        blobRoot: getBlobRoot() ?? undefined,
      });
      if (!result.ok) {
        window.alert(t("share.failed") + ": " + result.error);
        return;
      }
      // sharedRef 付きの doc を保存（personal 側に sharedRef を持たせる）
      onSave(result.doc);
      // バッジを即時更新（initialDoc は親側で書き替えるまで変わらないので、ローカル state で先に反映）
      setSharedRefState(result.doc.sharedRef);
      window.alert(
        result.isUpdate
          ? t("share.successReshare")
          : t("share.successFirst"),
      );
    } finally {
      setShareBusy(false);
    }
  }, [sharedRoot, sharedAuthor, buildDocument, onSave, t, sharedRefState]);

  // ── メモ挿入（メモギャラリーから） ──
  useEffect(() => {
    if (!pendingMemoInsert || !editorRef.current) return;
    const editor = editorRef.current;
    const blocks = pendingMemoInsert.text.split("\n").map((line: string) => ({
      type: "paragraph",
      content: [{ type: "text" as const, text: line, styles: {} }],
    }));
    if (blocks.length === 0) return;
    // ドキュメント末尾に挿入
    const allBlocks = editor.document;
    const lastBlock = allBlocks[allBlocks.length - 1];
    if (lastBlock) {
      editor.insertBlocks(blocks, lastBlock, "after");
    }
    markDirty();
    onMemoInserted?.();
  }, [pendingMemoInsert, markDirty, onMemoInserted]);

  // ── PROV 生成 ──
  const { provDoc, triggerRegeneration } = useProvGeneration(
    editorRef,
    labelStore.labels,
    linkStore.links,
    initialDoc?.documentProvenance,
    mediaInlineLabelStore.labels,
  );

  // ノート切り替え時に自動オープンフラグをリセット（次のノートで再度 1 度だけ発火する）
  useEffect(() => {
    provAutoOpenedRef.current = false;
  }, [fileId]);

  // PROV パネル自動オープン（Phase D-3-α 続き）
  // procedure 見出しが付いて Activity が生成されたタイミングで右パネルを 1 度だけ開く。
  // - 骨格 (Activity) が無い間は開かない（漂遊 Entity だけのグラフは無意味なので）
  // - ユーザーが手動で閉じた後は再オープンしない（押し付けがましくならないように）
  // - block ラベル / インラインラベル / メディアラベルどの経路でも procedure 経由で
  //   Activity が立ち上がれば同じ条件で発火する
  useEffect(() => {
    if (!provLabelsEnabled) return;
    if (provAutoOpenedRef.current) return;
    if (rightTab !== null) return;
    const hasActivity =
      provDoc?.["@graph"].some((n) => n["@type"] === "prov:Activity") ?? false;
    if (hasActivity) {
      setRightTab("prov");
      provAutoOpenedRef.current = true;
    }
  }, [provDoc, rightTab, provLabelsEnabled]);

  // 来歴ラベル機能がオフになったら、開いている PROV グラフパネルを閉じる（一貫性のため）。
  // タブ自体は非表示になるが、既に "prov" を開いた状態で設定を切り替えた場合に空パネルが
  // 残らないよう、明示的に null に戻す。
  useEffect(() => {
    if (!provLabelsEnabled && rightTab === "prov") setRightTab(null);
  }, [provLabelsEnabled, rightTab]);

  // ── PDF エクスポートハンドラー ──
  const handleExportPdf = useCallback(async () => {
    const editorEl = document.querySelector("[data-label-wrapper] .bn-editor") as HTMLElement | null;
    if (!editorEl) return;
    setPdfExporting(true);
    // 準備はたいてい一瞬で終わるので、すぐ出すとトーストが一瞬光って消える。
    // 画像の多いノートなど、待たせるときだけ知らせる。
    const slowTimer = window.setTimeout(() => setPrintPreparing(true), 300);
    const dismissToast = () => {
      window.clearTimeout(slowTimer);
      setPrintPreparing(false);
    };
    try {
      await printNote({
        title,
        editorElement: editorEl,
        provDoc,
        labels: labelStore.labels,
        onReady: dismissToast,
      });
    } finally {
      dismissToast();
      setPdfExporting(false);
    }
  }, [title, provDoc, labelStore.labels]);

  // デスクトップ（Tauri）のネイティブメニュー File → Print / PDF からも同じ処理を呼ぶ。
  // 登録をエディタのマウント中に限るのは、handleExportPdf がエディタの DOM から本文を
  // 取るため。ノート未表示のときは未登録＝何も起きないが、印刷対象が無いので妥当。
  // Web では menu-action イベント自体が発火しないので無害。
  useEffect(() => onMenuAction("export-pdf", () => void handleExportPdf()), [handleExportPdf]);

  // ── Markdown エクスポートハンドラー ──
  // PDF と同じくエディタの現在内容（未保存の編集含む）が対象。
  const handleExportMarkdown = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      // テーブルの名前はブロックの外（tableMeta）にあるので明示的に渡す。
      // 渡さないとチャートが参照先を列名でしか書けない
      await exportNoteToMarkdown({
        title,
        editor,
        tableMeta: tableMetaStoreRef.current.getSnapshot(),
      });
    } catch (e) {
      console.error("[markdown-export] export failed:", e);
    }
  }, [title]);

  // ── PROV-JSON-LD エクスポートハンドラー ──
  // Phase 4 (PR-B7): Wiki Knowledge Layer も @graph に含める。NoteApp 側で
  // wiki state から組み立てた wikiEntities を prop で受け取り、ここでは受け流す。
  const handleExportProvJsonLd = useCallback(() => {
    if (!provDoc || provDoc["@graph"].length === 0) return;
    void exportProvJsonLd({ title, provDoc, wikiEntities: provWikiEntities });
  }, [title, provDoc, provWikiEntities]);

  // ラベル・リンク・テーブル注釈・配置変更時に自動保存トリガー
  const prevLabelsRef = useRef(labelStore.labels);
  const prevLinksRef = useRef(linkStore.links);
  const prevTableMetasRef = useRef(tableMetaStore.metas);
  const prevMediaLabelsRef = useRef(mediaInlineLabelStore.labels);
  const prevAlignmentsRef = useRef(blockAlignmentStore.alignments);
  const prevMediaOcrRef = useRef(mediaOcrStore.entries);
  useEffect(() => {
    if (
      prevLabelsRef.current !== labelStore.labels ||
      prevLinksRef.current !== linkStore.links ||
      prevTableMetasRef.current !== tableMetaStore.metas ||
      prevMediaLabelsRef.current !== mediaInlineLabelStore.labels ||
      prevAlignmentsRef.current !== blockAlignmentStore.alignments ||
      prevMediaOcrRef.current !== mediaOcrStore.entries
    ) {
      prevLabelsRef.current = labelStore.labels;
      prevLinksRef.current = linkStore.links;
      prevTableMetasRef.current = tableMetaStore.metas;
      prevMediaLabelsRef.current = mediaInlineLabelStore.labels;
      prevAlignmentsRef.current = blockAlignmentStore.alignments;
      prevMediaOcrRef.current = mediaOcrStore.entries;
      markDirty();
    }
  }, [labelStore.labels, linkStore.links, tableMetaStore.metas, mediaInlineLabelStore.labels, blockAlignmentStore.alignments, mediaOcrStore.entries, markDirty]);

  // AI チャットパネル用ハンドラー（継続対話）
  const handleAiChatSubmit = useCallback(
    async (
      question: string,
      attachedNotes?: AttachedNote[],
      scope: GroundingScope = DEFAULT_GROUNDING_SCOPE,
      rewindIndex?: number,
      opts?: { freshChat?: boolean },
    ) => {
      // 新規ノート（fileId 未採番）でも AI チャットを許可する
      // markDirty() 経由でオートセーブが走り、ファイルが作成される
      if (!editorRef.current) {
        aiAssistant.setError(tStatic("aiChat.editorNotReady"));
        return;
      }
      if (!isAgentConfigured()) {
        aiAssistant.setError(
          tStatic("settings.aiNotConfigured"),
        );
        return;
      }
      // Composer(Cmd+K) Ask は parkChat() 直後に同一 tick で呼ばれるため、この
      // クロージャの aiAssistant は park 前の stale な state を見ている。そのまま
      // activeChatId / messages / sessionId を読むと、退避したはずのチャットの id で
      // run が走り、退避済みの会話を上書き・融合してしまう。freshChat 指定時は
      // 「新しい会話を開始する」前提で会話コンテキストを空にそろえる。
      const freshChat = opts?.freshChat ?? false;
      const effectiveQuotedMarkdown = freshChat ? "" : aiAssistant.quotedMarkdown;
      const effectiveSourceBlockIds = freshChat ? [] : aiAssistant.sourceBlockIds;
      const effectiveSessionId = freshChat ? null : aiAssistant.sessionId;
      const effectiveForkedFrom = freshChat ? null : aiAssistant.forkedFrom;
      const now = new Date().toISOString();
      // 添付ノートがある場合はメッセージ表示に含め、参照（ID + タイトル）を
      // メッセージに永続化する（編集&再実行・回答の再生成で中身を再展開するため）
      const attachmentRefs = attachedNotes?.map((n) => ({
        id: n.id,
        title: n.title,
        ...(n.isWiki ? { isWiki: true } : {}),
        ...(n.kind === "asset" ? { kind: "asset" as const, assetType: n.assetType } : {}),
      }));
      const displayContent = attachmentRefs && attachmentRefs.length > 0
        ? `${question}${buildAttachmentSuffix(attachmentRefs)}`
        : question;
      const userChatMessage = {
        role: "user" as const,
        content: displayContent,
        timestamp: now,
        ...(attachmentRefs && attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
      };
      // rewindIndex 指定時（編集&再実行・回答の再生成）は、その位置以降を破棄して
      // 新しい user メッセージを置く。履歴もそこまでで組み立てる。
      const baseMessages = freshChat
        ? []
        : rewindIndex != null
          ? aiAssistant.messages.slice(0, rewindIndex)
          : aiAssistant.messages;
      // 応答の書き戻し先となる ScopeChat id を送信前に確定する。store の遅延発行に
      // 任せると外から id を知る手段がなく、ノート切替後の書き戻し先を特定できない
      const chatId = freshChat
        ? crypto.randomUUID()
        : aiAssistant.activeChatId ?? crypto.randomUUID();
      if (rewindIndex != null) {
        aiAssistant.rewriteFrom(rewindIndex, userChatMessage, chatId);
      } else {
        aiAssistant.addMessage(userChatMessage, chatId);
      }
      aiAssistant.setLoading(true);
      try {
        const isFirstMessage = baseMessages.length === 0;
        let userMessage = question;
        // ページ全体チャットで同梱した本文。横断検索のクエリ（主題抽出）にも使うので
        // 分岐の外に持ち出す。引用チャット・ブロック指定チャットでは空のまま。
        let pageMarkdownForRetrieval = "";
        if (effectiveQuotedMarkdown) {
          // 引用チャット: 引用（初回のスナップショット）を議論の主題として渡し、
          // ノート本文は「背景」として毎ターン最新を添える。本文を渡さないと、
          // 指示語・略語・前提条件が引用の外にある場合に AI が推測で埋めるしかなく、
          // 一部を引用したほうがページ全体チャットより文脈が薄くなってしまう。
          // 引用そのものは下記 history 側でも idx=0 に再注入して維持する。
          // タイトルはエディタ本文（BlockNote document）の外にあるメタデータなので、
          // 明示的に前置きへ含めないと AI からノートのタイトルが参照できない。
          const pageMarkdown = editorRef.current
            ? await blocksToMarkdown(editorRef.current, editorRef.current.document, {
                tableMeta: tableMetaStoreRef.current.getSnapshot(),
              })
            : "";
          userMessage = buildQuotedChatMessage({
            title,
            quotedMarkdown: effectiveQuotedMarkdown,
            pageMarkdown,
            question,
            isFirstMessage,
          });
        } else if (effectiveSourceBlockIds.length === 0 && editorRef.current) {
          // ページ全体チャット: 毎ターン、現在のドキュメント本文（最新）を再同梱する。
          // スナップショット方式だと「修正しました、見てください」と続けたときに
          // AI が編集前の本文しか見えず「修正したノートを見せてください」と返してしまう。
          // それを防ぐため、送信のたびにエディタから最新本文を取り直す。
          const allBlocks = editorRef.current.document;
          const pageMarkdown = await blocksToMarkdown(editorRef.current, allBlocks, {
            tableMeta: tableMetaStoreRef.current.getSnapshot(),
          });
          if (pageMarkdown.trim()) {
            pageMarkdownForRetrieval = pageMarkdown;
            userMessage = [
              isFirstMessage
                ? `以下のノート「${title}」の内容全体について質問があります。`
                : `以下はノート「${title}」の現在の最新の内容です（あなたが前に見たものから編集されている場合があります）。これを踏まえて回答してください。`,
              "",
              "---",
              `ノートタイトル: ${title}`,
              "",
              pageMarkdown,
              "---",
              "",
              question,
            ].join("\n");
          }
        }
        // @ メンションで添付されたノートの内容をコンテキストに追加
        if (attachedNotes && attachedNotes.length > 0) {
          const noteContents: string[] = [];
          for (const attached of attachedNotes) {
            // 素材添付（右パネル「AI に質問」）はノートではないので loadFile 経路に載せず、
            // 下の「引用・添付素材」経路（assembleCitedAssetContext）で本文を組み立てる。
            if (attached.kind === "asset") continue;
            try {
              const provider = getActiveProvider();
              const doc = attached.isWiki && provider.loadWikiFile
                ? await provider.loadWikiFile(attached.id)
                : await provider.loadFile(attached.id);
              if (doc) {
                // 引用先が文書ノート（PDF/docx/URL 由来）なら、薄い本文ではなく
                // 1ホップ派生知識（派生メモ＋派生 Claim/洞察）を優先し、
                // 派生知識が無い/余剰予算ぶんは原文（PDF 全文等）で埋める。
                if (isDocumentNote(doc)) {
                  const assembled = await assembleCitedDocumentContext(attached.id, doc, {
                    noteIndex: noteIndex ?? null,
                    captureIndex: captureIndexProp ?? null,
                    provider,
                    scope,
                    loadUrlText,
                    loadMediaText,
                  });
                  if (assembled) {
                    noteContents.push(assembled);
                    continue;
                  }
                }
                // プレーンテキスト抽出（ブロック構造から確実にテキストを取得）。
                // children も再帰する共通ヘルパーに委ねる — トップレベルの
                // content だけ見ると、本文が step・カラムの中にあるノートが
                // 空扱いになり context から丸ごと落ちる。
                const content = blocksToPlainText(doc);
                if (content.trim()) {
                  noteContents.push(`## ${attached.title}\n${content.trim()}`);
                }
              }
            } catch {
              // ロード失敗は無視
            }
          }
          if (noteContents.length > 0) {
            userMessage = [
              userMessage,
              "",
              "---",
              "以下はユーザーが明示的に添付したノートの内容です。質問はこの内容に基づいて回答してください:",
              "",
              ...noteContents,
              "---",
            ].join("\n");
          }
        }
        // このノートが @ で引用したドキュメント素材（PDF/URL/docx 本体）と、素材の右パネル
        // 「AI に質問」で添付した素材の中身を AI 文脈に載せる。ノート参照と違い「素材そのもの」を
        // 指すため、fileId から直接解決する。
        const attachedAssetIds = (attachedNotes ?? [])
          .filter((n) => n.kind === "asset")
          .map((n) => n.id);
        const citedAssetIds = [...new Set([...citedAssetFileIdsRef.current, ...attachedAssetIds])];
        if (citedAssetIds.length > 0) {
          const assetContents: string[] = [];
          for (const assetFileId of citedAssetIds) {
            const entry = mediaIndex?.media.find((m) => m.fileId === assetFileId);
            // URL 素材は Reader 経由で本文を取得（sourceUrl）、取れなければ抽出済み抜粋（excerpt）に
            // フォールバックする。素材ライブラリ未登録の一時 URL ピーク（fileId が "url:<url>"）は
            // mediaIndex に無いため、fileId から URL を復元して本文取得する。
            const citedAsset = entry
              ? {
                  fileId: entry.fileId,
                  name: entry.name,
                  type: entry.type,
                  sourceUrl: entry.type === "url" ? entry.url : undefined,
                  excerpt: entry.urlMeta?.excerpt,
                }
              : assetFileId.startsWith("url:")
                ? { fileId: assetFileId, name: assetFileId.slice(4), type: "url", sourceUrl: assetFileId.slice(4) }
                : null;
            if (!citedAsset) continue;
            try {
              const md = await assembleCitedAssetContext(citedAsset, {
                captureIndex: captureIndexProp ?? null,
                provider: getActiveProvider(),
                scope,
                loadUrlText,
              });
              if (md) assetContents.push(md);
            } catch {
              // 抽出失敗は無視
            }
          }
          if (assetContents.length > 0) {
            userMessage = [
              userMessage,
              "",
              "---",
              "以下はユーザーが引用・添付したドキュメント素材です。質問はこの内容を踏まえて回答してください:",
              "",
              ...assetContents,
              "---",
            ].join("\n");
          }
        }

        // チャット送信は「チャット・洞察モデル」設定を使う（未設定ならデフォルトモデルにフォールバック）。
        // getSelectedModel() はデフォルトモデルを返すため、設定 UI の「AIチャットで使われます」の
        // 約束と食い違っていた（#316 で chatSynthesis を追加した際にこの経路の結線が漏れていた）。
        const selectedModel = getChatSynthesisModelName();
        const disabledTools = getDisabledTools();
        // Wiki Retriever: 関連する Wiki コンテキスト（横断検索）を取得。
        // ノート内参照（notes）では横断検索を抑制し、@引用したものだけに絞る。
        // 内部参照・外部参照では横断を足すが、@引用・派生知識と重複するものは除外して二重掲載を防ぐ。
        let wikiContext: string | undefined;
        if (includesCrossSearch(scope)) {
          try {
            const excludeIds = new Set<string>();
            for (const n of attachedNotes ?? []) {
              excludeIds.add(n.id);
              for (const k of gatherDerivedKnowledge(noteIndex ?? null, n.id)) {
                excludeIds.add(k.noteId);
              }
            }
            for (const id of citedAssetIds) excludeIds.add(id);
            // 開いているノート自身の本文は毎ターン userMessage に同梱されるので、横断検索の
            // ノート本文断片からは外す（同じ文章を二重に渡さない）
            if (fileId) excludeIds.add(fileId);
            const { retrieveWikiContext } = await import("./features/wiki/retriever");
            // 横断検索のクエリは userMessage をそのまま使わない。userMessage には
            // ノート本文・添付ノート・素材が丸ごと同梱されるが、それを検索クエリに
            // 混ぜると (a) embedding が希釈されて質問と無関係な Wiki を拾い、
            // (b) 埋め込みモデルの入力上限を超えて 400 になる（XRD テーブル入りノートで
            // 28,836 トークン → multilingual-e5-large の上限 512 を大きく超過した実例）。
            // かといって質問文だけにすると「この内容全体について」のような質問で
            // ノートの主題が検索キーから消える。
            //   - 引用チャット: 引用 + 質問（従来どおり）
            //   - ページ全体チャット: タイトル + 本文の主題（見出し・段落・表の列名。
            //     数値行・コード・画像は落とす）+ 質問
            //   - それ以外（ブロック指定など本文を同梱しない経路）: 質問のみ
            const retrievalQuery = effectiveQuotedMarkdown
              ? buildQuotedRetrievalQuery(effectiveQuotedMarkdown, question)
              : pageMarkdownForRetrieval
                ? buildPageRetrievalQuery({ title, pageMarkdown: pageMarkdownForRetrieval, question })
                : question;
            wikiContext = (await retrieveWikiContext(retrievalQuery, excludeIds)) ?? undefined;
          } catch {
            // Retriever 失敗は無視（embedding が無い場合など）
          }
        }
        // 会話履歴を組み立ててサーバーに送る。
        // サーバーは stateless（session を保持しない）。履歴の正本はノート側の ScopeChat。
        // 初回 user message は store に表示用の素の質問しか入っていないので、
        // backend 履歴では quotedMarkdown を改めて挟んで context を維持する
        // （継続会話で「その単語について」と聞いたときに context が抜けるのを防ぐ）。
        // 背景のノート本文はここには積まない。毎ターン最新を userMessage 側に載せる
        // ので、履歴にも積むと会話が伸びるほど古い本文のコピーが累積してしまう。
        const history: AgentChatMessage[] = baseMessages.map((m, idx) => {
          if (idx === 0 && m.role === "user" && effectiveQuotedMarkdown) {
            return {
              role: m.role,
              content: [
                `ノート「${title}」内の以下の内容について質問があります。`,
                "",
                "---",
                effectiveQuotedMarkdown,
                "---",
                "",
                m.content,
              ].join("\n"),
            };
          }
          return { role: m.role, content: m.content };
        });
        const req: AgentRunRequest = {
          message: userMessage,
          messages: [...history, { role: "user", content: userMessage }],
          session_id: effectiveSessionId ?? undefined,
          ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {}),
          ...(wikiContext ? { wiki_context: wikiContext } : {}),
          ...(skillPrompts ? { custom_instructions: skillPrompts } : {}),
          // 外部参照（external）のときサーバーが Web 検索の強制指示を system prompt に注入する
          grounding_scope: scope,
          language: getLocale(),
          options: { max_turns: 5, ...(selectedModel && { model: selectedModel }) },
        };
        // 完了処理はノート切替後（このコンポーネントの unmount 後）にも走るため、
        // i18n 文言は送信時に確定してクロージャに固定する
        const fromNotesHeading = t("chat.sources.fromNotes");
        const webHeading = t("chat.sources.fromWeb");
        const runId = crypto.randomUUID();
        if (!chatStorageId) pendingNoteIdRunsRef.current.push(runId);
        // 実行はアプリレベル（chat-run-manager）に渡す。応答の store 反映・保存は
        // NoteApp のディスパッチャが行う: このノートが開かれていれば chatRunApplyRef
        // 経由でライブ反映、ノート切替で閉じられていればファイルの doc.chats へ書き戻す。
        chatRunManager.start(
          {
            runId,
            noteId: chatStorageId,
            chatId,
            scopeBlockIds: [...effectiveSourceBlockIds],
            quotedMarkdown: effectiveQuotedMarkdown,
            sessionId: effectiveSessionId,
            forkedFrom: effectiveForkedFrom,
            baseMessages,
            userMessage: userChatMessage,
          },
          async (signal) => {
            try {
              const response = await runAgent(req, signal);
              // Wiki コンテキストが使われた場合、引用情報を処理する。
              // 番号引用 [#N] / タイトル引用 / 全角【】を正規の [Source: "title"] に揃え、
              // hallucination を除去して、末尾に「Knowledge referenced」一覧を付ける。
              // ロジックは citation-normalize.ts に切り出してユニットテスト可能にしている。
              let assistantMessage = response.message;
              if (wikiContext) {
                const { normalizeWikiCitations, appendKnowledgeReferenced } = await import(
                  "./features/ai-assistant/citation-normalize"
                );
                const { message, sources } = normalizeWikiCitations(
                  assistantMessage,
                  wikiContext,
                );
                // モデルが実際に引用できた内部ノートだけを「ノート内の知識」として付ける。
                // 引用ゼロなら何も付けない（候補の機械的な流し込み＝誤った参照表示を廃止）。
                assistantMessage = appendKnowledgeReferenced(
                  message,
                  sources,
                  fromNotesHeading,
                );
              }
              // モデルが散文中に自前で書いた "Sources:" 見出しはモデル出力
              // なので、ローカライズ済みの「🌐 Web の出典」に差し替え、内部ノート（📓）と区別する。
              assistantMessage = assistantMessage.replace(
                /^[ \t]*(?:#{1,6}[ \t]*)?\*{0,2}Sources:?\*{0,2}[ \t]*$/im,
                `**${webHeading}**`,
              );
              // 検索 MCP（Tavily 等 = B 経路）の出典はツール結果から決定論的に拾えている。
              // モデルが散文で出典を出さない B 経路の取りこぼしを埋めるため、ここで明示的に付与する。
              // A 経路で既に「🌐 Web の出典」見出しが付いている場合は重複させない。
              const webSources = response.web_sources ?? [];
              if (webSources.length > 0 && !assistantMessage.includes(webHeading)) {
                const list = webSources
                  .map((s) => `  - [${(s.title ?? s.url).replace(/[[\]]/g, "")}](${s.url})`)
                  .join("\n");
                assistantMessage = `${assistantMessage}\n\n---\n**${webHeading}**\n${list}`;
              }
              // <!-- wiki_worthy: true/false --> タグは表示には不要なので除去する。
              // 自動 Wiki 保存はユーザーフィードバックを受けて廃止。Wiki 化は明示的なボタン操作で行う。
              const cleanMessage = assistantMessage.replace(/\s*<!--\s*wiki_worthy:\s*(?:true|false)\s*-->\s*$/, "");
              return {
                assistantMessage: {
                  role: "assistant" as const,
                  content: cleanMessage,
                  timestamp: new Date().toISOString(),
                },
                sessionId: response.session_id,
              };
            } catch (err) {
              // ユーザーが Stop した場合は中断（AbortError）。エラー文言に変換せず
              // そのまま投げ直し、manager 側に "aborted" と判定させる（エラー表示しない）。
              if (signal.aborted) throw err;
              // 既知の code（NO_MODEL_REGISTERED / 401 系）は i18n 文言に変換し、
              // manager には表示用文言を message に持つ Error として渡す契約
              throw new Error(localizeAiError(err));
            }
          },
        );
      } catch (err) {
        // プロンプト組み立て（エディタ・ストレージ依存の前処理）で失敗した場合。
        // run は未開始なので従来どおりその場でエラー表示する
        aiAssistant.setError(localizeAiError(err));
      }
    },
    [chatStorageId, aiAssistant, noteIndex, captureIndexProp, mediaIndex, title],
  );

  // チャットフォーク: 現在のチャットを一覧に退避し、指定メッセージまでの
  // コピーを新チャットとしてアクティブ化する。markDirty で新チャットも永続化する。
  const handleAiChatFork = useCallback(
    (index: number) => {
      aiAssistant.forkChatAt(index);
      markDirty();
    },
    [aiAssistant, markDirty],
  );

  // AI チャット停止（Stop ボタン）: 現在アクティブな会話の実行中 run を中断する。
  // fetch abort + サーバー側 LLM 停止で、無駄なトークン消費を止めて入力に戻れる。
  const handleAiChatStop = useCallback(() => {
    const chatId = aiAssistant.activeChatId;
    if (chatId) chatRunManager.abortRunsForChat(chatId);
  }, [aiAssistant.activeChatId]);

  // Composer 結果をドキュメント末尾にブロックとして挿入するヘルパー。
  // Compose / Insert PROV で共通利用。scope は意図的に気にせず常に末尾挿入（Composer の呼び出し点は
  // グローバルで、ブロック選択スコープに紐付かないため、末尾が最も予測可能）。
  const insertComposerResultAtEnd = useCallback(async (markdown: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const parsed = markdown.trim();
    if (!parsed) return;
    const blocks = parseMarkdownToBlocksWithMath(editor, parsed);
    if (blocks.length === 0) return;
    const allBlocks = editor.document;
    const lastBlock = allBlocks[allBlocks.length - 1];
    if (lastBlock) {
      editor.insertBlocks(blocks, lastBlock, "after");
      lastAiInsertRef.current = true;
      markDirty();
    }
  }, [markDirty]);

  // Composer 用の軽量 AI 呼び出し。Chat パネルには入らず、結果文字列だけを返す。
  // systemHint を与えるとプロンプトに前置する（Insert PROV で手順化を促す等）。
  const runComposerAgent = useCallback(async (prompt: string, systemHint?: string): Promise<string> => {
    // Composer の Ask もチャット・洞察モデルを使う（未設定ならデフォルトモデルにフォールバック）。
    const selectedModel = getChatSynthesisModelName();
    const disabledTools = getDisabledTools();
    const message = systemHint ? `${systemHint}\n\n${prompt}` : prompt;
    const response = await runAgent({
      message,
      ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {}),
      ...(skillPrompts ? { custom_instructions: skillPrompts } : {}),
      language: getLocale(),
      options: { max_turns: 5, ...(selectedModel && { model: selectedModel }) },
    });
    return response.message;
  }, [skillPrompts]);

  // verb メニュー（PR2）: 現ノートが引用している知見・洞察（reference リンク先）を
  // AttachedNote[] に変換する。本文ロードは handleAiChatSubmit 側の attachedNotes 経路が行う
  // （ここでは id / title / isWiki を解決するだけ）。
  // 同じノートを複数ブロックから引用していても 1 件に重複排除する。
  const collectCitedNotes = useCallback((): AttachedNote[] => {
    const refLinks = linkStore
      .getAllLinks()
      .filter((l) => l.layer === "knowledge" && l.type === "reference" && l.targetNoteId);
    const seen = new Set<string>();
    const result: AttachedNote[] = [];
    for (const link of refLinks) {
      const noteId = link.targetNoteId!;
      if (seen.has(noteId)) continue;
      seen.add(noteId);
      const entry = noteIndex?.notes.find((n) => n.noteId === noteId);
      result.push({
        id: noteId,
        title: entry?.title ?? noteId,
        // 知見・洞察ノートは AI 生成（source === "ai"）。loadWikiFile 経路に乗せる。
        isWiki: entry?.source === "ai",
      });
    }
    return result;
  }, [linkStore, noteIndex]);

  // Composer（Cmd+K）からの送信を受けるハンドラを ref に登録する。
  // ── 実装メモ ──
  // handleAiChatSubmit は aiAssistant ストアの state 変化のたびに再生成されるため、
  // これを useEffect の deps に入れると登録/解除が大量に繰り返される（submit 中にも
  // cleanup が走って副作用をかき乱す）。そこで最新の callback を ref 経由で拾い、
  // useEffect は一度だけ走らせる（stable callback via ref パターン）。
  const composerHandlersRef = useRef({
    handleAiChatSubmit,
    runComposerAgent,
    insertComposerResultAtEnd,
    setRightTab,
    setPickerMediaType,
    parkChat: aiAssistant.parkChat,
    collectCitedNotes,
  });
  composerHandlersRef.current = {
    handleAiChatSubmit,
    runComposerAgent,
    insertComposerResultAtEnd,
    setRightTab,
    setPickerMediaType,
    parkChat: aiAssistant.parkChat,
    collectCitedNotes,
  };

  useEffect(() => {
    if (!composerSubmitRef) return;
    composerSubmitRef.current = async (submission) => {
      const { mode, prompt, verb, scope } = submission;
      const h = composerHandlersRef.current;

      if (mode === "ask") {
        // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）
        if (!ensureAgentConfigured()) return;
        // Cmd+K で開く Composer は「新しい問いを立てる」ショートカットとして扱う。
        // 既存チャットがあれば履歴 (chats) に退避してから新セッションを開始する。
        // チャット欄を開いている状態での追加質問は、チャット欄の input を使えばよい。
        h.parkChat();
        h.setRightTab("chat");
        // このノートが @ で引用している参照先（reference リンク先 = 知見・洞察・文書ノート）
        // の中身を AI 文脈に載せる。verb（引用集合の精査）だけでなく素の質問でも、
        // 引用した論文 PDF 等の中身を踏まえて答えられるよう常に収集する。文書ノートは
        // handleAiChatSubmit 側の attachedNotes 経路で 1ホップ派生知識＋全文に展開される。
        const citedNotes = h.collectCitedNotes();
        // freshChat: parkChat() と同一 tick で呼ぶため handleAiChatSubmit のクロージャは
        // park 前の stale な state を見ている。新しいチャットとして開始することを明示し、
        // 退避済みチャットの id・履歴・セッションを引きずらないようにする
        await h.handleAiChatSubmit(
          prompt,
          citedNotes.length > 0 ? citedNotes : undefined,
          scope,
          undefined,
          { freshChat: true },
        );
        return;
      }

      if (mode === "insert-media") {
        h.setPickerMediaType("image");
        return;
      }

      // 素の window.alert ではなく、共通ガード（トースト + 設定 AI タブ導線）に統一する
      if (!ensureAgentConfigured()) return;

      try {
        if (mode === "compose") {
          const text = await h.runComposerAgent(prompt);
          await h.insertComposerResultAtEnd(text);
          return;
        }
        if (mode === "insert-prov") {
          const hint = tStatic("composer.insertProv.systemHint");
          const text = await h.runComposerAgent(prompt, hint);
          await h.insertComposerResultAtEnd(text);
          return;
        }
      } catch (err) {
        console.error("[Composer] submit failed:", err);
        // 既知の code（NO_MODEL_REGISTERED / 401 系）は i18n 文言に変換して表示する
        const baseMsg = localizeAiError(err);
        // ネットワーク系（"failed to fetch" 等）は原因切り分け用に API base と Tauri 判定を併記する。
        // 検証者がそのままコピーして共有できるよう、複数行の alert で出す。
        const isNetworkErr = /failed to fetch|networkerror|err_/i.test(baseMsg);
        if (isNetworkErr) {
          const detail = [
            baseMsg,
            "",
            `API base: ${apiBase()}`,
            `Tauri detection: ${tauriDetectionDetail() || "(none — running as web)"}`,
            `Location protocol: ${window.location?.protocol ?? "unknown"}`,
            "",
            "Open the AI Chat tab and tap the (i) icon to copy a full diagnostics report.",
          ].join("\n");
          window.alert(detail);
        } else {
          window.alert(baseMsg);
        }
      }
    };
    return () => {
      if (composerSubmitRef.current) composerSubmitRef.current = null;
    };
  }, [composerSubmitRef]);

  // WikiBanner 等の外部 UI から SidePeek を開けるよう、setSidePeekNoteId を ref に登録する。
  // ノート未開時は ref が null のままになり、呼び出し側はフォールバックで全画面遷移する。
  useEffect(() => {
    if (!openSidePeekRef) return;
    openSidePeekRef.current = (noteId: string) => setSidePeekNoteId(noteId);
    return () => {
      if (openSidePeekRef.current) openSidePeekRef.current = null;
    };
  }, [openSidePeekRef]);

  // 素材サイドピーク版の命令口。エディタ表示中は memo: ソースのその場プレビューを
  // エディタ内の素材ピークで開く（アンマウント時は null に戻り、呼び出し側は
  // リスト用素材ピークにフォールバックする）。
  useEffect(() => {
    if (!openMaterialPeekRef) return;
    openMaterialPeekRef.current = (entry: MediaIndexEntry) => setMaterialSidePeekEntry(entry);
    return () => {
      if (openMaterialPeekRef.current) openMaterialPeekRef.current = null;
    };
  }, [openMaterialPeekRef]);

  // 現ノートの引用（knowledge layer = reference リンク）数を Composer に渡すため ref に登録。
  // Composer は NoteApp 直下にあり linkStore に触れないので、この imperative ref で橋渡しする。
  useEffect(() => {
    if (!composerCitationRef) return;
    composerCitationRef.current = () =>
      linkStore.getAllLinks().filter((l) => l.layer === "knowledge").length;
    return () => {
      if (composerCitationRef.current) composerCitationRef.current = null;
    };
  }, [composerCitationRef, linkStore]);

  // AI 回答から別ノートとして派生
  const handleAiDeriveFromChat = useCallback(
    async (question: string, answer: string) => {
      if (!fileId || !editorRef.current) return;
      // 派生タイトルはユーザーの質問を要約する（AI 応答を渡すと回答内の主張が拾われ、
      // トピック中心の探しやすいタイトルにならない）。
      // 引用テキストがある場合は質問と一緒に渡す（「単語の意味を教えて」だけでは何の単語か
      // 分からないため、引用元の単語をタイトルに含められるようにする）。
      const titleSource = aiAssistant.quotedMarkdown
        ? `引用テキスト:\n${aiAssistant.quotedMarkdown}\n\n質問:\n${question}`
        : question;
      const chatTitle = await generateTitle(titleSource).catch(() => question.slice(0, 25));
      const doc = buildAiDerivedDocument({
        title: chatTitle,
        quotedMarkdown: aiAssistant.quotedMarkdown || question,
        question,
        agentResponse: {
          session_id: "",
          message: answer,
          tool_calls: [],
          provenance_id: null,
          token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          model: null,
        },
        sourceNoteId: fileId,
        sourceBlockIds: aiAssistant.sourceBlockIds,
        parseMarkdown: (md) => parseMarkdownToBlocksWithMath(editorRef.current, md),
      });
      // Split View: 現在のドキュメントを派生元として保存
      const currentBlocks = editorRef.current.document;
      onSourceDocChange({
        version: LATEST_DOCUMENT_VERSION,
        title,
        pages: [{
          id: "main",
          title,
          blocks: currentBlocks,
          labels: Object.fromEntries(labelStore.getSnapshot().labels),
          provLinks: [],
          knowledgeLinks: [],
        }],
        createdAt: initialDoc?.createdAt || new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      });
      await onAiDeriveNote(doc);
    },
    [fileId, title, aiAssistant, labelStore, initialDoc, onAiDeriveNote, onSourceDocChange],
  );

  // R2 / Loop M2: AI 回答を knowledge ノート（知見=claim / 洞察=atom）として手動取り込みする。
  // 砂時計の首は人間に戻す方針なので自動 ingest はしない。kind はユーザーが選ぶ。
  //
  // フロー:
  //   1. 引用フッター等を除去（cleanSuggestionText）
  //   2. 選んだ kind に合わせて LLM で「タイトル + 本文」に整形（他の知見/洞察と体裁を揃える）
  //   3. 整形 markdown を editor.tryParseMarkdownToBlocks でブロック化（テーブル・@ が正しく展開）
  //   4. verb が精査した引用ノートを「引用元」として @<title> + reference リンクで引き継ぐ
  // 「ナレッジにする」候補生成（Loop M2 改）。
  //   旧実装は AI 回答を 1 ノートに即整形して保存していたが、「押すまで何が出るか
  //   見えない」ため押しにくかった。今は AI 回答を ingester / atomizer パイプラインに
  //   通して**複数候補**を作り、ユーザーが選んだものだけを保存する（脱ブラックボックス化、
  //   [[project-knowledge-simplicity-philosophy]]）。砂時計の首＝人間の選択は維持される。
  //
  //   knowledge は 知見(claim) と 洞察(atom) を 1 リストに混ぜて出す（kind は候補ごとの
  //   バッジで示す。押す前に二択を迫らない = kind 版「押すまで見えない」の解消）。
  //   - 知見(claim): AI 回答を ingester（chat: prefix = document-mode で命題を多めに抽出）に
  //     通す。ingester は一度だけ走らせ、知見候補ができた時点で onClaimsReady で即返す
  //     （プログレッシブ表示。洞察は時間がかかるので待たせない）。
  //   - 洞察(atom): 抽出した知見を atomizer に渡して一般化候補を作る。中間 claim は保存しない
  //     （揮発）ので derivedFromClaims は空に倒し、由来は現ノート（derivedFromNotes）に記録する。
  const handleGenerateKnowledgeCandidates = useCallback(
    async (
      answer: string,
      onClaimsReady?: (claims: KnowledgeCandidate[]) => void,
    ): Promise<KnowledgeCandidate[]> => {
      // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）。
      // [] を返すと候補ピッカーが「候補が見つからなかった」と誤表示するため、
      // throw で静かに中断する（panel 側の catch は表示を出さずリセットする）。
      if (!ensureAgentConfigured()) throw new Error("AI model not configured");
      const cleaned = cleanSuggestionText(answer);
      const model = getSelectedModel() || null;
      const noteTitle = initialDoc?.title || "Chat";
      // 既存 Wiki タイトル一覧（重複タイトルの抑制 + インライン引用解決用）。
      const existingWikis = (noteIndex?.notes ?? [])
        .filter((n) => n.source === "ai" && n.wikiKind)
        .map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
      const existingWikiTitles = existingWikis.map((w) => ({ id: w.id, title: w.title }));
      // verb が精査した引用知見（現ノートの reference リンク先）を PROV の素地として温存する。
      const citedIds = collectCitedNotes().map((n) => n.id);

      // 1) ingester で AI 回答から知見(claim)を抽出（chat: prefix で document-mode）。一度だけ。
      const ingestRes = await ingestFromChat(
        [{ role: "assistant", content: cleaned }],
        noteTitle,
        existingWikis,
        getLocale(),
      );
      const claimOutputs = ingestRes.wikis.filter((w) => w.kind === "claim");
      if (claimOutputs.length === 0) return [];

      // 知見候補を組み立てて即コールバック（プログレッシブ表示）。
      const claimCandidates: KnowledgeCandidate[] = claimOutputs.map((w) => {
        const baseDoc = buildWikiDocument(
          w,
          fileId ?? "",
          ingestRes.model ?? model,
          noteTitle,
          existingWikiTitles,
          getLocale(),
        );
        const doc: GraphiumDocument = citedIds.length
          ? { ...baseDoc, wikiMeta: { ...baseDoc.wikiMeta!, citedKnowledgeIds: citedIds } }
          : baseDoc;
        return {
          key: crypto.randomUUID(),
          kind: "claim",
          title: doc.title,
          preview: extractBodyPreview(doc, 160),
          doc,
        };
      });
      onClaimsReady?.(claimCandidates);

      // 2) 抽出した知見を atomizer に渡して洞察(atom)候補を作る。
      //    洞察生成が失敗しても知見候補は返す（知見だけでも価値がある）。
      let atomCandidates: KnowledgeCandidate[] = [];
      try {
        const snapshots: ClaimSnapshot[] = claimOutputs.map((w, i) => ({
          id: `eph-claim-${i}`,
          title: w.title,
          bodyPreview: w.sections.map((s) => s.content).join("\n\n").slice(0, 240),
          level: w.level,
          relatedClaims: [],
          sourceSummaryPreviews: [],
          atomType: undefined,
        }));
        const atomRes = await atomizeConcepts(snapshots, getLocale(), {
          model: model ?? getChatSynthesisModelName() ?? undefined,
        });
        atomCandidates = atomRes.atoms.map((a) => {
          // 中間 claim は揮発（保存しない）ため、ephemeral id を指す derivedFromClaims は捨てる
          // （リンク切れ防止）。由来は現ノート（derivedFromNotes）に記録する。
          const baseDoc = buildAtomDocument(
            { ...a, derivedFromClaims: [], derivedFromConceptTitles: [] },
            atomRes.model ?? model,
            getLocale(),
          );
          const doc: GraphiumDocument = {
            ...baseDoc,
            wikiMeta: {
              ...baseDoc.wikiMeta!,
              derivedFromNotes: fileId ? [fileId] : [],
              ...(citedIds.length ? { citedKnowledgeIds: citedIds } : {}),
            },
          };
          return {
            key: crypto.randomUUID(),
            kind: "atom",
            title: doc.title,
            preview: extractBodyPreview(doc, 160),
            doc,
          };
        });
      } catch (err) {
        console.error("洞察候補の生成に失敗:", err);
      }

      return [...claimCandidates, ...atomCandidates];
    },
    [collectCitedNotes, fileId, initialDoc?.title, noteIndex],
  );

  // 選択された候補を保存する。候補ごとに 1 ノート（onCreateKnowledgeNote が
  // PROV リビジョン記録 + embedding + wikiLog まで行う）。
  const handleAdoptKnowledgeCandidates = useCallback(
    async (candidates: KnowledgeCandidate[]) => {
      if (!onCreateKnowledgeNote) return;
      for (const c of candidates) {
        await onCreateKnowledgeNote(c.doc, c.kind);
      }
    },
    [onCreateKnowledgeNote],
  );

  // 挿入されたブロック配列に対して、抽出済みラベルを path 経由で実 ID に解決して
  // labelStore に適用し、連続する手順を informed_by で自動連結する。
  // 手順は「見出し + procedure ラベル」と「step コンテナ」の 2 通りがあり、
  // step はラベルを持たないので inserted のツリーから直接拾う。
  // handleInsertToScope と handleReplaceBlocks の双方から使う。
  const applyExtractedLabels = useCallback(
    (inserted: any[], extracted: { path: number[]; label: string }[]) => {
      // 同じ親を持つ step 同士を文書順に連結する。
      // 入れ子の step（親→子）は「含む」関係であって「前手順」ではないので繋がない。
      const chainSiblingSteps = (list: any[]) => {
        const stepIds: string[] = [];
        for (const b of list) {
          if (b?.type === "step" && b.id) stepIds.push(b.id);
          if (b?.children?.length) chainSiblingSteps(b.children);
        }
        for (let i = 1; i < stepIds.length; i++) {
          linkStore.addLink({
            sourceBlockId: stepIds[i],
            targetBlockId: stepIds[i - 1],
            type: "informed_by",
            createdBy: "ai",
          });
        }
      };
      setTimeout(() => chainSiblingSteps(inserted), 0);

      if (extracted.length === 0) return;
      const resolveByPath = (path: number[]): any | null => {
        let nodes: any[] = inserted as any[];
        let node: any = null;
        for (const idx of path) {
          node = nodes?.[idx];
          if (!node) return null;
          nodes = node.children ?? [];
        }
        return node;
      };
      setTimeout(() => {
        const procedureHeadingIds: string[] = [];
        for (const { path, label } of extracted) {
          const block = resolveByPath(path);
          if (!block?.id) continue;
          labelStore.setLabel(block.id, label);
          if (label === "procedure" && block.type === "heading" && (block.props?.level ?? 0) >= 2) {
            procedureHeadingIds.push(block.id);
          }
        }
        // 同レベル連続 procedure を informed_by で連結（/template Step1→Step2 と同じ意図）
        for (let i = 1; i < procedureHeadingIds.length; i++) {
          linkStore.addLink({
            sourceBlockId: procedureHeadingIds[i],
            targetBlockId: procedureHeadingIds[i - 1],
            type: "informed_by",
            createdBy: "ai",
          });
        }
      }, 0);
    },
    [labelStore, linkStore],
  );

  // 1 ブロックに `[Source]` 由来の reference リンク（knowledge レイヤ）を張る。
  // 引用ピッカー handleCitePickerConfirm と同じデータモデルで、Graph タブにエッジが出る。
  const addSourceRefLinks = useCallback(
    (blockId: string, wikiIds: string[]) => {
      for (const wikiId of wikiIds) {
        linkStore.addLink({
          sourceBlockId: blockId,
          targetBlockId: "",
          targetNoteId: wikiId,
          type: "reference",
          createdBy: "ai",
        });
      }
    },
    [linkStore],
  );

  // linkifySourceMentions が集めた refs（path + wikiIds）を、挿入後のブロック ID に解決して
  // reference リンクを張る。applyExtractedLabels と同じ path 解決・setTimeout(0) 流儀。
  const applySourceRefs = useCallback(
    (inserted: any[], refs: { path: number[]; wikiIds: string[] }[]) => {
      if (refs.length === 0) return;
      const resolveByPath = (path: number[]): any | null => {
        let nodes: any[] = inserted;
        let node: any = null;
        for (const idx of path) {
          node = nodes?.[idx];
          if (!node) return null;
          nodes = node.children ?? [];
        }
        return node;
      };
      setTimeout(() => {
        for (const { path, wikiIds } of refs) {
          const block = resolveByPath(path);
          if (block?.id) addSourceRefLinks(block.id, wikiIds);
        }
      }, 0);
    },
    [addSourceRefLinks],
  );

  // AI 回答をスコープに反映
  const handleInsertToScope = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;

      const targetBlockId = aiAssistant.sourceBlockIds[0];
      if (!targetBlockId) {
        // ページ全体チャット: ドキュメント末尾に挿入
        const parsed = parseMarkdownToBlocksWithMath(editor, markdown);
        if (parsed.length === 0) return;
        const extractedRes = extractLabelMarkersFromBlocks(parsed);
        // AI が旧語彙で出した procedure 見出しは挿入前に step へ変換する
        const { blocks, labels } = convertExtractedProcedureBlocksToSteps(
          extractedRes.blocks,
          extractedRes.labels,
        );
        const { blocks: linked, refs } = linkifySourceMentions(blocks, wikiTitleToNoteId);
        const allBlocks = editor.document;
        const lastBlock = allBlocks[allBlocks.length - 1];
        if (lastBlock) {
          const inserted = editor.insertBlocks(linked, lastBlock, "after");
          applyExtractedLabels(inserted as any[], labels);
          applySourceRefs(inserted as any[], refs);
        }
        lastAiInsertRef.current = true;
        markDirty();
        return;
      }
      const targetBlock = editor.getBlock(targetBlockId);
      if (!targetBlock) return;
      // 見出し・step は「まとまり」なので、その配下の末尾に挿入する
      // （step の場合は最後の子の後ろ＝step の中に入る）
      if (targetBlock.type === "heading" || targetBlock.type === "step") {
        const parsed = parseMarkdownToBlocksWithMath(editor, markdown);
        if (parsed.length === 0) return;
        const extractedRes = extractLabelMarkersFromBlocks(parsed);
        // AI が旧語彙で出した procedure 見出しは挿入前に step へ変換する
        const { blocks, labels } = convertExtractedProcedureBlocksToSteps(
          extractedRes.blocks,
          extractedRes.labels,
        );
        const { blocks: linked, refs } = linkifySourceMentions(blocks, wikiTitleToNoteId);
        const scope = collectBlockScope(editor.document, targetBlock);
        const insertAfterBlock = scope[scope.length - 1];
        const inserted = editor.insertBlocks(linked, insertAfterBlock, "after");
        applyExtractedLabels(inserted as any[], labels);
        applySourceRefs(inserted as any[], refs);
      } else {
        // 段落・リストへの追記: マーカーは平文のまま見えてしまうので、
        // 単純な文字列レベルで剥がしてから追記する（ラベル付与はスキップ）。
        const stripped = markdown.replace(/^\s*\[\[label:[a-z]+\]\][ 　]?/gm, "");
        // `[Source: "title"]` は青い @title mention に変換して追記する（クリックで Wiki を開ける）。
        const { nodes, wikiIds } = splitSourceMentions("\n" + stripped, {}, wikiTitleToNoteId);
        const existingContent = Array.isArray(targetBlock.content) ? targetBlock.content : [];
        const newContent = [...existingContent, ...nodes];
        editor.updateBlock(targetBlockId, { content: newContent });
        if (wikiIds.length > 0) {
          setTimeout(() => addSourceRefLinks(targetBlockId, wikiIds), 0);
        }
      }
      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant.sourceBlockIds, applyExtractedLabels, applySourceRefs, wikiTitleToNoteId, addSourceRefLinks],
  );

  // AI 回答で対象ブロックを置換
  const handleReplaceBlocks = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;
      const blockIds = aiAssistant.sourceBlockIds;
      if (blockIds.length === 0) return;

      const parsedBlocks = parseMarkdownToBlocksWithMath(editor, markdown);
      if (parsedBlocks.length === 0) return;
      const extractedRaw = extractLabelMarkersFromBlocks(parsedBlocks);
      // AI が旧語彙で出した procedure 見出しは挿入前に step へ変換する
      const { blocks: parsedNoLabels, labels: extractedLabels } =
        convertExtractedProcedureBlocksToSteps(extractedRaw.blocks, extractedRaw.labels);
      // `[Source: "title"]` を青い @title mention に変換し、reference 先 wikiId を集める。
      const { blocks: newBlocks, refs: sourceRefs } =
        linkifySourceMentions(parsedNoLabels, wikiTitleToNoteId);

      const firstBlock = editor.getBlock(blockIds[0]);
      if (!firstBlock) return;

      let inserted: any[] = [];
      if (firstBlock.type === "step") {
        // step コンテナ: 子ブロックを丸ごと置換（step 自体とタイトルは残す）。
        // 見出しと違い範囲は親子関係なので、"after" 挿入だと step の外に出てしまう。
        const scope = collectBlockScope(editor.document, firstBlock);
        removeBlockMetadata(scope.slice(1).map((b) => b.id));
        const updated = editor.updateBlock(firstBlock, { children: newBlocks } as any);
        inserted = ((updated as any)?.children ?? []) as any[];
      } else if (firstBlock.type === "heading") {
        // 見出しスコープ: 見出し配下のブロックを置換（見出し自体は残す）
        const scope = collectBlockScope(editor.document, firstBlock);
        // 見出し以外のスコープブロックを削除
        const scopeIds = scope.slice(1).map((b) => b.id);
        removeBlockMetadata(scopeIds);
        for (let i = scope.length - 1; i >= 1; i--) {
          editor.removeBlocks([scope[i].id]);
        }
        // 見出しの直後に新しいブロックを挿入
        inserted = editor.insertBlocks(newBlocks, firstBlock, "after") as any[];
      } else if (blockIds.length === 1) {
        // 単一ブロック: 内容を置換
        const parsed = newBlocks[0];
        if (parsed && firstBlock.type === parsed.type) {
          // 同じブロックタイプなら content を直接更新（ラベル適用なし: id 解決できないため）
          editor.updateBlock(blockIds[0], { content: parsed.content });
          // 単一ブロック更新時は extractedLabels の対象外。reference リンクは
          // path [0] の wikiId を更新先ブロックに直接張る。
          const ref0 = sourceRefs.find((r) => r.path.length === 1 && r.path[0] === 0);
          if (ref0) setTimeout(() => addSourceRefLinks(blockIds[0], ref0.wikiIds), 0);
        } else {
          // ブロックタイプが異なる場合は削除→挿入
          inserted = editor.insertBlocks(newBlocks, firstBlock, "after") as any[];
          removeBlockMetadata([blockIds[0]]);
          editor.removeBlocks([blockIds[0]]);
        }
      } else {
        // 複数ブロック選択: 最初のブロックの後に挿入し、元のブロックを削除
        inserted = editor.insertBlocks(newBlocks, firstBlock, "before") as any[];
        removeBlockMetadata(blockIds);
        editor.removeBlocks(blockIds);
      }

      if (inserted.length > 0) {
        applyExtractedLabels(inserted, extractedLabels);
        applySourceRefs(inserted, sourceRefs);
      }

      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant, removeBlockMetadata, applyExtractedLabels, applySourceRefs, wikiTitleToNoteId, addSourceRefLinks],
  );

  // ── 初期データの復元 ──
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !initialDoc) return;
    initializedRef.current = true;
    if (initialDoc.pages.length > 0) {
      const page = initialDoc.pages[0];
      if (page.labels) {
        for (const [blockId, label] of Object.entries(page.labels)) {
          labelStore.setLabel(blockId, label);
        }
      }
      const allLinks = [
        ...(page.provLinks ?? []),
        ...(page.knowledgeLinks ?? []),
        ...(page.links ?? []),
      ];
      if (allLinks.length > 0) {
        linkStore.restoreLinks(allLinks);
      }
      if (page.mediaInlineLabels) {
        mediaInlineLabelStore.restoreSnapshot(page.mediaInlineLabels);
      }
      mediaOcrStore.restoreSnapshot(page.mediaOcr);
      blockAlignmentStore.restoreSnapshot(page.blockAlignments);
      // テーブル注釈（undefined ならクリア）。旧 logTables / indexTables はここで
      // 変換され、以降は tableMeta だけがふるまいの真実になる
      const tableMeta = migrateTableMeta(page);
      tableMetaStore.restore(tableMeta);
      const tableMetaEntries = Object.entries(tableMeta ?? {});
      // 日時が入る列を持つテーブルの行数を先に記録しておく
      // （開いて最初の行追加から日時が入るように）
      primeLogTableRowTracking(
        page.blocks,
        tableMetaEntries
          .filter(([, meta]) => hasColumnType(meta, "datetime-auto"))
          .map(([blockId]) => blockId)
      );
      // 行に紐付いたノートは Graph 表示用の noteLinks にも反映する
      const existingLinks = noteLinksRef.current;
      let added = false;
      for (const [blockId, meta] of tableMetaEntries) {
        for (const noteId of Object.values(meta.noteLinks ?? {})) {
          const exists = existingLinks.some((l) => l.targetNoteId === noteId);
          if (!exists) {
            existingLinks.push({
              targetNoteId: noteId,
              sourceBlockId: blockId,
              type: "derived_from",
            });
            added = true;
          }
        }
      }
      if (added) {
        noteLinksRef.current = [...existingLinks];
      }
    }
    if (initialDoc.chats && initialDoc.chats.length > 0) {
      aiAssistant.restoreChats(initialDoc.chats);
    }
  }, [initialDoc, labelStore, linkStore, tableMetaStore, aiAssistant]);

  // ── 実行中チャット run のライブ反映ハンドル登録と復元 ──

  // aiAssistant / markDirty は state 変化のたびに再生成されるため、composerHandlersRef
  // と同じ「stable callback via ref」パターンで最新を拾う（useEffect の再実行を防ぐ）
  const chatRunHandlersRef = useRef({ aiAssistant, markDirty });
  chatRunHandlersRef.current = { aiAssistant, markDirty };

  // NoteApp のディスパッチャが「元ノートが今も開かれているか」を判定し、開かれて
  // いればライブ store へ反映するためのハンドル。unmount（ノート切替）で null に
  // 戻り、ディスパッチャはファイル書き戻しへフォールバックする
  useEffect(() => {
    if (!chatRunApplyRef) return;
    // 同じノートに別の実行中 run が残っている間は loading を維持する
    // （無関係な run の完了が実行中チャットの二重送信ガードを外さないように）。
    // 未採番（noteId null）の並行 run は照合できないが、従来どおり解除で許容する
    const hasOtherRunningRun = (run: ChatRunState): boolean =>
      run.noteId
        ? chatRunManager
            .getRunsForNote(run.noteId)
            .some((r) => r.runId !== run.runId && r.status === "running")
        : false;
    chatRunApplyRef.current = {
      noteId: chatStorageId,
      // 未採番（noteId が null）の run は noteId の一致では照合できないため、
      // このエディタインスタンスが開始した run（pendingNoteIdRunsRef に残って
      // いるもの）だけを自分宛と判定する。別の未採番ノートに切り替えた場合は
      // 新インスタンスの ref が空なので誤配しない
      ownsRun: (runId) => pendingNoteIdRunsRef.current.includes(runId),
      applyResult: (run) => {
        const h = chatRunHandlersRef.current;
        const existing = h.aiAssistant.chats.find((c) => c.id === run.chatId) ?? null;
        const chat = buildRunScopeChat(run, existing);
        h.aiAssistant.applyChatRunResult(chat, run.result?.sessionId ?? null, {
          keepLoading: hasOtherRunningRun(run),
        });
        // 永続化は従来どおりエディタの保存フロー（buildDocument が store の chats を
        // 読む）に乗せる。ファイル直書きしない（次のオートセーブと競合するため）
        h.markDirty();
      },
      applyError: (run) => {
        chatRunHandlersRef.current.aiAssistant.applyChatRunError(
          run.chatId,
          run.errorMessage ?? "",
          { keepLoading: hasOtherRunningRun(run) },
        );
      },
      applyAborted: (run) => {
        // 中断はエラーではない。応答（assistant）なしで会話を確定し loading を解除する。
        // buildRunScopeChat は status !== "done" のとき user メッセージまでを返すので、
        // applyChatRunResult に通せば「質問だけ」の会話になる。sessionId は送信時のものを
        // 維持し（result が無いので run.sessionId）、markDirty で保存に乗せる。
        const h = chatRunHandlersRef.current;
        const existing = h.aiAssistant.chats.find((c) => c.id === run.chatId) ?? null;
        const chat = buildRunScopeChat(run, existing);
        h.aiAssistant.applyChatRunResult(chat, run.sessionId, {
          keepLoading: hasOtherRunningRun(run),
        });
        h.markDirty();
      },
      refreshChats: (doc) => {
        if (doc.chats && doc.chats.length > 0) {
          chatRunHandlersRef.current.aiAssistant.restoreChats(doc.chats);
        }
      },
    };
    return () => {
      if (chatRunApplyRef.current) chatRunApplyRef.current = null;
    };
  }, [chatRunApplyRef, chatStorageId]);

  // ノート切替からの復帰時、このノート宛の実行中 run があれば会話とローディング
  // 表示を復元する（remount で store が初期化されるため）。完了済みで未処理の run は
  // 確定形で展開する（結果の反映・保存は NoteApp のディスパッチャが冪等に行う）。
  // エラー済み run はここで一度だけ表示して消費する（エラーは保存しない現行仕様）。
  const runRestoredRef = useRef(false);
  useEffect(() => {
    if (runRestoredRef.current || !chatStorageId) return;
    runRestoredRef.current = true;
    const runs = chatRunManager.getRunsForNote(chatStorageId);
    if (runs.length === 0) return;
    // 複数 run（Composer 経由の並行等）は最後の run を優先して復元する。先行する
    // エラー run は表示先がなく残留し続けるため、ここで掃除する
    const run = runs[runs.length - 1];
    for (const r of runs) {
      if (r.runId !== run.runId && r.status === "error") {
        chatRunManager.consume(r.runId);
      }
    }
    const existing = initialDoc?.chats?.find((c) => c.id === run.chatId) ?? null;
    const chat = buildRunScopeChat(run, existing);
    if (run.status === "error") {
      aiAssistant.resumeRunningChat(chat, {
        sourceBlockIds: run.scopeBlockIds,
        quotedMarkdown: run.quotedMarkdown,
        sessionId: run.sessionId,
        forkedFrom: run.forkedFrom,
        running: false,
        error: run.errorMessage ?? "",
      });
      chatRunManager.consume(run.runId);
    } else {
      aiAssistant.resumeRunningChat(chat, {
        sourceBlockIds: run.scopeBlockIds,
        quotedMarkdown: run.quotedMarkdown,
        sessionId: (run.status === "done" ? run.result?.sessionId : null) ?? run.sessionId,
        forkedFrom: run.forkedFrom,
        running: run.status === "running",
      });
    }
    // 「ノートに戻れば会話の続きが見える」ように Chat タブを開く。実行中・
    // 未処理完了・エラーの復元時だけ動くので、通常のノート閲覧には影響しない
    setRightTab("chat");
  }, [chatStorageId, aiAssistant, initialDoc]);

  // ── グローバルコールバック登録 ──

  // 前手順リンク
  useEffect(() => {
    setOnPrevStepLinkSelected((sourceBlockId: string, targetBlockId: string) => {
      linkStore.addLink({
        sourceBlockId,
        targetBlockId,
        type: "informed_by",
        createdBy: "human",
      });
    });
    return () => { setOnPrevStepLinkSelected(null); };
  }, [linkStore]);

  // インデックステーブル用のグローバルコールバック登録
  useEffect(() => {
    setIndexTableCallbacks({
      files,
      currentFileId: fileId,
      onNavigateNote,
      onRefreshFiles,
      onOpenSidePeek: (noteId: string) => setSidePeekNoteId(noteId),
      onAddNoteLink: (targetNoteId: string, sourceBlockId: string) => {
        const exists = noteLinksRef.current.some(
          (l) => l.targetNoteId === targetNoteId && l.sourceBlockId === sourceBlockId
        );
        if (!exists) {
          noteLinksRef.current = [
            ...noteLinksRef.current,
            { targetNoteId, sourceBlockId, type: "derived_from" },
          ];
          markDirty();
        }
      },
    });
    return () => { setIndexTableCallbacks(null); };
  }, [files, fileId, onNavigateNote, onRefreshFiles, markDirty]);

  // エディタ内の @ノート名クリックでサイドピークを開く
  useEffect(() => {
    const isMentionSpan = (el: HTMLElement): boolean => {
      if (el.getAttribute("data-style-type") !== "textColor" || el.getAttribute("data-value") !== "blue") return false;
      if (!el.closest(".bn-editor")) return false;
      if (el.closest("table")) return false;
      const text = el.textContent?.trim();
      return !!text && text.startsWith("@") && !text.startsWith("@#");
    };
    const resolveMentionNoteId = (noteName: string): { noteId: string; isWiki: boolean } | null => {
      // ノートから検索
      const found = noteIndex?.notes.find((n) => n.title === noteName);
      if (found) return { noteId: found.noteId, isWiki: found.source === "ai" };
      const file = files.find(
        (f) => f.name.replace(/\.(graphium|provnote)\.json$/, "") === noteName
      );
      if (file) return { noteId: file.id, isWiki: false };
      // Wiki から検索（🤖 プレフィックスを除去して検索）
      const cleanName = noteName.replace(/^🤖\s*/, "");
      const wikiEntry = noteIndex?.notes.find(
        (n) => n.source === "ai" && (n.title === noteName || n.title === cleanName)
      );
      if (wikiEntry) return { noteId: wikiEntry.noteId, isWiki: true };
      return null;
    };
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // サイドピーク内のメンションは、そのピーク自身の linkStore で解決する必要があるため
      // ここでは扱わない（side-peek.tsx の専用ハンドラが処理する）。
      if (target.closest("[data-side-peek]")) return;
      // 本文内の通常リンク（http(s)）はサイドピークのリーダーで開く。
      // アプリ chrome の <a> を誤爆しないよう、編集領域（contenteditable）内に限定する。
      const linkEl = target.closest("a[href]") as HTMLAnchorElement | null;
      if (linkEl && linkEl.closest('[contenteditable="true"]')) {
        const href = linkEl.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          setMaterialSidePeekEntry(buildUrlPeekEntry(href, mediaIndex ?? null));
          return;
        }
      }
      if (!isMentionSpan(target)) return;
      const noteName = target.textContent!.trim().slice(1);
      // まず記録済みリンク（linkStore）から厳密な ID で解決する。挿入時に
      // targetNoteId を記録してあるので、同名ノートが複数あっても正しく開ける。
      // 解決できなければタイトル逆引きにフォールバック（旧データや素材引用向け）。
      const blockId = target.closest("[data-id]")?.getAttribute("data-id") ?? null;
      const resolved =
        resolveMentionTargetFromLinks(blockId, noteName, linkStore.getAllLinks(), noteIndex) ??
        resolveMentionNoteId(noteName);
      if (resolved) {
        e.preventDefault();
        e.stopPropagation();
        // References の「Source: @ラベル」等は linkStore の targetNoteId に外部ソース ID
        // （url:/pdf:/document:/chat:）がそのまま入る。ノート ID として SidePeek に渡すと
        // loadFile が失敗して「読み込みに失敗しました」になるため、素材ピークへ振り分ける。
        const ext = parseExternalSource(resolved.noteId);
        if (ext) {
          if (ext.kind === "url") {
            setMaterialSidePeekEntry(buildUrlPeekEntry(ext.key, mediaIndex ?? null));
          } else if (ext.kind === "pdf" || ext.kind === "document") {
            const entry = mediaIndex?.media.find((m) => m.fileId === ext.key);
            if (entry) setMaterialSidePeekEntry(entry);
          } else if (ext.kind === "memo") {
            // メモはアプリ内に実体があるので、メモギャラリーの該当詳細を開く
            onOpenMemoSource?.(ext.key);
          }
          // chat: は開ける実体が無いので何もしない（グラフノードと同じ扱い）
          return;
        }
        // ノート / Wiki どちらでもまずサイドピークで開く。SidePeek 内の「Open full」で
        // 完全表示に切り替えられる方が、いきなりページ遷移するより流れが良い。
        // Wiki の場合は SidePeek が wiki: プレフィックスで loadWikiFile を呼ぶ。
        const peekId = resolved.isWiki ? `wiki:${resolved.noteId}` : resolved.noteId;
        setSidePeekNoteId(peekId);
        return;
      }
      // ノートで解決できなければ、@ 引用したドキュメント素材として解決を試みる。
      // citedAssetFileIds の中から表示名が一致する素材を逆引きし、素材サイドピーク（PDF 等）を開く。
      const assetFileId = citedAssetFileIdsRef.current.find((fid) => {
        const entry = mediaIndex?.media.find((m) => m.fileId === fid);
        return entry?.name === noteName;
      });
      if (assetFileId) {
        const entry = mediaIndex?.media.find((m) => m.fileId === assetFileId);
        if (entry) {
          e.preventDefault();
          e.stopPropagation();
          setMaterialSidePeekEntry(entry);
          return;
        }
      }
      // それでも解決できない場合: source 引用が「派生元の文書からの引用テキスト」で、
      // ノートにも @素材にも一致しないケース（知見/claim が document:/pdf: から派生したとき）。
      // この知見の derivedFromNotes にある文書/PDF 素材をピークで開く。再生成でリネームされた
      // 旧タイトル引用や、文書由来の引用文はノートとして解決できないので、ここで源泉文書に橋渡しする。
      const derived = initialDoc?.wikiMeta?.derivedFromNotes ?? [];
      for (const sourceId of derived) {
        const ext = /^(document|pdf):(.+)$/.exec(sourceId);
        if (!ext) continue;
        const entry = mediaIndex?.media.find((m) => m.fileId === ext[2]);
        if (entry) {
          e.preventDefault();
          e.stopPropagation();
          setMaterialSidePeekEntry(entry);
          return;
        }
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [noteIndex, files, mediaIndex, initialDoc, linkStore, onOpenMemoSource]);

  // スラッシュメニューからのインデックステーブル登録コールバック
  // （挿入されたテーブルの先頭列に note-link を付ける。テンプレート適用の columnTypes も同じ関数）
  useEffect(() => {
    setRegisterIndexTableCallback((blockId: string) => {
      addFirstColumnType(blockId, "note-link");
    });
    return () => { setRegisterIndexTableCallback(null); };
  }, [addFirstColumnType]);

  // スラッシュメニューからの時系列テーブル登録コールバック
  // （挿入されたテーブルの先頭列に datetime-auto を付ける）
  useEffect(() => {
    setRegisterLogTableCallback((blockId: string) => {
      addFirstColumnType(blockId, "datetime-auto");
    });
    return () => { setRegisterLogTableCallback(null); };
  }, [addFirstColumnType]);

  // スコープ派生ボタン → 別ノートとして作成
  useEffect(() => {
    setOpenLinkDropdownFn((params) => {
      const sourceBlockId = params.sourceBlockId;
      const block = editorRef.current?.getBlock(sourceBlockId);
      const derivedTitle = extractBlockTitle(block) || tStatic("editor.derivedNote");
      onDeriveNote(derivedTitle, sourceBlockId);
    });
    return () => { setOpenLinkDropdownFn(null); };
  }, [onDeriveNote]);

  // ブロックメニュー「メモ」→ ブロック紐付きメモ入力を開く
  // onCreateNoteMemo が無い文脈（保存経路が無い）では登録しない = メニュー項目も出ない
  useEffect(() => {
    if (!onCreateNoteMemo) return;
    setOpenBlockMemoFn((params) => {
      setBlockMemoTarget(params);
    });
    return () => { setOpenBlockMemoFn(null); };
  }, [onCreateNoteMemo]);


  // ── エディタ内 video/audio の Blob URL 差し替え ──
  // lh3.googleusercontent.com の CDN URL は画像専用。
  // 動画・音声ブロックの <video>/<audio> src を認証付き Blob URL に差し替えて再生可能にする。
  useEffect(() => {
    const container = document.querySelector(".bn-editor");
    if (!container) return;

    const localBlobUrls: string[] = [];

    const processElement = (el: Element) => {
      const src = el.getAttribute("src");
      if (!src || src.startsWith("blob:")) return;
      const fileId = getActiveProvider().extractFileId(src);
      if (!fileId) return;

      getActiveProvider().getMediaBlobUrl(fileId).then((blobUrl) => {
        localBlobUrls.push(blobUrl);
        el.setAttribute("src", blobUrl);
        if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
          el.load();
        }
      }).catch(() => {});
    };

    // 既存の要素を処理
    container.querySelectorAll("video[src], audio[src]").forEach(processElement);

    // 新しく追加される要素を監視（D&D アップロード等）
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("video[src], audio[src]")) processElement(node);
          node.querySelectorAll("video[src], audio[src]").forEach(processElement);
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [fileId]);

  // タイトル変更時に自動保存トリガー
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // 改行は単一行扱い（textarea で複数行入力されても 1 行に正規化）
      setTitle(e.target.value.replace(/\r?\n/g, ""));
      markDirty();
    },
    [markDirty]
  );

  // タイトル欄の IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers: titleCompositionHandlers, isImeKey: isTitleImeKey } = useImeEnterGuard();

  // ── 版スナップショット（手動で残す全文版）──
  // 一覧はノート切替時に内部チャネル（readAppData）から読み直す。Wiki は対象外。
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  // 「版を残す」の結果フィードバック。ショートカット発火時は履歴パネルが閉じている
  // ことが多く、無言だと成功しても「効いていない」ように見えるため必ず出す。
  const [versionToast, setVersionToast] = useState<string | null>(null);
  const versionToastTimerRef = useRef<number | null>(null);
  const showVersionToast = useCallback((msg: string) => {
    setVersionToast(msg);
    if (versionToastTimerRef.current) window.clearTimeout(versionToastTimerRef.current);
    versionToastTimerRef.current = window.setTimeout(() => setVersionToast(null), 2600);
  }, []);

  useEffect(() => {
    if (!fileId || isWikiDoc) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    listSnapshots(getActiveProvider(), fileId)
      .then((list) => {
        if (!cancelled) setSnapshots(list);
      })
      .catch((e) => console.error("版一覧の取得に失敗:", e));
    return () => {
      cancelled = true;
    };
  }, [fileId, isWikiDoc]);

  // 「版を残す」: いまの編集を通常経路（handleSave）で確定してから、保存済み全文を
  // 版としてコピーする。buildDocument を直接呼ばないことで、recordRevision /
  // prevPageRef 更新の副作用を正規の保存経路にだけ起こさせる。
  const handleTakeSnapshot = useCallback(async () => {
    // ボタンは条件レンダで守られるが、⌘⇧S ショートカットからも直接呼ばれるため
    // wiki ノートのガードをここにも置く（loadFile が wiki id を解決できない）。
    // スキルは loadSkillFile で読み直して同じ版機構に乗せる（プロンプトの試行錯誤用）。
    if (!fileId || snapshotBusy || isWikiDoc) return;
    if (initialDoc?.source === "ai") return;
    const isSkill = initialDoc?.source === "skill";
    const provider = getActiveProvider();
    if (isSkill && !provider.loadSkillFile) return;
    setSnapshotBusy(true);
    try {
      await handleSave();
      const doc = isSkill
        ? await provider.loadSkillFile!(fileId)
        : await provider.loadFile(fileId);
      const res = await takeSnapshot(provider, fileId, doc);
      setSnapshots(await listSnapshots(provider, fileId));
      showVersionToast(
        res.status === "created"
          ? t("version.savedToast", { version: String(res.meta.version) })
          : t("version.unchangedToast"),
      );
    } catch (e) {
      console.error("版の作成に失敗:", e);
      showVersionToast(t("version.failedToast"));
    } finally {
      setSnapshotBusy(false);
    }
  }, [fileId, snapshotBusy, isWikiDoc, initialDoc, handleSave, showVersionToast, t]);

  // ⌘⇧S / ⌘⌥S: 版を残す。NoteEditorInner マウント中のみ購読（編集面があるときだけ効く）。
  // capture フェーズで購読する: エディタ（ProseMirror）内にフォーカスがあると、
  // バブリング段階の keydown はエディタ側で消費されて document まで届かないため、
  // ターゲットより先に受け取って preventDefault + stopPropagation で確定させる。
  // ⌘⌥S を併設する理由: ⌘⇧S は環境（ブラウザ本体機能や拡張のグローバルショートカット）
  // に予約されているとページの JS まで届かない実例があるため。Option+S は macOS で
  // 文字 "ß" を生成し e.key が化けるので、判定は物理キー e.code === "KeyS" を正とする。
  // ⌘⇧M と同様、デスクトップ WKWebView では Cmd 系が JS keydown に届かない場合が
  // あるが、その場合もヘッダーメニュー / 履歴パネルのボタンで代替できる。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isS = e.key.toLowerCase() === "s" || e.code === "KeyS";
      const modOk =
        (e.shiftKey && !e.altKey) || // ⌘⇧S / Ctrl+Shift+S
        (e.altKey && !e.shiftKey);   // ⌘⌥S / Ctrl+Alt+S
      if ((e.metaKey || e.ctrlKey) && isS && modOk) {
        e.preventDefault();
        e.stopPropagation();
        void handleTakeSnapshot();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [handleTakeSnapshot]);

  const handleDeleteSnapshot = useCallback(
    async (snapshotId: string) => {
      if (!fileId) return;
      if (!window.confirm(t("version.deleteConfirm"))) return;
      try {
        const provider = getActiveProvider();
        await deleteSnapshot(provider, fileId, snapshotId);
        setSnapshots(await listSnapshots(provider, fileId));
      } catch (e) {
        console.error("版の削除に失敗:", e);
      }
    },
    [fileId, t],
  );

  const handleRenameSnapshot = useCallback(
    async (snapshotId: string, label: string) => {
      if (!fileId) return;
      try {
        const provider = getActiveProvider();
        await renameSnapshot(provider, fileId, snapshotId, label);
        setSnapshots(await listSnapshots(provider, fileId));
      } catch (e) {
        console.error("版の名前変更に失敗:", e);
      }
    },
    [fileId],
  );

  // エディタ内容変更時にも再生成をトリガー + ラベル自動設定
  const handleContentChange = useCallback(() => {
    markDirty();
    labelAutoRef.current?.();
    triggerRegeneration();
    // 貼られたばかりの画像があれば、その場で文字を読み取る（進行はトーストで見せる）
    autoOcrRef.current?.();
    // 日時が入る列を持つテーブル: 標準操作（+ 帯・Tab・ペースト）で行が増えたら
    // 1 列目に日時を入れる
    applyLogTableTimestamps(
      editorRef.current,
      tableMetaStoreRef.current.blockIdsWithColumnType("datetime-auto")
    );
    // 空ノート予示を隠す（本文に 1 度でも変化があれば以降は非表示）
    setHasBeenEdited(true);
  }, [markDirty, triggerRegeneration]);

  // 貼られた画像の自動 OCR。ノートを開いた時点の既存画像は対象外で、
  // このノートを開いている間に新しく入った画像だけを読む。
  const autoOcr = useAutoImageOcr({ editorRef, noteKey: fileId ?? "new" });
  autoOcrRef.current = autoOcr.scan;

  // 初期コンテンツ
  const initialContent = useMemo(() => {
    const blocks = initialDoc?.pages?.[0]?.blocks;
    if (!blocks?.length) return undefined;
    return sanitizeBlocks(blocks);
  }, [initialDoc]);

  // 空ノート予示（EmptyNoteGuide）の表示可否
  // 初期ブロックが既に存在するノートでは最初から非表示。
  // 空ノートを開いた場合、最初の編集でトリガー済みにして以降隠す。
  const [hasBeenEdited, setHasBeenEdited] = useState(Boolean(initialContent));
  const isSkillDoc = initialDoc?.source === "skill";
  const showEmptyNoteGuide = !hasBeenEdited && !isWikiDoc && !isSkillDoc;

  // AI アシスタント起動 → Chat タブを開く
  const chatReqRef = useRef(aiAssistant.chatRequestSeq);
  useEffect(() => {
    if (aiAssistant.chatRequestSeq > chatReqRef.current) {
      chatReqRef.current = aiAssistant.chatRequestSeq;
      setRightTab("chat");
    }
  }, [aiAssistant.chatRequestSeq]);

  // Chat タブアクティブ時のスコープブロック ID リスト
  const chatScopeBlockIds = useMemo(() => {
    if (rightTab !== "chat" || aiAssistant.sourceBlockIds.length === 0 || !editorRef.current) {
      return [];
    }
    const blockId = aiAssistant.sourceBlockIds[0];
    const block = editorRef.current.getBlock(blockId);
    if (!block) return [blockId];
    // 見出し・step は「まとまり」なので配下ごとスコープにする
    if (block.type === "heading" || block.type === "step") {
      const scope = collectBlockScope(editorRef.current.document, block);
      return scope.map((b: any) => b.id);
    }
    return [blockId];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab, aiAssistant.sourceBlockIds, dirty]);

  // ── レンダリング ──
  return (
    <>
      <ProvIndicatorLayer
        hidden={!isDesktop && rightTab !== null}
      />
      <IndexTableIconLayer editorRef={editorRef} />
      <TableCaptionLayer editorRef={editorRef} onReimport={handleTableReimport} />
      <BlockHoverHighlight />
      <ScopeHighlight blockIds={chatScopeBlockIds} />
      {/* ブロックメニュー「メモ」からのブロック紐付きメモ入力 */}
      {blockMemoTarget && onCreateNoteMemo && (
        <CaptureDialog
          variant={isDesktop ? "centered" : "fullscreen"}
          contextLabel={blockMemoTarget.blockText || undefined}
          submitting={blockMemoSubmitting}
          onSubmit={async (text) => {
            setBlockMemoSubmitting(true);
            try {
              await onCreateNoteMemo(text, blockMemoTarget);
              setBlockMemoTarget(null);
            } finally {
              setBlockMemoSubmitting(false);
            }
          }}
          onClose={() => {
            if (!blockMemoSubmitting) setBlockMemoTarget(null);
          }}
        />
      )}
      {/* URL ペーストスタイル選択メニュー */}
      {pastedUrl && (
        <UrlPasteMenu
          url={pastedUrl.url}
          position={pastedUrl.position}
          onSelectBookmark={() => handleInsertBookmarkDirect(pastedUrl.url, pastedUrl.blockId)}
          onSelectLink={() => handleInsertLinkDirect(pastedUrl.url, pastedUrl.blockId)}
          onDismiss={() => setPastedUrl(null)}
        />
      )}
      {/* データ取り込みダイアログ（データ素材ピッカー・ドロップの共通の行き先） */}
      {dataImportFile && (
        <DataImportModal
          fileName={dataImportFile.fileName}
          text={dataImportFile.text}
          initialOptions={dataImportFile.initialOptions}
          onCancel={() => setDataImportFile(null)}
          onConfirm={(result) => handleDataImportConfirm(dataImportFile, result)}
        />
      )}
      {/* メディアピッカーモーダル */}
      {pickerMediaType && (
        <MediaPickerModal
          mediaIndex={mediaIndex ?? null}
          mediaType={pickerMediaType}
          onSelect={handlePickerSelect}
          onClose={() => setPickerMediaType(null)}
          onUpload={uploadFile}
          // データは「まず中身を見せる」ので、ここではアップロードしない
          onPickLocalFile={
            pickerMediaType === "data" ? handleDataImportFilePicked : undefined
          }
          allowDisplayMode
        />
      )}
      {/* チャートの「素材のデータから」: データ素材ピッカー → 取り込みダイアログ → 系列 */}
      {chartAssetRequest && (
        <ChartAssetSourceFlow
          mediaIndex={mediaIndex ?? null}
          uploadAsset={uploadAsset}
          onDone={(result) => {
            setChartAssetRequest(null);
            chartAssetRequest.onDone(result);
          }}
          onCancel={() => setChartAssetRequest(null)}
        />
      )}
      {/* メモピッカーモーダル（スラッシュメニュー /memo から） */}
      <MemoPickerModal
        open={memoPickerOpen}
        onClose={() => setMemoPickerOpen(false)}
        captureIndex={captureIndexProp ?? null}
        onSelect={(entry: CaptureEntry) => {
          // メモを 1 ブロックに集約して挿入する。
          // - 出典付き（Quote→Memo など）: quote ブロック 1 個。本文 inline + 「 — 出典」inline（italic+gray）
          // - 出典なし: paragraph 1 個
          // 段落区切りは inline では表現できないのでスペースに丸める（buildMemoInsertBlock 側で処理）
          // ピッカーを開いたエディタ（main / SidePeek）に挿入する。
          const editor = pickerEditorRef.current ?? editorRef.current;
          if (!editor) return;
          const block = buildMemoInsertBlock(entry);
          if (!block) return;
          const currentBlock = editor.getTextCursorPosition()?.block;
          if (currentBlock) {
            editor.insertBlocks([block], currentBlock, "after");
            // スラッシュだけの空ブロックを削除
            const content = currentBlock.content;
            if (Array.isArray(content) && content.length <= 1) {
              const text = content[0]?.text?.trim() ?? "";
              if (text === "" || text === "/memo") {
                removeBlockMetadata([currentBlock.id]);
                editor.removeBlocks([currentBlock]);
              }
            }
          }
          markDirty();
        }}
      />
      {/* URL ピッカーモーダル（スラッシュメニュー /bookmark から） */}
      {urlSlashPickerOpen && (
        <MediaPickerModal
          mediaIndex={mediaIndex ?? null}
          mediaType="url"
          onSelect={handleUrlSlashPickerSelect}
          onClose={() => setUrlSlashPickerOpen(false)}
          onAddUrlBookmark={onAddUrlBookmark}
          allowDisplayMode
        />
      )}
      {/* テンプレートピッカーモーダル（スラッシュメニュー /template から） */}
      {templatePickerOpen && (
        <TemplatePickerModal
          onSelect={handleTemplateSelect}
          onClose={() => setTemplatePickerOpen(false)}
        />
      )}
      {/* 引用ピッカーモーダル（スラッシュメニュー /claims, /Insights から） */}
      {citePickerKind && (
        <CitePickerModal
          noteIndex={noteIndex ?? null}
          kind={citePickerKind}
          onConfirm={handleCitePickerConfirm}
          onClose={() => setCitePickerKind(null)}
        />
      )}
      {sharedCitePickerOpen && (
        <SharedCitePickerModal
          onConfirm={(entries) => {
            const editor = pickerEditorRef.current ?? editorRef.current;
            insertSharedCitations(editor, entries);
          }}
          onClose={() => setSharedCitePickerOpen(false)}
        />
      )}
      {/* ヘッダー */}
      <div className="px-3 md:px-4 py-2.5 md:py-2 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">
        <div
          className="flex-1 min-w-0 text-sm font-medium text-muted-foreground truncate"
          title={title}
        >
          {title || t("editor.titlePlaceholder")}
        </div>
        {!isWikiDoc && aiAvailable && agentConfigured && (
          <KnowledgeStatusChip
            wikiEntries={wikiEntriesForCurrentNote}
            onAdd={onIngestToWiki}
            onOpen={(wikiNoteId) => onNavigateNote(wikiNoteId)}
            disabled={!fileId || saving}
          />
        )}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {saving ? t("common.saving") : dirty ? t("common.unsaved") : t("common.saved")}
        </span>
        {isShared && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 inline-flex items-center gap-1"
            title={t("share.badgeTooltip")}
          >
            <Share2 size={10} />
            {t("share.badge")}
          </span>
        )}
        <NoteHeaderMenu
          onSave={saveNow}
          onTakeSnapshot={
            fileId && !isWikiDoc && initialDoc?.source !== "ai" && initialDoc?.source !== "skill"
              ? handleTakeSnapshot
              : undefined
          }
          saveDisabled={saving}
          onExportPdf={handleExportPdf}
          pdfExporting={pdfExporting}
          onExportMarkdown={handleExportMarkdown}
          onExportProvJsonLd={handleExportProvJsonLd}
          provExportDisabled={!provDoc || provDoc["@graph"].length === 0}
          onIngestToWiki={onIngestToWiki}
          onIngestFromUrl={onIngestFromUrl}
          ingestDisabled={!fileId || saving}
          onDeriveWholeNote={onDeriveWholeNote && !isWikiDoc ? onDeriveWholeNote : undefined}
          deriveDisabled={!fileId || saving || derivingDisabled}
          isWikiDoc={isWikiDoc}
          inKnowledge={wikiEntriesForCurrentNote.length > 0}
          onOpenKnowledge={
            wikiEntriesForCurrentNote.length > 0
              ? () => onNavigateNote(`wiki:${wikiEntriesForCurrentNote[0].noteId}`)
              : undefined
          }
          archived={archived}
          onArchive={onArchiveNote}
          archiveDisabled={!fileId || saving}
          onRestore={onRestoreFromArchive}
          trashed={trashed}
          onRestoreFromTrash={onRestoreFromTrash}
          onDelete={onDeleteNote}
          deleteDisabled={!fileId || saving}
          onShare={!isWikiDoc ? handleShare : undefined}
          shareDisabled={!!shareDisabledReason || saving}
          shareDisabledReason={shareDisabledReason}
          isShared={isShared}
          shareBusy={shareBusy}
          onCopyLink={
            fileId && !isWikiDoc
              ? () => {
                  // このノートを開ける URL（#note/<id>）をコピー。外部に貼れば
                  // そのノートを開け、Graphium の別ノートに貼るとメンション化される。
                  const url = `${window.location.origin}${window.location.pathname}#note/${fileId}`;
                  void navigator.clipboard?.writeText(url);
                }
              : undefined
          }
          fullWidth={fullWidth}
          onToggleFullWidth={
            // read-only（アーカイブ/ゴミ箱）では保存できないため項目ごと隠す
            !archived && !trashed
              ? () => {
                  const next = !fullWidthRef.current;
                  fullWidthRef.current = next;
                  setFullWidth(next);
                  markDirty();
                }
              : undefined
          }
          t={t}
        />
      </div>

      {/* タイトルバー直下のサブヘッダー（WikiBanner / SkillBanner 用、D1 配置） */}
      {subHeaderSlot}

      {/* 通常ノートのアーカイブバナー。Wiki / Skill は専用バナー（subHeaderSlot）が
          アーカイブ表示を担うため除外する。エディタは archived のとき read-only
          （editable={!archived}）なので、ここでは状態の可視化と復元導線を提供する。 */}
      {archived && !isWikiDoc && !isSkillDoc && (
        <div style={{ padding: "0 16px", marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              maxWidth: 720,
              margin: "0 auto",
              padding: "6px 12px",
              borderRadius: "var(--r-1)",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              color: "var(--ink-2)",
              fontSize: 13,
            }}
          >
            <Archive size={14} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t("archive.archivedHint")}</span>
            {onRestoreFromArchive && (
              <button
                onClick={onRestoreFromArchive}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                  padding: "4px 10px",
                  borderRadius: "var(--r-1)",
                  border: "1px solid var(--rule)",
                  background: "var(--paper-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
                title={t("archive.restore")}
              >
                <ArchiveRestore size={13} />
                {t("archive.restore")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 通常ノートのゴミ箱バナー。ゴミ箱ノートはノートリンク経由で開けてしまうため、
          read-only（editable={!trashed}）にしたうえで「ゴミ箱にある」ことを明示し、
          復元導線を出す。archived と trashed は排他（両立しない）。 */}
      {trashed && !isWikiDoc && !isSkillDoc && (
        <div style={{ padding: "0 16px", marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              maxWidth: 720,
              margin: "0 auto",
              padding: "6px 12px",
              borderRadius: "var(--r-1)",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              color: "var(--ink-2)",
              fontSize: 13,
            }}
          >
            <Trash2 size={14} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t("trash.trashedHint")}</span>
            {onRestoreFromTrash && (
              <button
                onClick={onRestoreFromTrash}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                  padding: "4px 10px",
                  borderRadius: "var(--r-1)",
                  border: "1px solid var(--rule)",
                  background: "var(--paper-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
                title={t("trash.restoreFromTrash")}
              >
                <ArchiveRestore size={13} />
                {t("trash.restoreFromTrash")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex h-full w-full overflow-hidden">
        {/* 左: エディタ */}
        <div data-label-wrapper className="flex-1 min-w-0 overflow-auto relative">
          {/* 左右の枠: 旧ブロックラベル UI 用に 100px 取っていた名残を撤去し、
              SidePeek と同じ「基本 24px・右はラベルバッジがある時だけ 80px」に揃える。
              条件はブロックラベルのみ — リンクはバッジを描画しない
              （prov-indicator.tsx は label 無しを return null する）ので、リンクを
              条件に入れるとステップを繋いだ瞬間に本文幅が跳ねる。
              ドラッグハンドル分の余白は .bn-editor 自体の padding-inline 54px が持つ。 */}
          <div style={{ padding: "16px 0", paddingLeft: isDesktop ? 24 : 16, paddingRight: isDesktop ? (labelStore.labels.size > 0 ? 80 : 24) : 16, paddingBottom: isDesktop ? 16 : 72 }}>
          {/* 読みやすい行長のための中央カラム（Notion の本文幅と同じ考え方）。
              828px = 本文テキスト 720px + .bn-editor の padding-inline 54px×2。
              タイトル・文脈タグも px-[54px] で本文と左端が揃っているため一緒に包む。
              doc.fullWidth（ヘッダー ⋯ メニューのトグル）で解除できる。
              狭い画面では 828px に届かず従来どおり全幅になる。 */}
          <div style={fullWidth ? undefined : { maxWidth: 828, marginInline: "auto" }}>

            <textarea
              value={title}
              onChange={handleTitleChange}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }
              }}
              {...titleCompositionHandlers}
              onKeyDown={(e) => {
                // IME 変換確定の Enter を奪わない。isComposing / keyCode 229 だけの
                // ガードでは WKWebView（デスクトップ）の compositionend → keydown(13)
                // 順を取りこぼす。これを忘れると、変換確定の Enter で focus が editor
                // に移り、確定文字がエディタの 1 行目へ流れ込む（タイトル直下に
                // 同じ文字が現れる）バグになる。
                if (e.key === "Enter" && !isTitleImeKey(e)) {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              rows={1}
              placeholder={t("editor.titlePlaceholder")}
              aria-label={t("editor.titlePlaceholder")}
              className="block w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 text-3xl font-bold leading-tight mt-3 mb-5 px-[54px] resize-none overflow-hidden break-words"
            />
            {/* 文脈タグ行（タイトル直下・人間ノートのみ）。本文と同じ autosave 経路で保存する */}
            {!isWikiDoc && !isSkillDoc && fileId && (
              <div className="px-[54px] -mt-3 mb-5 flex flex-wrap items-center gap-1.5">
                {noteContexts.map((c) => (
                  <ContextBadge
                    key={c}
                    value={c}
                    onRemove={() => {
                      const next = removeNoteContext(noteContextsRef.current, c) ?? [];
                      noteContextsRef.current = next;
                      setNoteContexts(next);
                      markDirty();
                    }}
                    removeLabel={t("nav.removeContext")}
                  />
                ))}
                <button
                  type="button"
                  onClick={(e) => {
                    if (headerContextPickerPos) {
                      setHeaderContextPickerPos(null);
                      return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    setHeaderContextPickerPos({ top: r.bottom + 4, left: r.left });
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                  title={noteContexts.length > 0 ? t("nav.addContext") : t("nav.noteContextsTooltip")}
                >
                  ＋ {t("nav.noteContexts")}
                </button>
                {headerContextPickerPos && (
                  <ContextTagPicker
                    position={headerContextPickerPos}
                    onClose={() => setHeaderContextPickerPos(null)}
                    title={t("nav.noteContexts")}
                    selected={noteContexts}
                    suggestions={aggregateNoteContexts(noteIndex?.notes ?? [])}
                    placeholder={t("nav.contextPlaceholder")}
                    createLabel={(v) => t("nav.createContext", { value: v })}
                    clearLabel={t("nav.clearContexts")}
                    emptyText={t("nav.contextEmpty")}
                    onDeleteCandidate={onDeleteContextEverywhere}
                    onAdd={(v) => {
                      const next = addNoteContext(noteContextsRef.current, v) ?? [];
                      noteContextsRef.current = next;
                      setNoteContexts(next);
                      markDirty();
                    }}
                    onRemove={(v) => {
                      const next = removeNoteContext(noteContextsRef.current, v) ?? [];
                      noteContextsRef.current = next;
                      setNoteContexts(next);
                      markDirty();
                    }}
                    onClear={() => {
                      noteContextsRef.current = [];
                      setNoteContexts([]);
                      markDirty();
                    }}
                  />
                )}
              </div>
            )}
            {/* table / audio / file の配置揃えを CSS で適用（サイドストア駆動） */}
            <AlignmentStyleLayer />
            {/* 自動 OCR の進行トースト（右下ピル） */}
            <OcrToast state={autoOcr.toast} />
            {/* 印刷の準備が長引いたときだけ出るトースト（同じ右下ピル） */}
            <PrintToast visible={printPreparing} />
            <SandboxEditor
              key={fileId || "new"}
              editable={!archived && !trashed}
              blocks={customBlockEntries}
              initialContent={initialContent}
              sideMenu={NoteSideMenu}
              extraSlashMenuItems={[newNoteSlashItem, indexTableSlashItem, logTableSlashItem, templateSlashItem, ...mediaSlashItems, bookmarkSlashItem, calloutSlashItem, stepSlashItem, columnsSlashItem, mathSlashItem, inlineMathSlashItem, calcSlashItem, memoSlashItem, chartSlashItem, ...citeSlashItems, ...(isTauri() ? [sharedCitationSlashItem] : [])]}
              excludeDefaultSlashTitles={DEFAULT_MEDIA_SLASH_TITLES}
              formattingToolbar={NoteFormattingToolbar}
              onEditorReady={handleEditorReady}
              onChange={handleContentChange}
              uploadFile={uploadFile}
              resolveFileUrl={async (url: string) => {
                const p = getActiveProvider();
                const fid = p.extractFileId(url);
                if (fid) return p.getMediaBlobUrl(fid);
                return url;
              }}
              getMentionSuggestions={(query) => {
                mentionContextRef.current = { tableBlockId: null, rowIndex: -1 };
                const sel = window.getSelection();
                const focusEl = sel?.focusNode instanceof HTMLElement
                  ? sel.focusNode
                  : sel?.focusNode?.parentElement;
                if (focusEl) {
                  const cell = focusEl.closest("td");
                  const row = cell?.closest("tr");
                  const table = row?.closest("table");
                  if (row && table) {
                    const rowIndex = Array.from(table.querySelectorAll("tr")).indexOf(row);
                    const blockOuter = table.closest("[data-node-type='blockOuter']");
                    const tableBlockId = blockOuter?.getAttribute("data-id") ?? null;
                    if (tableBlockId && tableMetaStore.hasColumnType(tableBlockId, "note-link")) {
                      mentionContextRef.current = { tableBlockId, rowIndex };
                    }
                  }
                }
                const base = [
                  ...getHeadingSuggestions(),
                  ...getNoteSuggestions(files, fileId ?? undefined, noteIndex),
                  ...getAssetSuggestions(mediaIndex),
                ];
                // 入力中の文字が既存ノートに一致しないとき「新規ノートを作成」を末尾に追加。
                // テーブルセル内（インデックステーブル）では既存の行→ノート生成フローに
                // 委ねるため、新規作成候補は出さない。
                if (onCreateLinkedNote && !mentionContextRef.current.tableBlockId) {
                  const createItem = getCreateNoteSuggestion(query, base);
                  if (createItem) base.push(createItem);
                }
                return base;
              }}
              onMentionSelect={async (sourceBlockId, suggestion) => {
                // 「新規ノートを作成」候補: 名前の確定は必ず IME 安全な入力欄で行う。
                // メニューに打った文字（IME 変換前のローマ字などの可能性あり）は
                // 下書きとしてダイアログへ渡し、そこで確認・修正して確定する。
                // これでメニューが変換確定で閉じても入力が失われず、確実に作成できる。
                if (suggestion.type === "note" && suggestion.id === CREATE_NEW_NOTE_ID) {
                  if (!onCreateLinkedNote) return;
                  const draft = suggestion.createTitle ?? "";
                  const title = (await promptNoteName(draft))?.trim() ?? "";
                  if (!title) return; // キャンセル
                  const newId = await onCreateLinkedNote(title);
                  if (!newId) return;
                  suggestion = { type: "note", id: newId, label: title, group: "" };
                }
                if (suggestion.type === "heading") {
                  linkStore.addLink({
                    sourceBlockId,
                    targetBlockId: suggestion.id,
                    type: "reference",
                    createdBy: "human",
                  });
                  setTimeout(() => {
                    editorRef.current?.insertInlineContent([
                      { type: "text", text: `@${suggestion.label}`, styles: { textColor: "blue" } },
                      { type: "text", text: " ", styles: {} },
                    ]);
                  }, 100);
                  markDirty();
                } else if (suggestion.type === "note") {
                  linkStore.addLink({
                    sourceBlockId,
                    targetBlockId: "",
                    targetNoteId: suggestion.id,
                    type: "reference",
                    createdBy: "human",
                  });
                  const ctx = mentionContextRef.current;
                  if (ctx.tableBlockId && ctx.rowIndex > 0 && editorRef.current) {
                    const noteName = suggestion.label;
                    const tableBlockId = ctx.tableBlockId;
                    const rowIndex = ctx.rowIndex;
                    tableMetaStore.setNoteLink(tableBlockId, `@${noteName}`, suggestion.id);
                    setTimeout(() => {
                      const block = editorRef.current?.getBlock(tableBlockId);
                      if (block?.content?.rows?.[rowIndex]) {
                        const newRows = block.content.rows.map((r: any, i: number) => {
                          if (i !== rowIndex) return r;
                          return {
                            ...r,
                            cells: [
                              [{ type: "text", text: `@${noteName}`, styles: { textColor: "blue" } }],
                              ...r.cells.slice(1),
                            ],
                          };
                        });
                        editorRef.current.updateBlock(tableBlockId, {
                          content: { type: "tableContent", rows: newRows },
                        });
                      }
                    }, 100);
                    const exists = noteLinksRef.current.some(
                      (l) => l.targetNoteId === suggestion.id
                    );
                    if (!exists) {
                      noteLinksRef.current = [
                        ...noteLinksRef.current,
                        { targetNoteId: suggestion.id, sourceBlockId: tableBlockId, type: "derived_from" },
                      ];
                    }
                    markDirty();
                  } else {
                    const targetId = suggestion.id;
                    const targetLabel = suggestion.label;
                    setTimeout(() => {
                      // href に noteId を埋めた link として挿入（同名ノートでも正しく解決）
                      insertNoteMentionInline(editorRef.current, targetId, targetLabel);
                    }, 100);
                    const exists = noteLinksRef.current.some(
                      (l) => l.targetNoteId === suggestion.id
                    );
                    if (!exists) {
                      noteLinksRef.current = [
                        ...noteLinksRef.current,
                        { targetNoteId: suggestion.id, sourceBlockId, type: "derived_from" },
                      ];
                    }
                    markDirty();
                  }
                  mentionContextRef.current = { tableBlockId: null, rowIndex: -1 };
                } else if (suggestion.type === "asset") {
                  // ドキュメント素材（PDF/docx 本体）の引用。ノートではなく素材を指す。
                  // citedAssetFileIds に fileId を記録 → Cmd-K / チャットの AI が
                  // その素材の全文＋ハイライトメモを読めるようになる。
                  if (!citedAssetFileIdsRef.current.includes(suggestion.id)) {
                    citedAssetFileIdsRef.current = [...citedAssetFileIdsRef.current, suggestion.id];
                  }
                  const assetLabel = suggestion.label.replace(/^📄\s*/, "");
                  setTimeout(() => {
                    editorRef.current?.insertInlineContent([
                      { type: "text", text: `@${assetLabel}`, styles: { textColor: "blue" } },
                      { type: "text", text: " ", styles: {} },
                    ]);
                  }, 100);
                  markDirty();
                }
              }}
            />
            {/* @ メニュー「新しいノートを作成」の名前入力ダイアログ（IME 安全） */}
            {newNoteNameDialog}
            {/* Cmd+F: ドキュメント内検索バー（fixed 配置。mainEditor 未準備時は自前で null 描画） */}
            <DocumentSearchBar editor={mainEditor} />
            {/* 空ノート予示: ⌘K / # / @ / / の入口をさりげなく案内 */}
            <div className="px-[54px]">
              <EmptyNoteGuide
                visible={showEmptyNoteGuide}
                onOpenComposer={onOpenComposer}
                aiEnabled={!!aiAvailable && agentConfigured}
              />
            </div>
            {/* D2 配置: WikiContextDrawer（関連・文脈）を本文の下に展開する。
                identity（WikiBanner）は本文上、relational はここ（本文下）。 */}
            {contextDrawerSlot && (
              <div className="px-[54px]">{contextDrawerSlot}</div>
            )}
          </div>
          </div>
        </div>

        {/* 版を残した結果のトースト（成功 / 変更なし / 失敗）。ショートカット発火でも
            見えるよう画面右下に固定表示し、2.6 秒で自動消滅する。 */}
        {versionToast && (
          <div className="pointer-events-none fixed bottom-6 right-6 z-[300] flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-md">
            <Pin size={14} className="shrink-0 text-primary" aria-hidden />
            {versionToast}
          </div>
        )}
        {/* SidePeek（inline）— エディタの右、右パネルの左に差し込まれる。
            デスクトップのみ inline（モバイルは overlay にフォールバック）。 */}
        {sidePeekNoteId && isDesktop && (
          <SidePeek
            // ノートを切り替えたら SidePeek を丸ごと作り直す。key が無いと、別ノートに
            // 切り替えても内部の editor / docRef / オートセーブ状態が前のノートのまま残り、
            // 前ノートの本文を新ノートのファイルに保存してしまう（同名ノートを続けて
            // クリックすると「B の中身が A になる」データ破壊）。
            key={sidePeekNoteId}
            inline
            noteId={sidePeekNoteId}
            cachedDoc={getCachedDoc?.(sidePeekNoteId)}
            getCachedDoc={getCachedDoc}
            onSaved={handlePeekSaved}
            applyMentionRenameRef={peekMentionRenameRef}
            onClose={() => setSidePeekNoteId(null)}
            onNavigate={(noteId, savedDoc) => {
              setSidePeekNoteId(null);
              onNavigateNote(noteId, savedDoc);
            }}
            wikiEntries={knowledgeMap.get(sidePeekNoteId) ?? []}
            mediaIndex={mediaIndex ?? null}
            captureIndex={captureIndexProp ?? null}
            uploadFile={uploadFile}
            onAddUrlBookmark={onAddUrlBookmark}
            noteIndex={noteIndex ?? null}
            onCreateLinkedNote={onCreateLinkedNote}
            onOpenNoteInPeek={(peekId) => setSidePeekNoteId(peekId)}
            onOpenMaterialPeek={(entry) => setMaterialSidePeekEntry(entry)}
            onOpenMemoSource={onOpenMemoSource}
            archived={isArchived?.(sidePeekNoteId) ?? false}
            onRestoreFromArchive={
              isArchived?.(sidePeekNoteId) && onRestoreArchivedById
                ? () => onRestoreArchivedById(sidePeekNoteId)
                : undefined
            }
            trashed={isTrashed?.(sidePeekNoteId) ?? false}
            onRestoreFromTrash={
              isTrashed?.(sidePeekNoteId) && onRestoreTrashedById
                ? () => onRestoreTrashedById(sidePeekNoteId)
                : undefined
            }
          />
        )}
        {sidePeekNoteId && !isDesktop && (
          <SidePeek
            // ノート切替時に丸ごと作り直す（前ノートの本文が新ノートに保存される
            // データ破壊を防ぐ）。desktop 側と同じ理由。
            key={sidePeekNoteId}
            noteId={sidePeekNoteId}
            cachedDoc={getCachedDoc?.(sidePeekNoteId)}
            getCachedDoc={getCachedDoc}
            onSaved={handlePeekSaved}
            applyMentionRenameRef={peekMentionRenameRef}
            onClose={() => setSidePeekNoteId(null)}
            mediaIndex={mediaIndex ?? null}
            captureIndex={captureIndexProp ?? null}
            uploadFile={uploadFile}
            onAddUrlBookmark={onAddUrlBookmark}
            onNavigate={(noteId, savedDoc) => {
              setSidePeekNoteId(null);
              onNavigateNote(noteId, savedDoc);
            }}
            wikiEntries={knowledgeMap.get(sidePeekNoteId) ?? []}
            noteIndex={noteIndex ?? null}
            onCreateLinkedNote={onCreateLinkedNote}
            onOpenNoteInPeek={(peekId) => setSidePeekNoteId(peekId)}
            onOpenMaterialPeek={(entry) => setMaterialSidePeekEntry(entry)}
            onOpenMemoSource={onOpenMemoSource}
            archived={isArchived?.(sidePeekNoteId) ?? false}
            onRestoreFromArchive={
              isArchived?.(sidePeekNoteId) && onRestoreArchivedById
                ? () => onRestoreArchivedById(sidePeekNoteId)
                : undefined
            }
            trashed={isTrashed?.(sidePeekNoteId) ?? false}
            onRestoreFromTrash={
              isTrashed?.(sidePeekNoteId) && onRestoreTrashedById
                ? () => onRestoreTrashedById(sidePeekNoteId)
                : undefined
            }
          />
        )}
        {/* @ で引用したドキュメント素材（PDF/docx）のサイドピーク。ノート SidePeek と同じ
            レイアウト方針（desktop は inline flex item / mobile は overlay）で表示する。 */}
        {materialSidePeekEntry && isDesktop && (
          <MaterialSidePeek
            inline
            entry={materialSidePeekEntry}
            onClose={() => setMaterialSidePeekEntry(null)}
            mediaIndex={mediaIndex ?? null}
            onRegisterAsset={materialPeekUrlUnregistered ? handleRegisterUrlFromPeek : undefined}
            onToggleFull={
              // 登録済み素材のみ Full view へ昇格できる（アドホック URL entry は gallery に実体が無い）
              onOpenMedia && mediaIndex?.media.some((m) => m.fileId === materialSidePeekEntry.fileId)
                ? () => {
                    const fid = materialSidePeekEntry.fileId;
                    setMaterialSidePeekEntry(null);
                    onOpenMedia(fid);
                  }
                : undefined
            }
            onNavigateNote={(noteId) => {
              setMaterialSidePeekEntry(null);
              onNavigateNote(noteId);
            }}
          />
        )}
        {materialSidePeekEntry && !isDesktop && (
          <MaterialSidePeek
            entry={materialSidePeekEntry}
            onClose={() => setMaterialSidePeekEntry(null)}
            mediaIndex={mediaIndex ?? null}
            onRegisterAsset={materialPeekUrlUnregistered ? handleRegisterUrlFromPeek : undefined}
            onToggleFull={
              onOpenMedia && mediaIndex?.media.some((m) => m.fileId === materialSidePeekEntry.fileId)
                ? () => {
                    const fid = materialSidePeekEntry.fileId;
                    setMaterialSidePeekEntry(null);
                    onOpenMedia(fid);
                  }
                : undefined
            }
            onNavigateNote={(noteId) => {
              setMaterialSidePeekEntry(null);
              onNavigateNote(noteId);
            }}
          />
        )}

        {/* 右: アイコンレール + オンデマンド展開パネル
            relative + z-10: SidePeek の inline スライドインがこの下を通る */}
        {rightTab && (
          <div className={cn(
            "shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden relative z-10",
            isDesktop ? "w-[480px]" : "fixed inset-0 z-[200] border-l-0"
          )}>
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              {/* モバイル: 閉じるボタン */}
              {!isDesktop && (
                <button
                  onClick={() => toggleRightTab(rightTab)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/50 transition-colors mr-1"
                  aria-label={t("common.close")}
                >
                  ✕
                </button>
              )}
              <span className="text-xs font-bold tracking-wide text-foreground">
                {rightTab === "graph" ? t("panel.graph")
                  : rightTab === "prov" ? t("panel.prov")
                  : rightTab === "chat" ? t("panel.chat")
                  : rightTab === "history" ? t("panel.history")
                  : rightTab === "memos" ? t("panel.memos")
                  : t("panel.source")}
              </span>
              {rightTab === "history" && fileId && initialDoc?.source !== "ai" && (
                <button
                  onClick={handleTakeSnapshot}
                  disabled={snapshotBusy}
                  title={t("version.take")}
                  className="px-2.5 py-0.5 text-xs font-semibold rounded border border-primary bg-primary/5 text-primary cursor-pointer hover:bg-primary/10 transition-colors ml-auto disabled:opacity-50"
                >
                  {t("version.take")}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {rightTab === "graph" && (
                <GraphLinksPanel
                  data={noteGraphData}
                  lineageTree={lineageTree}
                  onNavigate={onNavigateNote}
                  onPeek={(noteId) => setSidePeekNoteId(noteId)}
                  onOpenMedia={(fileId) => {
                    // グラフの素材ノード（pdf/document/image 等）もノートを離れず素材サイドピークで
                    // 開く。URL ノードや本文内 @素材と挙動を揃える（Full 表示はピーク内の Maximize から）。
                    const entry = mediaIndex?.media.find((m) => m.fileId === fileId);
                    if (entry) setMaterialSidePeekEntry(entry);
                    else onOpenMedia?.(fileId);
                  }}
                  onOpenUrl={(url) => setMaterialSidePeekEntry(buildUrlPeekEntry(url, mediaIndex ?? null))}
                  onOpenMemo={onOpenMemoSource}
                />
              )}
              {rightTab === "prov" && provLabelsEnabled && (
                <ProvGraphPanel doc={provDoc} editorRef={editorRef} />
              )}
              {rightTab === "chat" && (
                <AiAssistantPanel
                  onSubmit={handleAiChatSubmit}
                  onStop={handleAiChatStop}
                  onForkChat={handleAiChatFork}
                  onInsertToScope={handleInsertToScope}
                  onReplaceBlocks={handleReplaceBlocks}
                  onDeriveNote={handleAiDeriveFromChat}
                  onIngestChat={onIngestChat}
                  onGenerateKnowledgeCandidates={onCreateKnowledgeNote ? handleGenerateKnowledgeCandidates : undefined}
                  onAdoptKnowledgeCandidates={onCreateKnowledgeNote ? handleAdoptKnowledgeCandidates : undefined}
                  noteIndex={noteIndex}
                  onOpenWiki={(wikiId) => setSidePeekNoteId(`wiki:${wikiId}`)}
                  onOpenNote={(noteId) => setSidePeekNoteId(noteId)}
                  onOpenAsset={(assetFileId) => {
                    // 横断検索で注入した素材の断片を引用したとき。ノートを離れず素材サイドピークで開く
                    const entry = mediaIndex?.media.find((m) => m.fileId === assetFileId);
                    if (entry) setMaterialSidePeekEntry(entry);
                    else onOpenMedia?.(assetFileId);
                  }}
                />
              )}
              {rightTab === "history" && (
                <DocumentProvenancePanel
                  provenance={currentProvenance}
                  snapshots={snapshots}
                  selectedSnapshotId={
                    sidePeekNoteId?.startsWith("snapshot:")
                      ? sidePeekNoteId.replace(/^snapshot:/, "")
                      : null
                  }
                  onOpenSnapshot={(snapshotId) => {
                    // モバイルではこのパネル（z-200）が SidePeek（z-100）を覆い隠すため、
                    // パネルを閉じてから開く（onOpenSource と同じ流儀）。
                    if (!isDesktop) setRightTab(null);
                    setSidePeekNoteId(`snapshot:${snapshotId}`);
                  }}
                  onDeriveSnapshot={onDeriveSnapshot}
                  onRestoreSnapshot={onRestoreSnapshot}
                  onRenameSnapshot={handleRenameSnapshot}
                  onDeleteSnapshot={handleDeleteSnapshot}
                  onHighlightBlocks={setHighlightBlockIds}
                  resolveSource={resolveRevisionSource}
                  onOpenSource={(openId) => {
                    // モバイルではこのパネルが全画面（z-200）で SidePeek（z-100）を
                    // 覆い隠すため、パネルを閉じてから開く。デスクトップは共存できる。
                    if (!isDesktop) setRightTab(null);
                    setSidePeekNoteId(openId);
                  }}
                />
              )}
              {rightTab === "source" && sourceDoc && (
                <SourceDocPanel doc={sourceDoc} />
              )}
              {rightTab === "memos" && fileId && (
                <NoteMemosSection
                  noteFileId={fileId}
                  noteTitle={initialDoc?.title}
                  captureIndex={captureIndexProp ?? null}
                  onCreateMemo={onCreateNoteMemo}
                  onDeleteMemo={onDeleteNoteMemo}
                  // メモ選択 → 該当ブロックを履歴差分と同じ機構でハイライト
                  onHighlightBlock={(blockId) =>
                    setHighlightBlockIds(blockId ? [blockId] : [])
                  }
                  // ¶ チップは現在のエディタ内容でライブ解決（削除済みなら null →
                  // 作成時スナップショットにフォールバック）
                  resolveBlockLabel={(blockId) => {
                    const block = editorRef.current?.getBlock(blockId);
                    return block ? resolveMemoBlockLabel(block) || null : null;
                  }}
                />
              )}
            </div>
          </div>
        )}
        {/* アイコンレール — デスクトップ: 右端縦レール / モバイル: ボトムバー
            relative + z-10: SidePeek の inline スライドインがこの下を通る */}
        <div className={cn(
          "shrink-0 border-border bg-muted/50 flex items-center gap-1 relative z-10",
          isDesktop
            ? "w-10 border-l flex-col py-2"
            : "fixed bottom-0 left-0 right-0 z-[100] h-14 border-t justify-center px-2 bg-background/95 backdrop-blur-sm"
        )}>
          {([
            // バックエンド到達（aiAvailable）時はモデル登録済み（agentConfigured）の
            // ときだけ表示する。未到達（aiAvailable===false）でも Tauri ではタブを残す:
            // sidecar が起動できなかった場合の診断 UI (AiBackendDiagnostic) を
            // 見せられるようにするため。Web 版では従来通り非表示。
            { tab: "chat" as const, icon: <Bot size={18} />, label: t("panel.chat"), show: aiAvailable ? agentConfigured : isTauri() },
            { tab: "graph" as const, icon: <Network size={18} />, label: t("panel.graph"), show: noteGraphData.nodes.length > 1 || (lineageTree?.parents.length ?? 0) > 0 },
            // 旧: labels.size でゲートしていたが、v6 以降の工程は step ブロックで
            // block ラベルを持たないため、グラフに中身がある限り出す（auto-open と同じシグナル）
            // 手順ゼロでもタブは出す — フロービューの「+ 手順を追加」が
            // グラフ側から手順を作り始める入口になる（空状態はビュー側が案内する）
            { tab: "prov" as const, icon: <GitBranch size={18} />, label: t("panel.prov"), show: provLabelsEnabled },
            { tab: "history" as const, icon: <History size={18} />, label: t("panel.history"), show: true },
            // Memos: ノートが開いている時は常に表示。空でも「ここに書ける」ことを発見してもらうため。
            { tab: "memos" as const, icon: <StickyNote size={18} />, label: t("panel.memos"), show: !!fileId },
            ...(sourceDoc ? [{ tab: "source" as const, icon: <FileText size={18} />, label: t("panel.source"), show: true }] : []),
          ] as const).filter((item) => item.show).map((item) => (
            <button
              key={item.tab}
              onClick={() => toggleRightTab(item.tab)}
              title={item.label}
              className={cn(
                "flex items-center justify-center rounded-md transition-colors",
                isDesktop ? "w-8 h-8" : "w-11 h-11",
                rightTab === item.tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// サイドピーク用エラーバウンダリ（一覧ビューでの SidePeek クラッシュでアプリ全体が落ちるのを防ぐ）
class ListSidePeekBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SidePeek error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "55%",
          minWidth: "min(400px, 90vw)", maxWidth: 800, background: "var(--color-card)",
          borderLeft: "1px solid var(--color-border-subtle)",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.08)", zIndex: 100,
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 12, padding: 24,
        }}>
          <p style={{ color: "var(--color-destructive)", fontSize: 13 }}>
            {this.state.error.message}
          </p>
          <button
            onClick={this.props.onClose}
            style={{
              padding: "6px 16px", borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)", cursor: "pointer",
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── メインアプリ ──
export function NoteApp() {
  const { authenticated, loading: authLoading } = useStorage();
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [agentConfigured, setAgentConfigured] = useState(() => isAgentConfigured());
  const [experimentalFlags, setExperimentalFlags] = useState<ExperimentalSettings>(() => loadSettings().experimental);
  // 来歴ラベル機能は常時有効。付与 UI が step の中に構造的に畳まれた
  // （ステップを使う人にだけ現れる）ため、設定トグルでの段階的開示は撤去した。
  const provLabelsEnabled = true;
  // inline ハイライト装飾（BlockNote style の直書き色）を CSS で消すため body 属性を同期する。
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (provLabelsEnabled) {
      document.body.removeAttribute("data-prov-labels-off");
    } else {
      document.body.setAttribute("data-prov-labels-off", "true");
    }
  }, [provLabelsEnabled]);
  // AI バックエンド接続チェック（GitHub Pages 等の静的サイトでは false）
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  // バックエンド到達性（aiAvailable）と「モデルが 1 件以上登録されているか」
  // （agentConfigured）を同時に判定する。後者はサイドバーの緑/橙バッジと、各 AI
  // アクションのガード（isAgentConfigured）が読む。desktop はサーバーの models.json、
  // web は localStorage が実体なので数え方を分ける。
  const checkAiReadiness = useCallback(async () => {
    const { fetchModels } = await import("./features/ai-assistant/api");
    const applyReachable = (serverModelCount: number) => {
      // desktop はサーバーの models.json が唯一のレジストリ。web はサーバー側
      // models.json（ヘッダー無しリクエストのフォールバック先 = header-model.ts の
      // getDefaultModel）と localStorage（X-LLM-API-Key として送信）のどちらかに
      // モデルがあれば実際に AI は使えるので、両方を数える。localStorage だけを
      // 見ると、サーバー側にモデル登録済みの dev / セルフホスト構成でガードが
      // 誤発火して動くはずの機能を塞いでしまう。
      const hasModels = isTauri()
        ? serverModelCount > 0
        : serverModelCount > 0 || getLLMModels().length > 0;
      setAiAvailable(true);
      setAgentConfigured(hasModels);
      setAiModelsAvailable(hasModels);
    };
    try {
      const res = await fetchModels();
      applyReachable(res.models.length);
    } catch {
      // sidecar 復旧を試みる（Tauri 環境のみ）
      try {
        const recovered = await ensureSidecar();
        if (recovered) {
          const res = await fetchModels();
          applyReachable(res.models.length);
          return;
        }
      } catch { /* sidecar 復旧も失敗 */ }
      // バックエンド無し（GitHub Pages 等）= AI UI 自体を隠す。
      setAiAvailable(false);
    }
  }, []);
  useEffect(() => { void checkAiReadiness(); }, [checkAiReadiness]);
  // AI UI の表示可否。到達性（aiAvailable）に加えて「モデルが 1 件以上登録済み」
  // （agentConfigured）まで要求する。モデル未登録のユーザーには AI 関連 UI
  // （ナレッジ生成・チャット・Composer・素材の AI アクション等）を出さない。
  // チェック中（aiAvailable === null）は false に倒し、未登録ユーザーに一瞬
  // AI UI が見えるちらつきを防ぐ。設定でモデルを追加/削除するとモーダル閉時の
  // checkAiReadiness 再実行で反映される。
  const aiUiEnabled = (aiAvailable ?? false) && agentConfigured;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // `graphium-open-settings` で開いたときに最初に表示するタブ。AI 未設定バナーの
  // 「Set up AI」からは "ai" を渡して AI Setup タブへ直接誘導する。
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  // MissingApiKeyBanner などから `graphium-open-settings` イベントで Settings を
  // 開けるようにする。直接 setShowSettings を渡し回らずに済む間接化（UpdateBanner
  // の "graphium-update-available" と同じパターン）。detail.tab があればそのタブを開く。
  useEffect(() => {
    const handler = (e: Event) => {
      setSettingsInitialTab((e as CustomEvent<{ tab?: string }>).detail?.tab);
      setShowSettings(true);
      setSidebarOpen(false);
    };
    window.addEventListener("graphium-open-settings", handler);
    return () => window.removeEventListener("graphium-open-settings", handler);
  }, []);
  // デスクトップ用: 集中モード（左サイドバーを折り畳む）。設定は localStorage に永続化。
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("graphium-sidebar-collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("graphium-sidebar-collapsed", desktopSidebarCollapsed ? "1" : "0"); } catch {}
  }, [desktopSidebarCollapsed]);
  const [showMemos, setShowMemos] = useState(false);
  // モバイル受信箱ビュー（同期フォルダ <root>/Inbox/ の「まだ取り込んでいない」ファイル一覧）。
  // 取り込むと素材ライブラリへ振り分けられ、この一覧からは消える（_imported/ 退避）。
  const [showMobile, setShowMobile] = useState(false);
  // Inbox 同期フォルダのルート（localStorage 由来）。null なら未接続。
  // これを源に FolderInbox を作るので、フォルダ変更で受信箱の読み取り面ごと差し替わる。
  //
  // 入口は 2 つ — 設定 › ストレージ（正典）と、この受信箱ビューのフォルダ設定メニュー
  // （その場の近道）。useInboxConfig が setter の CustomEvent を購読するので、
  // どちらで変えても両方がリロード無しで追従する（自前 state は持たない）。
  // keep-archive も同じ源。取り込み実行時は localStorage を直接読むので、
  // 表示が古くても実挙動には影響しない（handleImportFromInbox 参照）。
  const { root: inboxRoot, keepArchive: inboxKeepArchive } = useInboxConfig();
  const handleInboxKeepArchiveChange = useCallback((keep: boolean) => {
    setInboxKeepArchive(keep);
  }, []);
  // サイドバー「モバイル」の未処理件数バッジ。取り込み済み素材の数ではなく、
  // 受信箱に残っている未取り込みファイルの数（= これから捌く数）。
  const [inboxPendingCount, setInboxPendingCount] = useState(0);
  // 受信箱の読み取り面。desktop(Tauri) かつ受信フォルダ接続済みのときだけ実体を持つ
  //（web には列挙する手段が無く、未接続では起動時のフォルダスキャンも走らせない）。
  const inboxSource = useMemo(
    () => (isTauri() && inboxRoot ? new FolderInbox(inboxRoot) : null),
    [inboxRoot],
  );
  // 起動時（および接続フォルダ変更時）に未処理件数を数える。
  // 「受信箱ビューを開いたとき」「取り込み後」は InboxView の scan → onPendingCount が
  // 更新するので、ここでは重ねて数えない（IPC の二重呼びを避ける）。
  // 失敗は 0 扱いで握りつぶす（起動を妨げない）。
  useEffect(() => {
    if (!inboxSource) {
      setInboxPendingCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pending = await inboxSource.listPending();
        if (!cancelled) setInboxPendingCount(pending.length);
      } catch {
        if (!cancelled) setInboxPendingCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [inboxSource]);
  const [showTrash, setShowTrash] = useState(false);
  const [showSharedLibrary, setShowSharedLibrary] = useState(false);
  // 引用カードの「開く」から Library の特定エントリへ飛ぶための一時 state。
  // SharedLibraryView が consume したら onFocusConsumed で null に戻す。
  const [sharedLibraryFocusId, setSharedLibraryFocusId] = useState<string | null>(null);
  // 全ノードグラフ（全画面オーバーレイ）。開いている間だけ index からグラフを構築する。
  // データ構築は fm 宣言後に行う（globalGraphData）。
  const [showGlobalGraph, setShowGlobalGraph] = useState(false);
  // ノートのグラフから素材ノードをクリックされたときに AssetGalleryView へ
  // 「この fileId を Full view で開いて」と渡すための一時 state。
  // AssetGalleryView 側が consume したら onFocusConsumed で null に戻す。
  const [focusedMaterial, setFocusedMaterial] = useState<{ fileId: string; fullMode: boolean } | null>(null);

  // アセット閲覧画面の右に並べて開くノート（翻訳ノート等）。PDF を読みながら横で照合する用途。
  // PDF を Full view にしたうえで、その右に既存のノート SidePeek を inline で差し込む。
  const [assetSidePeekNoteId, setAssetSidePeekNoteId] = useState<string | null>(null);

  // Cmd+K Composer（統一された AI 呼び出し口 / UX Audit #04）
  // Ask のみ UI 公開。他モードの実装は NoteEditorInner 内のハンドラに保持（将来用）。
  // useComposer の組み込みショートカットは無効化して、開く条件はここで制御する。
  const composer = useComposer({ disableShortcut: true });
  const [composerPrompt, setComposerPrompt] = useState("");
  // 開いた時点でノートの編集面が出ていたか（＝AI 質問まで使えるか）。
  // ノート以外の画面では検索専用として開くので、AI 導線を出し分けるために持つ。
  const [composerCanAskAi, setComposerCanAskAi] = useState(true);
  // 発見カード — Composer が開かれたときに直近 7 日の wikiLog を取得して計算
  const [recentWikiLogEntries, setRecentWikiLogEntries] = useState<WikiLogEntry[]>([]);
  // Composer を開いたときの引用（knowledge link）数。J1.5 の verb メニュー出し分けに使う。
  const [composerCitationCount, setComposerCitationCount] = useState(0);
  const composerSubmitRef = useRef<
    ((submission: ComposerSubmission) => void | Promise<void>) | null
  >(null);
  // WikiBanner から SidePeek を開くための ref。NoteEditorInner が useEffect で
  // setSidePeekNoteId を登録する（composerSubmitRef と同じ流儀）。
  // 登録前 / ノート未開時は null。WikiBanner 側は null フォールバックで通常遷移する。
  const openSidePeekRef = useRef<((noteId: string) => void) | null>(null);
  // エディタ内の素材サイドピークを NoteApp 側から開く命令口（openSidePeekRef と同じ流儀）。
  // memo: ソースのその場プレビューで使う。エディタ非表示時は null。
  const openMaterialPeekRef = useRef<((entry: MediaIndexEntry) => void) | null>(null);
  // 現ノートの引用数を取得する関数を NoteEditorInner が登録する（同じ流儀）。
  const composerCitationRef = useRef<(() => number) | null>(null);
  // 実行中チャット run（chat-run-manager）の完了をライブ store に反映するための ref。
  // NoteEditorInner が useEffect でハンドルを登録する（composerSubmitRef と同じ流儀）。
  const chatRunApplyRef = useRef<ChatRunApplyHandle | null>(null);
  // 世界モデル照合（Phase 2 / PR 2A）— 照合中の Wiki ID を覚えてバナーボタンを disable する
  const [worldCheckingWikiId, setWorldCheckingWikiId] = useState<string | null>(null);
  const handleComposerSubmit = useCallback(
    async (submission: ComposerSubmission) => {
      const handler = composerSubmitRef.current;
      setComposerPrompt("");
      composer.closeComposer();
      if (!handler) {
        console.info("[Composer] no active note — submit ignored:", submission);
        return;
      }
      try {
        await handler(submission);
      } catch (err) {
        console.error("[Composer] submit handler threw:", err);
      }
    },
    [composer],
  );
  // カード選択ハンドラは enqueueIngest 定義後に置くため後方で宣言する。
  // ここでは ref 経由で参照だけ確保しておく。
  // 一覧ビュー用サイドピーク（NoteEditorInner 外でも使えるグローバルな state）
  const [listSidePeekNoteId, setListSidePeekNoteId] = useState<string | null>(null);
  // 一覧・全体グラフ用の素材サイドピーク。ノートピークと同時に開くと右端で重なるため
  // 片方を開くとき他方を閉じる（切替式）。
  const [listMaterialPeekEntry, setListMaterialPeekEntry] = useState<MediaIndexEntry | null>(null);
  const [ingestToast, setIngestToast] = useState<IngestToastState>(null);
  const ingestQueueRef = useRef<{ noteId: string; noteTitle: string; doc: import("./lib/document-types").GraphiumDocument }[]>([]);
  const ingestRunningRef = useRef(false);
  // 取り込みパイプライン（ingest → cross-update → atomize → lint）の中断ハンドル。
  // キュー処理の開始時に 1 本作り、各 LLM 呼び出しの fetch に signal として渡す。
  // トーストの「停止」で abort() + キューを空にする。fetch が切れるとサーバー側の
  // c.req.raw.signal も発火して LLM 呼び出しごと止まる（wiki.ts が配線済み）。
  const ingestAbortRef = useRef<AbortController | null>(null);
  // AI 未設定ガード（ensureAgentConfigured）発火時のトースト表示。
  // 設定モーダル自体は既存の `graphium-open-settings` リスナーが AI タブで開く。
  // 固定 id で置き換えるので、連続発火（複数ノート一括 Knowledge 化等）でも 1 件に収まる。
  useEffect(() => {
    const handler = () => {
      const id = "ai-guard";
      setIngestToast((prev) => ({
        items: [
          ...(prev?.items ?? []).filter((i) => i.id !== id),
          {
            id,
            status: "error" as const,
            noteTitle: tStatic("sidebar.aiNotConfigured"),
            result: tStatic("settings.aiNotConfigured"),
          },
        ],
      }));
    };
    window.addEventListener(AI_NOT_CONFIGURED_EVENT, handler);
    return () => window.removeEventListener(AI_NOT_CONFIGURED_EVENT, handler);
  }, []);
  // Wiki Log 表示状態
  const [activeWikiView, setActiveWikiView] = useState<"log" | "lint" | null>(null);
  // Skill 表示状態
  const [showSkillList, setShowSkillList] = useState(false);
  const [showNewSkillDialog, setShowNewSkillDialog] = useState(false);
  // 編集ダイアログを開いている Skill の id（null なら閉じている）
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [lintReport, setLintReport] = useState<import("./server/services/wiki-linter").LintReport | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  // メモ挿入リクエスト（メモギャラリー → エディタ）
  const [pendingMemoInsert, setPendingMemoInsert] = useState<{ captureId: string; text: string; deleteAfter: boolean } | null>(null);
  // 引用は capture.handleCreateCapture でメモ化する単純フローに変更したため、
  // 旧 pendingCitationInsert / pendingChatQuote state は撤去（git 履歴参照）。
  // Quick Memo ダイアログ（サイドバー / ⌘+⇧+M で開く、画面非依存の入口）
  const [showQuickMemoDialog, setShowQuickMemoDialog] = useState(false);

  const isDesktop = useIsDesktop();
  // Cmd+\ / Ctrl+\ で集中モード切替（デスクトップのみ）
  // JIS キーボードでは ¥ キーが物理的に \ と同じ位置なので、e.code で両対応する。
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.code === "Backslash" || e.code === "IntlYen") {
        e.preventDefault();
        setDesktopSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop]);
  const fm = useFileManager(authenticated);

  // 語彙インデックス（BM25）をノート / Wiki / 素材に追従させる。
  // Cmd-K の本文・素材検索と、AI チャットの横断検索（埋め込みと RRF で併用）の共通コア。
  // 索引は端末ローカルの再構築可能なキャッシュで、ノートデータには何も書かない。
  useLexicalIndexSync({
    authenticated,
    noteIndex: fm.noteIndex ?? null,
    mediaIndex: fm.mediaIndex ?? null,
    getCachedDoc: fm.getCachedDoc,
    loadDoc: fm.loadDoc,
  });

  // 一覧・全体グラフの素材ピーク（未登録 URL の transient エントリ）からの「素材に登録」。
  // エディタが開いていないため保存予約（syncUsedIn）は無し — usedIn は該当ノートの
  // 次回保存時に埋まる。登録完了時にピークが開いたままなら実エントリへ差し替える。
  const handleRegisterUrlFromListPeek = useCallback((peekEntry: MediaIndexEntry) => {
    const url = peekEntry.url;
    if (peekEntry.type !== "url" || !url) return;
    registerUrlAsset(url, [], (newEntry) => {
      fm.handleAddUrlBookmark(newEntry);
      setListMaterialPeekEntry((cur) => (cur && cur.fileId === peekEntry.fileId ? newEntry : cur));
    });
  }, [fm.handleAddUrlBookmark]);
  // 未登録 URL の transient ピークか（登録ボタンの表示判定。URL 一致で判定）
  const listPeekUrlUnregistered =
    listMaterialPeekEntry?.type === "url" &&
    !!listMaterialPeekEntry.url &&
    !fm.mediaIndex?.media.some(
      (m) => m.type === "url" && m.url === listMaterialPeekEntry.url,
    );
  const capture = useCapture(authenticated);
  // 一覧 / アセットピークの保存後フック: キャッシュ / インデックス更新に加え、
  // タイトルが変わっていたら @メンションのラベルを参照元ノートへ伝播する。
  // これらのビューではメインエディタは非マウントなので、直前まで開いていたノート
  // （activeFileId）もファイル書き換えで安全に追従できる（skip 指定なし。
  // fm 側が activeDoc も更新するため、エディタ復帰時も旧ラベルに巻き戻らない）。
  const handleListPeekSaved = useCallback(
    (id: string, savedDoc: GraphiumDocument) => {
      // skill はインデックス非掲載で @メンション候補に出ない = 参照が存在しないため
      // 伝播不要。wiki はリンクレコード上 raw id で参照されるのでプレフィックスを剥がす。
      const isSkill = id.startsWith("skill:");
      const rawId = id.replace(/^(wiki|skill):/, "");
      // 旧タイトルは reindex 前のキャッシュ / インデックスから取る
      const prevTitle = isSkill
        ? undefined
        : fm.getCachedDoc?.(id)?.title ??
          fm.noteIndex?.notes.find((n) => n.noteId === rawId)?.title;
      fm.reindexNoteFromDoc(id, savedDoc);
      if (isSkill || !prevTitle || prevTitle === savedDoc.title) return;
      void fm.propagateMentionRename(id, prevTitle, savedDoc.title);
    },
    [fm.getCachedDoc, fm.noteIndex, fm.reindexNoteFromDoc, fm.propagateMentionRename],
  );
  // ── チャット run 完了のディスパッチ（アプリレベル常駐） ──
  // ノート切替に耐えるチャット実行（chat-run-manager）の完了を受け、元ノートが
  // 開かれていればライブ store へ、閉じられていればファイルの doc.chats へ書き戻す。
  // ingest（ingestQueueRef）と同じく NoteApp 常駐なので、NoteEditor の remount に
  // 影響されない。
  const fmGetCachedDocStable = fm.getCachedDoc;
  const fmReindexNoteFromDocStable = fm.reindexNoteFromDoc;
  // 同一ノート宛の書き戻しを直列化するチェーン。並行 settle した 2 つの run が
  // 同じ doc を読み合うと、後着の save が先行の chat を含まない chats で上書きする
  // （load→save の交錯）ため、ノート単位で順番に処理する（queueSaveIndex と同じ方式）
  const chatWritebackChainsRef = useRef(new Map<string, Promise<void>>());
  // 書き戻しの一時失敗（オフライン等）のリトライ回数
  const chatWritebackAttemptsRef = useRef(new Map<string, number>());
  useEffect(() => {
    const dispatch = async (run: ChatRunState) => {
      if (run.status === "running") return;
      // 1) 元ノートがメインエディタで開かれている → ライブ store へ反映する。
      //    エディタの store が chats の正であり、ファイル直書きは次のオートセーブ
      //    （buildDocument が store から全量再構成）で巻き戻るため
      //    （propagateMentionRename の skipNoteIds と同じ理由）。
      //    未採番（noteId null）の run は noteId では照合できないため、開始した
      //    エディタインスタンスの所有権（ownsRun）で判定する。ライブ反映後の
      //    markDirty → オートセーブが新規ファイルを作成し、応答も一緒に保存される
      const apply = chatRunApplyRef.current;
      if (apply && (run.noteId ? apply.noteId === run.noteId : apply.ownsRun(run.runId))) {
        if (!chatRunManager.claim(run.runId)) return;
        if (run.status === "done") apply.applyResult(run);
        else if (run.status === "aborted") apply.applyAborted(run);
        else apply.applyError(run);
        chatRunManager.consume(run.runId);
        return;
      }
      // 2) 未採番の新規ノートのまま閉じられた run は書き戻し先が無い（極小ケース）。
      //    エラー run も含めて破棄する（残すと復元経路が無く manager に漏れ続ける）
      if (!run.noteId) {
        console.warn("[chat-run] 書き戻し先ノートが未採番のため応答を破棄:", run.runId);
        chatRunManager.consume(run.runId);
        return;
      }
      // 3) エラー・中断はファイルに書き戻さない（エラーを保存しない現行仕様に合わせる）。
      //    アクティブノートで止めた場合は case 1 の applyAborted が markDirty 経由で
      //    保存する。切替後に止めた稀ケースはここへ来るが、破棄で許容する。
      if (run.status === "error" || run.status === "aborted") return;
      // 4) 対象ノートが一覧・アセットビューのサイドピークで開かれている間は保留する。
      //    ピークの doSave（docRef spread）と書き戻しの load→save が交錯すると、
      //    直前のピーク保存の本文が巻き戻るため。ピークが閉じたら effect 再実行
      //    （deps の peek state 変化）の取りこぼし回収で書き戻される
      if (run.noteId === listSidePeekNoteId || run.noteId === assetSidePeekNoteId) return;
      // 5) ファイルへ書き戻す。実行中のユーザー編集を巻き戻さないよう、最新 doc を
      //    読み直して chats だけ upsert する（buildDocument は経由しない）
      if (!chatRunManager.claim(run.runId)) return;
      const noteId = run.noteId;
      const chain = chatWritebackChainsRef.current.get(noteId) ?? Promise.resolve();
      const task = chain.then(async () => {
        const baseDoc = await loadNoteDocByFullKey(noteId, fmGetCachedDocStable);
        if (!baseDoc) {
          throw new Error(`書き戻し先ノートが読み込めませんでした: ${noteId}`);
        }
        const existing = baseDoc.chats?.find((c) => c.id === run.chatId) ?? null;
        const chat = buildRunScopeChat(run, existing);
        const nextDoc: GraphiumDocument = {
          ...baseDoc,
          chats: upsertChat(baseDoc.chats ?? [], chat),
          // modifiedAt を必ず進める（doc キャッシュ採用判定・index の stale 判定が
          // modifiedAt 依存のため。bump 漏れは「古い doc」と判定され巻き戻る）
          modifiedAt: new Date().toISOString(),
        };
        await saveNoteDoc({
          noteId,
          doc: nextDoc,
          // 保存成功時のみ doc キャッシュ・インデックスを最新化（#514 の不変条件）。
          // キャッシュ更新が無いと、次に開いたとき stale キャッシュから復元され、
          // そこからのオートセーブでディスク側の応答も巻き戻る
          onSaved: (id, savedDoc) => fmReindexNoteFromDocStable(id, savedDoc),
        });
        // 書き戻し中（load→save の間）にユーザーが元ノートを開き直していた場合、
        // マウント時の復元は書き戻し前の doc を読んでいるため、ライブ store の
        // チャット一覧にも反映して取りこぼしを防ぐ
        const applyAfter = chatRunApplyRef.current;
        if (applyAfter && applyAfter.noteId === noteId) {
          applyAfter.refreshChats(nextDoc);
        }
      });
      // チェーンは失敗しても後続を止めない（リトライは run 単位で管理する）
      chatWritebackChainsRef.current.set(noteId, task.catch(() => {}));
      try {
        await task;
        chatWritebackAttemptsRef.current.delete(run.runId);
        chatRunManager.consume(run.runId);
      } catch (err) {
        // 一時失敗（オフライン・プロバイダ不調等）の可能性があるため即破棄しない。
        // claim を返上し、次のディスパッチ機会（新たな settle / effect 再購読）で
        // 再試行する。3 回失敗したら諦めて破棄する（無限リトライ防止）
        const attempts = (chatWritebackAttemptsRef.current.get(run.runId) ?? 0) + 1;
        chatWritebackAttemptsRef.current.set(run.runId, attempts);
        if (attempts >= 3) {
          console.error("[chat-run] チャット応答の書き戻しに 3 回失敗したため破棄:", err);
          chatWritebackAttemptsRef.current.delete(run.runId);
          chatRunManager.consume(run.runId);
        } else {
          console.warn(`[chat-run] チャット応答の書き戻しに失敗（${attempts} 回目）:`, err);
          chatRunManager.unclaim(run.runId);
        }
      }
    };
    const unsubscribe = chatRunManager.subscribe((run) => void dispatch(run));
    // 購読開始前に完了していた run・保留していた run を回収する（取りこぼし防止）
    for (const run of chatRunManager.getSettledRuns()) void dispatch(run);
    return unsubscribe;
  }, [fmGetCachedDocStable, fmReindexNoteFromDocStable, listSidePeekNoteId, assetSidePeekNoteId]);
  // メインコンテンツ領域に排他表示される「オーバーレイ／リストビュー」を一括で畳む。
  // これらは note-app レベルの巨大な ternary（showGlobalGraph → activeAssetType →
  // activeLabel → showNoteList → showMemos → showMobile → activeWikiView → activeWikiKind →
  // showSharedLibrary → showTrash → showSkillList → 本文エディタ）で本文より
  // 優先表示される。ビュー切替・SidePeek 最大化など「本文へ遷移する経路」は
  // これらを **全て** 畳まないと、別のビューが残って表示される（例: スキル一覧を
  // 開いた後にノートを最大化するとスキル一覧が出続けるバグ）。
  // 各ハンドラが個別に N-1 個クリアする方式は、ビューを 1 つ足すたびに消し忘れ、
  // 同種のバグを再発させてきた。ここに集約し「畳んでから自分のフラグだけ立てる」に統一する。
  // 素材ギャラリー（AssetGalleryView）の「詳細ピーク／Full view」は上のフラグでは畳めない
  // — コンポーネント内部の state だからだ。activeAssetType を同じ値で押し直すと
  // 再マウントもされないため、closeAllViews からこのカウンタを上げて畳むよう伝える。
  const [assetViewResetSeq, setAssetViewResetSeq] = useState(0);
  const closeAllViews = useCallback(() => {
    fm.setShowNoteList(false);
    fm.setActiveAssetType(null);
    fm.setActiveLabel(null);
    fm.setShowProcessGallery(false);
    fm.setActiveWikiKind(null);
    setShowMemos(false);
    setShowMobile(false);
    setShowTrash(false);
    setShowSharedLibrary(false);
    setShowGlobalGraph(false);
    setShowSkillList(false);
    setActiveWikiView(null);
    // 素材を Full view で開いたままサイドバーの同じ素材カテゴリを押すと
    // 「一覧に戻れない（押しても無反応）」になるのを防ぐ。
    setAssetViewResetSeq((n) => n + 1);
  }, [fm]);
  // 手順を書いたノートの件数。プロセス一覧の入口を出すかの判定に使う。
  // 投影キャッシュがあればそれが正（一覧の件数と一致する）。まだ一度も投影して
  // いないときだけ note-index の steps から見積もる — 入口を出す判断には足りる。
  // 見積もりは題のない step を数え落とすので、一覧を開くと数が少し動くことがある。
  const processNoteCount = useMemo(
    () =>
      fm.processIndex
        ? fm.processIndex.processes.length
        : (fm.noteIndex?.notes ?? []).filter(
            (n) => n.source !== "ai" && !n.deletedAt && !n.archivedAt && (n.steps?.length ?? 0) > 0,
          ).length,
    [fm.processIndex, fm.noteIndex],
  );
  // 通常ノート ID → 派生 wiki エントリ配列の逆引きマップ（Knowledge 化済み判定用）
  const appKnowledgeMap = useMemo(() => buildKnowledgeMap(fm.noteIndex ?? null), [fm.noteIndex]);
  // 全ノードグラフ用データ。開いている間だけ index から構築する（閉じている間は空）。
  const globalGraphData = useMemo(
    () =>
      showGlobalGraph && fm.noteIndex
        ? buildGlobalGraph(fm.noteIndex, fm.mediaIndex ?? null)
        : { nodes: [], edges: [] },
    [showGlobalGraph, fm.noteIndex, fm.mediaIndex],
  );
  // ノートを開いたら（activeFileId が変わったら）全体グラフは畳む。
  // SidePeek の「開く」/サイドバーの最近ノード/新規作成など、ノートを開くあらゆる経路を
  // 1 箇所でカバーする（各ハンドラに個別の setShowGlobalGraph(false) を撒かずに済む）。
  const prevActiveFileIdRef = useRef(fm.activeFileId);
  useEffect(() => {
    if (fm.activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = fm.activeFileId;
      setShowGlobalGraph(false);
    }
  }, [fm.activeFileId]);

  // 世界モデル照合 共通ハンドラ（Phase 2 / PR 2A）。
  // 照合発火はすべて **ユーザー起動**（バナー単発 / 一覧 bulk）に統一する。
  // 開くたびの自動発火はしない（kickoff §4 + PR 2A 方針 §4: 頼んでいない判定の押し付けを避ける）。
  // PR 2B で LLM fallback / KB-as-cache を入れる際は trigger の意味が増えるが、
  // 現状は 2 つだけ。
  const handleWorldCheckWiki = useCallback(
    async (
      wikiId: string,
      trigger: "manual" | "bulk" | "background" = "manual",
    ): Promise<void> => {
      const cached = fm.getCachedDoc(`wiki:${wikiId}`);
      const doc = cached ?? (await fm.loadDoc(`wiki:${wikiId}`));
      if (!doc?.wikiMeta) return;
      // Summary は対象外（PR 2A §1 の主張系: claim/atom/synthesis 用）
      if (doc.wikiMeta.kind === "summary") return;
      if (worldCheckingWikiId === wikiId) return;
      // 自動（background）は未照合だけを対象にする — 既に checkedAt があれば再照合しない
      const silent = trigger === "background";
      if (silent && doc.wikiMeta.grounding?.validity?.checkedAt) return;
      const wikiTitle = doc.title ?? wikiId;
      const toastId = `wgrd:${wikiId}`;
      setWorldCheckingWikiId(wikiId);
      // 自動照合はトースト通知を出さない（背景で静かに走る）
      if (!silent) {
        setIngestToast((prev) => ({
          items: [
            ...(prev?.items ?? []),
            {
              id: toastId,
              status: "generating" as const,
              noteTitle: `Checking "${wikiTitle}" against world KB`,
              detail: "KB → model (cached on hit)",
            },
          ],
        }));
      }
      try {
        const claimText = `${doc.title}\n\n${extractPlainTextFromDoc(doc)}`;
        const validity = await checkValidity(doc.wikiMeta, claimText, {
          // LLM 判定時の rationale を現在のロケールで書かせる
          language: getLocale(),
        });
        const next: GraphiumDocument = {
          ...doc,
          wikiMeta: attachValidity(doc.wikiMeta, validity),
          modifiedAt: new Date().toISOString(),
        };
        // activityType 無しで保存 — document-provenance に phantom revision を作らない（PR 2A 方針 §2）
        await fm.handleSaveWikiFile(wikiId, next);
        // activeDoc は handleSaveWikiFile では更新されないので、現在開いているノートなら再同期する
        if (fm.activeFileId === `wiki:${wikiId}`) {
          fm.handleOpenWikiFile(wikiId);
        }
        // checkedBy で「KB ヒット」「LLM 判定」「engine 無し / API エラー」を出し分ける（PR 2B）
        const checkedBy = validity?.checkedBy ?? "distilled-kb@v1";
        const isKbHit = checkedBy === "distilled-kb@v1";
        const isNoEngine = checkedBy === "no-engine";
        const isEngineError = checkedBy === "engine-error";
        let resultMsg: string;
        if (isNoEngine) {
          // モデル未登録 + KB miss — Settings でモデルを設定するよう促す
          resultMsg = "KB miss, no model registered (Settings → AI)";
        } else if (isEngineError) {
          // モデルは登録されているが API 呼び出しが失敗した
          const reason = validity?.rationale ?? "unknown error";
          resultMsg = `KB miss, model call failed: ${reason}`;
        } else if (validity?.verdict) {
          const sourcePart = isKbHit ? "from KB" : `judged by ${checkedBy}`;
          resultMsg = `verdict: ${validity.verdict} (${sourcePart})`;
        } else if (isKbHit) {
          resultMsg = "KB checked, no match";
        } else {
          // LLM が verdict: null を返した（out of domain と言った）
          resultMsg = `${checkedBy} returned: out of domain`;
        }
        if (!silent) {
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId
                ? { ...i, status: "success" as const, detail: undefined, result: resultMsg }
                : i
            ),
          }));
        } else {
          void resultMsg;
        }
      } catch (err) {
        console.error("[world-grounding] check failed:", err);
        const msg = localizeAiError(err);
        if (!silent) {
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId
                ? { ...i, status: "error" as const, detail: undefined, result: msg }
                : i
            ),
          }));
        } else {
          // background 経路はハード失敗を呼び出し元（自動 grounding hook）に伝える。
          // checkedAt が付かない例外なので、再 pick によるホットループを防ぐため failed に積ませる。
          throw err;
        }
      } finally {
        setWorldCheckingWikiId((cur) => (cur === wikiId ? null : cur));
      }
    },
    [fm, worldCheckingWikiId],
  );

  // ノートに焼き付いた照合結果（verdict / 出典 URL）をクリアする。
  // 間違った判定や幻覚 URL が残ったとき、再 Check を待たずに消せる導線。
  // KB キャッシュ（設定 → 世界照合）とは別レイヤで、ここはノート側 WikiMeta に
  // 保存された validity を消す。
  // ただし validity を完全に undefined にすると「未照合」に戻り、自動照合が ON だと
  // すぐ付け直されてしまう。「手動で消した＝自動で付け直してほしくない」という意思を
  // 尊重するため、`{ dismissed: true }` を残して自動照合の対象から外す。
  // （手動「世界照合」で再照合すれば新しい validity に置き換わる）
  const handleClearWorldValidity = useCallback(
    async (wikiId: string): Promise<void> => {
      const cached = fm.getCachedDoc(`wiki:${wikiId}`);
      const doc = cached ?? (await fm.loadDoc(`wiki:${wikiId}`));
      if (!doc?.wikiMeta?.grounding?.validity) return;
      // 既に dismissed だけの状態なら何もしない（無駄な保存を避ける）
      const v = doc.wikiMeta.grounding.validity;
      if (v.dismissed && !v.verdict && !v.checkedAt) return;
      const next: GraphiumDocument = {
        ...doc,
        wikiMeta: attachValidity(doc.wikiMeta, { dismissed: true }),
        modifiedAt: new Date().toISOString(),
      };
      // 照合と同じく activityType 無しで保存（phantom revision を作らない）
      await fm.handleSaveWikiFile(wikiId, next);
      if (fm.activeFileId === `wiki:${wikiId}`) {
        fm.handleOpenWikiFile(wikiId);
      }
    },
    [fm],
  );

  // 自動 world-grounding（opt-in / 既定 OFF）。設定 ON のとき、洞察・知見が追加された
  // タイミング（wikiMetas の変化）に反応して未照合を 1 件ずつ照合する（直列 + デバウンス）。
  useAutoGrounding({
    enabled: experimentalFlags.autoGrounding ?? false,
    wikiMetas: fm.wikiMetas,
    busy: worldCheckingWikiId !== null,
    groundOne: (wikiId) => handleWorldCheckWiki(wikiId, "background"),
  });

  // Phase 4 (PR-B7): PROV-JSON-LD エクスポートに含める Wiki Knowledge Layer の
  // 意味的な型（atomType / synthesisMode / procedureContext / ...）を組み立てる。
  //
  // スコープ: エクスポートは「開いているノート単位」の操作なので、Knowledge も
  // 「そのノートから直接抽出された知識」だけに絞る（ワークスペース全体ではない）。
  // derivedFromNotes はキャッシュ非依存で全件揃う noteIndex を確実な源にする。
  const provWikiEntities = useMemo<WikiEntityInfo[]>(() => {
    const rootNoteId = fm.activeFileId
      ? fm.activeFileId.replace(/^(wiki|skill):/, "")
      : null;
    const indexById = new Map(
      (fm.noteIndex?.notes ?? []).map((n) => [n.noteId, n] as const),
    );

    // 各 wiki の derivedFromNotes をまず確定（キャッシュ優先・無ければ index）。
    const entries = fm.wikiFiles.map((wf) => {
      const cachedDoc = fm.getCachedDoc(`wiki:${wf.id}`);
      const wm = cachedDoc?.wikiMeta;
      const derivedFromNotes =
        wm?.derivedFromNotes ?? indexById.get(wf.id)?.derivedFromNotes ?? [];
      return { wf, wm, cachedDoc, derivedFromNotes };
    });

    const scope = selectNoteScopedWikiIds(
      rootNoteId,
      entries.map((e) => ({ id: e.wf.id, derivedFromNotes: e.derivedFromNotes })),
    );

    const out: WikiEntityInfo[] = [];
    for (const { wf, wm, cachedDoc, derivedFromNotes } of entries) {
      if (!scope.has(wf.id)) continue;
      const meta = fm.wikiMetas.get(wf.id);
      if (!meta) continue;
      out.push({
        id: wf.id,
        title: meta.title,
        kind: meta.kind,
        status: meta.status ?? "active",
        generatedAt: wm?.generatedAt ?? wf.modifiedTime,
        model: wm?.generatedBy?.model ?? meta.model ?? "unknown",
        derivedFromNotes,
        citedKnowledgeIds: wm?.citedKnowledgeIds,
        // Atom の上流（atomize lane）。export で Derivation を出さないと孤児になる。
        derivedFromClaims: wm?.derivedFromClaims,
        derivedFromChats: wm?.derivedFromChats,
        // 成長過程（編集来歴）。キャッシュ未ロードの wiki は同梱されない
        // （derivedFromNotes と同じキャッシュ依存の制約）。
        documentProvenance: cachedDoc?.documentProvenance,
        atomType: meta.atomType,
        synthesisMode: meta.synthesisMode,
        hypothesisStatus: meta.hypothesisStatus,
        claimRole: meta.claimRole,
        level: meta.level,
        confidence: wm?.confidence,
        procedureContext: wm?.procedureContext,
      });
    }
    return out;
  }, [fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc, fm.noteIndex, fm.activeFileId]);

  // 検索結果からノート行をクリック / Enter したときのジャンプハンドラ。
  // wiki エントリは handleOpenWikiFile + wikiKind ナビ、それ以外は handleOpenFile。
  // source === "ai" でなくても、index 側に wikiKind があれば wiki 経路に振る
  // （古いインデックスや source 欠落エントリで Recent Notes に wiki が混入するのを防ぐ）。
  const handleComposerNoteSelect = useCallback(
    (noteId: string, source: "human" | "ai" | "skill" | undefined) => {
      setComposerPrompt("");
      composer.closeComposer();
      const entry = fm.noteIndex?.notes.find((n) => n.noteId === noteId);
      if (source === "ai" || entry?.wikiKind) {
        if (entry?.wikiKind) fm.setActiveWikiKind(entry.wikiKind);
        fm.handleOpenWikiFile(noteId);
        return;
      }
      fm.handleOpenFile(noteId);
    },
    [composer, fm],
  );

  // Cmd+K: どこからでも Composer を開く。
  // ノート編集中は AI 質問まで使えるが、一覧・Wiki ハブ・アセットギャラリー等では
  // NoteEditor が描画されておらず composerSubmitRef が空なので、検索専用として開く
  // （AI 行・発見カード・grounding チップは出さない）。
  // AI モデル未登録のときも同じ検索専用の姿で開く — 本文・素材の検索（語彙インデックス）は
  // AI と無関係に動くので、AI を使わない人の入口を塞がない（AI 導線だけを隠す）。
  // 開いた瞬間の状態を state へ写す — ref の変化では再描画されないため。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setComposerCanAskAi(aiUiEnabled && !!composerSubmitRef.current);
        composer.toggleComposer();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [composer, aiUiEnabled]);

  // ⌘+⇧+M: どこからでも Quick Memo ダイアログを開く。
  // メモは「気軽な思いつきを書き留める原料」なので、画面状態に依存せず
  // ノート編集中でも一覧画面でも同じ操作で開けるよう document レベルで購読する。
  // デスクトップ (Tauri/WKWebView) では Cmd 系キーが JS keydown まで届かないことがあるため、
  // Rust 側で ⌘⇧M アクセラレータを持つネイティブメニュー項目 "new-memo" を併設し、
  // その menu-action もここで購読する。Web では menu-action は発火しないので無害。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setShowQuickMemoDialog(true);
      }
    };
    document.addEventListener("keydown", handler);
    const offMenu = onMenuAction("new-memo", () => setShowQuickMemoDialog(true));
    return () => {
      document.removeEventListener("keydown", handler);
      offMenu();
    };
  }, []);

  // ノートにはグローバルショートカットを設けない。
  // 理由: ⌘⇧N はブラウザのシークレットウィンドウと衝突して preventDefault が効かないため、
  // 学習させたショートカットが裏切る体験になる。サイドバーの「+ ノート」ボタンが常設の入口。
  // ノートはじっくり書くもの、メモは即記録、というメンタルモデルの非対称さも UI で素直に表現する。

  // Composer が開いた瞬間だけ wikiLog の直近イベントを取得してカード計算に使う
  // (常時 subscribe しない理由: ログは IndexedDB なので軽量、開いた時だけで十分)
  useEffect(() => {
    if (!composer.open) return;
    // 開いた瞬間の引用数を読む（モーダル表示中はノート編集不可なので静的でよい）
    setComposerCitationCount(composerCitationRef.current?.() ?? 0);
    let cancelled = false;
    wikiLog.getRecent(50).then((entries) => {
      if (!cancelled) setRecentWikiLogEntries(entries);
    }).catch(() => { /* IndexedDB 未対応環境などは静かに失敗 */ });
    return () => { cancelled = true; };
  }, [composer.open]);

  // 発見カードは noteIndex / 現ノート / wikiLog から純関数で導出
  const composerDiscoveryCards = useMemo(
    () => buildDiscoveryCards({
      noteIndex: fm.noteIndex ?? null,
      activeFileId: fm.activeFileId,
      wikiLogEntries: recentWikiLogEntries,
    }),
    [fm.noteIndex, fm.activeFileId, recentWikiLogEntries],
  );

  // ─── URL ハッシュルーター ───
  const routeActions: RouteActions = useMemo(() => ({
    openFile: (fileId: string) => fm.handleOpenFile(fileId),
    openWikiFile: (wikiId: string) => fm.handleOpenWikiFile(wikiId),
    setShowNoteList: (show: boolean) => fm.setShowNoteList(show),
    setActiveWikiKind: (kind: WikiKind | null) => fm.setActiveWikiKind(kind),
    setActiveWikiView: (view: "log" | "lint" | null) => setActiveWikiView(view),
    setActiveAssetType: (type: import("./features/asset-browser").MediaType | null) => fm.setActiveAssetType(type),
    setActiveLabel: (label: string | null) => fm.setActiveLabel(label),
    setShowMemos: (show: boolean) => setShowMemos(show),
    // 受信箱は Tauri 専用。web で #mobile を直接叩かれても開かない
    //（サイドバーにも出さない）。
    setShowMobile: (show: boolean) => setShowMobile(show && isTauri()),
    setShowSharedLibrary: (show: boolean) => setShowSharedLibrary(show),
    // ルート適用時のオーバーレイ畳みも、サイドバー/最大化と同じ closeAllViews に集約する
    // （showSkillList / showTrash の畳み漏れを防ぐ。以前は個別列挙で漏れていた）。
    clearViews: closeAllViews,
  }), [fm, closeAllViews]);
  const router = useHashRouter(routeActions, !fm.filesLoading);

  // 引用カードの「開く」→ Library の該当エントリを選択表示で開く。
  // Library はアプリレベルのビューなのでコールバックもアプリ単位で 1 個登録する。
  useEffect(() => {
    setSharedEntryOpenCallback((sharedId) => {
      if (!getSharedRoot()) return;
      closeAllViews();
      setSharedLibraryFocusId(sharedId);
      setShowSharedLibrary(true);
      setSidebarOpen(false);
      router.navigate({ view: "shared-library" });
    });
    return () => setSharedEntryOpenCallback(null);
  }, [closeAllViews, router]);

  // Cmd+K の検索結果から画像行を選んだときのハンドラ。
  // ノートへ飛ばさず素材の一覧（画像タブ）へ移り、その画像をサイドピークで開いた状態にする。
  // 1 枚の画像は複数ノートで使われうるし、どのノートにも貼られていないこともあるので、
  // 行き先は素材そのものが正しい。使っているノートはサイドピークから辿れる。
  // fullMode: false = 一覧を残したまま右に開く（グラフからの導線は Full view を使う）。
  const handleComposerMediaSelect = useCallback(
    (entry: MediaIndexEntry) => {
      setComposerPrompt("");
      composer.closeComposer();
      closeAllViews();
      fm.setActiveAssetType(entry.type);
      setFocusedMaterial({ fileId: entry.fileId, fullMode: false });
      setSidebarOpen(false);
      router.navigate({ view: "assets", mediaType: entry.type });
    },
    [composer, fm, closeAllViews, router],
  );

  // memo:<captureId> ソース（wiki の派生元・グラフノード・References の @ラベル）を
  // 「その場」の素材サイドピークでプレビューする（pdf:/url: ソースと同じ流儀）。
  // エディタ表示中は openMaterialPeekRef 経由でエディタ内ピーク、
  // リスト・全体グラフ文脈ではリスト用素材ピークに出す。
  // メモが削除済みのときだけメモ一覧へ遷移する（そこで存在しないことが分かる）。
  const handleOpenMemoSource = useCallback((captureId: string) => {
    const cap = capture.captureIndex?.captures?.find((c) => c.id === captureId);
    if (!cap) {
      setListSidePeekNoteId(null);
      closeAllViews();
      setShowMemos(true);
      setSidebarOpen(false);
      router.navigate({ view: "memos" });
      return;
    }
    const entry = buildMemoPeekEntry(cap);
    if (openMaterialPeekRef.current) {
      openMaterialPeekRef.current(entry);
    } else {
      // ノートピークと素材ピークを同時に開かない（既存の onOpenMaterialPeek と同じ扱い）
      setListSidePeekNoteId(null);
      setListMaterialPeekEntry(entry);
    }
  }, [capture.captureIndex, closeAllViews, router]);

  // Ingest キューを処理する関数
  const processIngestQueue = useCallback(async () => {
    if (ingestRunningRef.current) return;
    ingestRunningRef.current = true;
    const abortController = new AbortController();
    ingestAbortRef.current = abortController;
    const signal = abortController.signal;

    while (ingestQueueRef.current.length > 0) {
      // 停止済みなら残りのキューを「中断」で畳んで抜ける
      if (signal.aborted) break;
      const job = ingestQueueRef.current[0];
      const jobId = job.noteId;

      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === jobId ? { ...i, status: "generating" as const, detail: "AI analyzing..." } : i
        ),
      }));

      try {
        const allExistingWikis = (fm.noteIndex?.notes ?? [])
          .filter((n) => n.source === "ai" && n.wikiKind)
          .map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));

        // Ingest 時のマージ判定: LLM に渡す既存 Wiki タイトル一覧を関連度順にする。
        // タイトルだけなのでトークンコストは軽いが、Wiki 数が増えると LLM の attention が
        // 散ってマージ候補を見落とすため、(a) 関連度順にリオーダー (b) 上限 200 件でキャップ。
        // 母集団が 200 未満なら全件残し、並べ替えだけ行う（既存挙動とほぼ同じ）。
        const INGEST_TITLE_CAP = 200;
        const queryText = `${job.noteTitle ?? job.doc.title ?? ""}`;
        const existingWikis = allExistingWikis.length === 0
          ? allExistingWikis
          : rankCandidatesByRelevance(
              { embedding: null, similarityText: queryText },
              allExistingWikis.map((w) => ({ ...w, embedding: null, similarityText: w.title })),
              INGEST_TITLE_CAP,
            ).map(({ id, title, kind }) => ({ id, title, kind }));

        // Ingest 自動適用の Skill を取得（生成言語 = ja に絞る）
        const ingestSkills = pickActiveSkills(
          fm.skillMetas,
          (id) => fm.getCachedDoc(`skill:${id}`),
          getLocale(),
        );

        // 設定で選んだ既定モデル名を渡す。Tauri モードではヘッダーに API キーを乗せないため、
        // body.model 経由でサーバーに伝えないと models.json 先頭のモデルにフォールバックしてしまう。
        const result = await ingestNote(job.noteId, job.doc, existingWikis, getLocale(), getSelectedModel() || undefined, ingestSkills, signal);

        if (result.wikis.length === 0) {
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === jobId ? { ...i, status: "error" as const, detail: undefined, result: tStatic("ingest.insufficientContent") } : i
            ),
          }));
          ingestQueueRef.current.shift();
          continue;
        }

        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === jobId
              ? { ...i, status: "saving" as const, detail: `${result.wikis.length} wiki(s) saving...` }
              : i
          ),
        }));

        const createdWikiIds: string[] = [];
        const createdWikiTitles: string[] = [];
        for (const wiki of result.wikis) {
          if (wiki.suggestedAction === "merge" && wiki.mergeTargetId) {
            try {
              const existingDoc = fm.getCachedDoc(`wiki:${wiki.mergeTargetId}`);
              if (existingDoc) {
                const nIdx = buildNoteIndex(fm.noteIndex);
                const mergedDoc = await rewriteAndMerge(existingDoc, wiki, job.noteId, result.model, getLocale(), nIdx, ingestSkills);
                await fm.handleSaveWikiFile(wiki.mergeTargetId, mergedDoc, {
                  activityType: "wiki_merge",
                  agentLabel: result.model ?? undefined,
                  sources: [job.noteId],
                });
                embedWikiSections(wiki.mergeTargetId, mergedDoc).catch(() => {});
                createdWikiIds.push(wiki.mergeTargetId);
                createdWikiTitles.push(wiki.title);
                wikiLog.append("merge", [wiki.mergeTargetId], `Merged into "${wiki.title}" from "${job.noteTitle}"`).catch(() => {});
                // memo: 由来ならナレッジ化先（マージ先 wiki）を元メモに逆リンク記録
                //（一覧の In Knowledge バッジ・詳細の Knowledge 化先リンクに使う）
                if (job.noteId.startsWith("memo:")) {
                  void capture.handleRecordKnowledged(job.noteId.slice("memo:".length), `wiki:${wiki.mergeTargetId}`, wiki.title);
                }
                continue;
              }
            } catch { /* fallback to create */ }
          }
          const wikiTitleMap = existingWikis.map((w) => ({ id: w.id, title: w.title }));
          const wikiDoc = buildWikiDocument(wiki, job.noteId, result.model, job.noteTitle, wikiTitleMap, getLocale(), buildNoteIndex(fm.noteIndex));
          // 使用した Skill を記録
          if (ingestSkills.length > 0 && wikiDoc.wikiMeta) {
            wikiDoc.wikiMeta.skillsUsed = ingestSkills.map((s) => s.title);
          }
          const newId = await fm.handleCreateWikiFile(wikiDoc);
          embedWikiSections(newId, wikiDoc).catch(() => {});
          createdWikiIds.push(newId);
          createdWikiTitles.push(wiki.title);
          wikiLog.append("ingest", [newId], `Created "${wiki.title}" from "${job.noteTitle}"`).catch(() => {});
          // memo: 由来ならナレッジ化先 wiki を元メモに逆リンク記録
          //（旧フローではノート ID を記録していたが、直接 ingest 化で wiki を記録する）
          if (job.noteId.startsWith("memo:")) {
            void capture.handleRecordKnowledged(job.noteId.slice("memo:".length), `wiki:${newId}`, wiki.title);
          }
        }

        // 横断更新: 既存 Concept ページの自動更新
        if (existingWikis.length > 0 && job.doc) {
          (async () => {
            try {
              // ② Cross-Update に渡す既存 Wiki は本文込みで重いので、関連度上位 K 件に絞る。
              // 母集団が大きいと context length に当たって silent fail するリスクがある。
              // 上限は 30 件で固定。embedding が両方そろっていれば cosine、それ以外は
              // タイトル + section preview の token Jaccard でフォールバック。
              const CROSS_UPDATE_CAP = 30;
              const allExistingDetails = existingWikis
                .filter((w) => w.kind === "claim" && !createdWikiIds.includes(w.id))
                .map((w) => {
                  const doc = fm.getCachedDoc(`wiki:${w.id}`);
                  return doc ? extractWikiDetail(w.id, doc) : null;
                })
                .filter((d): d is NonNullable<typeof d> => d !== null);

              if (allExistingDetails.length > 0) {
                // children も再帰する共通ヘルパーで抽出（トップレベルの content
                // だけ見ると、本文が step・カラムの中にあるノートが空扱いになる）
                const noteContent = blocksToPlainText(job.doc);

                // クエリ embedding は、直前に作った Wiki の代表ベクトルを使う
                // （embed が非同期で間に合っていない可能性あり → null フォールバック）
                const queryEmbedding = createdWikiIds.length > 0
                  ? await getDocEmbedding(createdWikiIds[0]).catch(() => null)
                  : null;
                const queryText = `${job.noteTitle}\n${noteContent.slice(0, 1000)}`;

                const candidateFeatures = await Promise.all(
                  allExistingDetails.map(async (d) => ({
                    detail: d,
                    embedding: await getDocEmbedding(d.id).catch(() => null),
                    similarityText: `${d.title}\n${d.sectionPreviews.join("\n")}`,
                  })),
                );
                const ranked = rankCandidatesByRelevance(
                  { embedding: queryEmbedding, similarityText: queryText },
                  candidateFeatures,
                  CROSS_UPDATE_CAP,
                );
                const existingDetails = ranked.map((f) => f.detail);

                const crossResult = await fetchCrossUpdateProposals({
                  newNoteTitle: job.noteTitle,
                  newNoteContent: noteContent,
                  newWikiTitles: createdWikiTitles,
                  existingWikis: existingDetails,
                  language: getLocale(),
                  ...(ingestSkills.length > 0 ? { skills: ingestSkills } : {}),
                });

                for (const proposal of crossResult.proposals) {
                  const targetDoc = fm.getCachedDoc(`wiki:${proposal.targetWikiId}`);
                  if (!targetDoc) continue;
                  const updatedDoc = await applyCrossUpdate(targetDoc, proposal, job.noteId, result.model, buildNoteIndex(fm.noteIndex), ingestSkills, getLocale());
                  await fm.handleSaveWikiFile(proposal.targetWikiId, updatedDoc, {
                    activityType: "wiki_cross_update",
                    agentLabel: result.model ?? undefined,
                    sources: [job.noteId],
                  });
                  embedWikiSections(proposal.targetWikiId, updatedDoc).catch(() => {});
                  wikiLog.append(
                    "cross-update",
                    [proposal.targetWikiId],
                    `Updated "${proposal.targetWikiTitle}" (${proposal.updateType}): ${proposal.reason}`,
                  ).catch(() => {});
                }
              }
            } catch (err) {
              console.error("Cross-update failed:", err);
            }
          })();
        }

        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === jobId
              ? { ...i, status: "success" as const, detail: undefined, result: `${result.wikis.length} wiki(s)` }
              : i
          ),
        }));
      } catch (err) {
        // ユーザーの「停止」による中断は失敗ではない。aborted として畳む。
        const aborted = isAbortError(err) || signal.aborted;
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === jobId
              ? aborted
                ? { ...i, status: "aborted" as const, detail: undefined, result: tStatic("ingest.aborted") }
                : { ...i, status: "error" as const, detail: undefined, result: localizeAiError(err) }
              : i
          ),
        }));
      }

      ingestQueueRef.current.shift();
    }

    // 停止で抜けた場合: まだ queued のまま残っている項目を aborted に畳み、
    // 後半のパイプライン（Atomize / Lint）も走らせない。
    if (signal.aborted) {
      const remaining = ingestQueueRef.current.map((j) => j.noteId);
      ingestQueueRef.current = [];
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          remaining.includes(i.id) || i.status === "queued"
            ? { ...i, status: "aborted" as const, detail: undefined, result: tStatic("ingest.aborted") }
            : i
        ),
      }));
      ingestAbortRef.current = null;
      ingestRunningRef.current = false;
      return;
    }

    // パイプライン後半（Atomize / Lint）の進捗を 1 つの
    // トーストアイテムで可視化する。スキップ理由・件数を ユーザーに見せ、
    // 「summary 出た後に何が動いているのか分からない」状態を解消する。
    // 2026-05-27 の design revision で Synthesize 自動生成は撤退済み（stage 自体を削除）。
    const pipelineId = `pipeline:${Date.now()}`;
    const pipelineStages: IngestStage[] = [
      { key: "atomize", label: "Atomize", status: "pending" },
      { key: "lint", label: "Lint", status: "pending" },
    ];
    setIngestToast((prev) => ({
      items: [
        ...(prev?.items ?? []),
        {
          id: pipelineId,
          status: "generating" as const,
          noteTitle: "🧠 Knowledge pipeline",
          stages: pipelineStages,
        },
      ],
    }));

    const updateStage = (
      key: string,
      status: IngestStageStatus,
      detail?: string,
    ) => {
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) => {
          if (i.id !== pipelineId) return i;
          const stages = (i.stages ?? []).map((s) =>
            s.key === key ? { ...s, status, detail } : s
          );
          // すべてのステージが終端状態になったら overall を success/error に切り替える
          const remaining = stages.some(
            (s) => s.status === "pending" || s.status === "running"
          );
          const hasError = stages.some((s) => s.status === "error");
          const nextOverall = remaining
            ? ("generating" as const)
            : hasError
              ? ("error" as const)
              : ("success" as const);
          return { ...i, stages, status: nextOverall };
        }),
      }));
    };

    // 自動 Atomize: atom レイヤは default 有効化済み（design revision 2026-05-27）。
    // 全 Concept を見渡して共通抽象を discover する。Phase 1: クラスタ集中サンプリングを適用。
    // バルク投入直後の自動実行なので、メンテよりも K の上限を控えめ（=3）にする。
    const atomLabel = tStatic("settings.maintenance.kind.atom");
    if (isAtomLayerEnabled()) {
      try {
        const allClaimSnapshots = buildClaimSnapshots(
          fm.wikiFiles,
          fm.wikiMetas,
          fm.getCachedDoc,
          "claim",
          Number.POSITIVE_INFINITY,
        );
        if (allClaimSnapshots.length < 2) {
          updateStage("atomize", "skipped", tStatic("ingest.needTwoClaims", { count: String(allClaimSnapshots.length) }));
        } else {
          const claimModifiedByFileId = new Map(fm.wikiFiles.map((f) => [f.id, f.modifiedTime]));
          const claimEmbeddings = await Promise.all(
            allClaimSnapshots.map((s) => getDocEmbedding(s.id).catch(() => null)),
          );
          const claimCandidates: AtomCandidate[] = allClaimSnapshots.map((s, i) => ({
            snapshot: s,
            similarityText: `${s.title}\n${s.bodyPreview}`,
            embedding: claimEmbeddings[i],
            modifiedTime: claimModifiedByFileId.get(s.id) ?? "",
          }));
          const clusterCount = pickClusterCount(claimCandidates.length, {
            effectiveCoverage: 30,
            maxK: 3,
          });
          const seeds = pickFarthestSeeds(claimCandidates, clusterCount);
          const existingAtomTitles = [...fm.wikiMetas.entries()]
            .filter(([, m]) => m.kind === "atom")
            .map(([, m]) => m.title);
          let createdAtoms = 0;
          let reinforcedAtoms = 0;
          updateStage(
            "atomize",
            "running",
            tStatic("ingest.analyzingClusters", { claims: String(allClaimSnapshots.length), clusters: String(seeds.length) }),
          );
          for (let i = 0; i < seeds.length; i++) {
            const seed = seeds[i];
            const cluster = buildClusterSlice(claimCandidates, seed, MAX_SNAPSHOTS_PER_RUN);
            const slice = cluster.map((c) => c.snapshot);
            updateStage(
              "atomize",
              "running",
              tStatic("ingest.clusterProgress", {
                current: String(i + 1),
                total: String(seeds.length),
                title: seed.snapshot.title,
                count: String(slice.length),
                kind: atomLabel,
              }),
            );
            const atomResult = await atomizeConcepts(
              slice,
              getLocale(),
              { existingAtomTitles, model: getChatSynthesisModelName() || undefined, signal },
            );
            // 既存 Atom との embedding 類似で「新規」と「重複」に分割し、
            // 重複候補は捨てずに一致先 Atom への支持追加（reinforcement）に回す。
            // ゴミ箱/アーカイブ済み Atom は除外 — 不可視の Atom に候補が吸収されると
            // 「支持追加と表示されたのに何も現れない」事故になる（embedding は
            // soft-delete では消えないため wikiMetas だけでは弾けない）。
            const hiddenWikiIds = new Set(
              (fm.rawNoteIndex?.notes ?? [])
                .filter((n) => n.deletedAt || n.archivedAt)
                .map((n) => n.noteId),
            );
            const existingAtomDocIds = new Set(
              [...fm.wikiMetas.entries()]
                .filter(([id, m]) => m.kind === "atom" && !hiddenWikiIds.has(id))
                .map(([id]) => id),
            );
            const { kept, duplicates } = await partitionCandidatesByEmbedding(
              atomResult.atoms,
              existingAtomDocIds,
            );
            for (const candidate of kept) {
              const atomDoc = buildAtomDocument(candidate, atomResult.model ?? null, getLocale());
              const newId = await fm.handleCreateWikiFile(atomDoc, { activityType: "wiki_atomize" });
              embedWikiSections(newId, atomDoc).catch(() => {});
              wikiLog.append(
                "ingest",
                [newId],
                `${atomLabel}: "${candidate.title}" (from ${candidate.derivedFromConceptTitles.join(" + ")})`,
              ).catch(() => {});
              createdAtoms += 1;
              existingAtomTitles.push(candidate.title);
            }
            reinforcedAtoms += await applyAtomReinforcement({
              duplicates,
              loadDoc: fm.loadDoc,
              saveWikiFile: fm.handleSaveWikiFile,
            });
          }
          updateStage(
            "atomize",
            "done",
            createdAtoms > 0 || reinforcedAtoms > 0
              ? `${createdAtoms} ${atomLabel}`
                + (reinforcedAtoms > 0 ? ` / ${tStatic("ingest.reinforced", { count: String(reinforcedAtoms) })}` : "")
              : tStatic("ingest.noNewAtoms", { kind: atomLabel }),
          );
        }
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          // ユーザーの「停止」。以降の Lint も走らせず、ここで畳む。
          updateStage("atomize", "skipped", tStatic("ingest.aborted"));
          updateStage("lint", "skipped", tStatic("ingest.aborted"));
          ingestAbortRef.current = null;
          ingestRunningRef.current = false;
          return;
        }
        console.error("Atomize failed:", err);
        updateStage("atomize", "error", localizeAiError(err));
      }
    } else {
      updateStage("atomize", "skipped", tStatic("ingest.atomLayerDisabled"));
    }

    // Synthesis 自動生成パイプラインは撤退（2026-05-27、design revision）。
    // 砂時計のくびれ（synthesize）は人間に戻し、Cmd-K Composer 経由で再構築する想定。
    // 既存 synthesis ファイルの物理データは保持される。

    // 自動 Lint: ローカル検出 + LLM 分析（5ページ以上で LLM 実行）
    try {
      const snapshots = buildWikiSnapshots(fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc);
      if (snapshots.length < 2) {
        updateStage("lint", "skipped", tStatic("ingest.needTwoWikis", { count: String(snapshots.length) }));
      } else {
        updateStage("lint", "running", tStatic("ingest.analyzingWikis", { count: String(snapshots.length) }));
        // LLM Lint: 5ページ以上で矛盾・ギャップを LLM で分析
        const useLlm = snapshots.length >= 5;
        const report = await lintWikis(snapshots, getLocale(), !useLlm, signal);
        const issues = report.issues;

        if (issues.length > 0) {
          // contradiction はトーストで通知（人間が判断、自動修正不可）
          const contradictions = issues.filter((i) => i.type === "contradiction");
          if (contradictions.length > 0) {
            setIngestToast((prev) => ({
              items: [
                ...(prev?.items ?? []),
                ...contradictions.map((c) => ({
                  id: `lint:${crypto.randomUUID()}`,
                  status: "error" as const,
                  noteTitle: `⚠ ${c.title}`,
                  result: c.suggestion,
                })),
              ],
            }));
          }

          // orphan: cross-update で接続先を探して自動リンク
          const orphans = issues.filter((i) => i.type === "orphan");
          for (const orphan of orphans) {
            for (const wikiId of orphan.affectedWikiIds) {
              try {
                const doc = fm.getCachedDoc(`wiki:${wikiId}`);
                if (!doc) continue;
                const detail = extractWikiDetail(wikiId, doc);
                if (!detail) continue;
                const allOtherConcepts = snapshots
                  .filter((s) => s.kind === "claim" && s.id !== wikiId)
                  .map((s) => {
                    const d = fm.getCachedDoc(`wiki:${s.id}`);
                    return d ? extractWikiDetail(s.id, d) : null;
                  })
                  .filter((d): d is NonNullable<typeof d> => d !== null);
                if (allOtherConcepts.length === 0) continue;
                // ② と同じく cross-update 入力は本文込みで重いので関連度上位 30 件に絞る
                const ORPHAN_CROSS_UPDATE_CAP = 30;
                const orphanQueryEmbedding = await getDocEmbedding(wikiId).catch(() => null);
                const orphanQueryText = `${doc.title}\n${detail.sectionPreviews.join("\n")}`;
                const orphanCandidateFeatures = await Promise.all(
                  allOtherConcepts.map(async (d) => ({
                    detail: d,
                    embedding: await getDocEmbedding(d.id).catch(() => null),
                    similarityText: `${d.title}\n${d.sectionPreviews.join("\n")}`,
                  })),
                );
                const otherConcepts = rankCandidatesByRelevance(
                  { embedding: orphanQueryEmbedding, similarityText: orphanQueryText },
                  orphanCandidateFeatures,
                  ORPHAN_CROSS_UPDATE_CAP,
                ).map((f) => f.detail);
                const orphanSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), getLocale());
                const crossResult = await fetchCrossUpdateProposals({
                  newNoteTitle: doc.title,
                  newNoteContent: detail.sectionPreviews.join("\n"),
                  newWikiTitles: [doc.title],
                  existingWikis: otherConcepts,
                  language: getLocale(),
                  ...(orphanSkills.length > 0 ? { skills: orphanSkills } : {}),
                });
                for (const proposal of crossResult.proposals) {
                  const targetDoc = fm.getCachedDoc(`wiki:${proposal.targetWikiId}`);
                  if (!targetDoc) continue;
                  const updated = await applyCrossUpdate(targetDoc, proposal, wikiId, null, buildNoteIndex(fm.noteIndex), orphanSkills, getLocale());
                  await fm.handleSaveWikiFile(proposal.targetWikiId, updated, {
                    activityType: "wiki_cross_update",
                    sources: [wikiId],
                  });
                  wikiLog.append("cross-update", [proposal.targetWikiId, wikiId],
                    `Auto-fix orphan: linked "${doc.title}" → "${proposal.targetWikiTitle}"`).catch(() => {});
                }
              } catch { /* orphan 修正失敗は無視 */ }
            }
          }

          // gap はトーストで通知（次回 Ingest の参考に）
          const gaps = issues.filter((i) => i.type === "gap");
          if (gaps.length > 0) {
            setIngestToast((prev) => ({
              items: [
                ...(prev?.items ?? []),
                ...gaps.map((g) => ({
                  id: `lint:${crypto.randomUUID()}`,
                  status: "success" as const,
                  noteTitle: `💡 ${g.title}`,
                  result: g.suggestion,
                })),
              ],
            }));
          }

          // redundant: 重複 Concept を自動マージ（知識を統合、削除はしない）
          const redundants = issues.filter((i) => i.type === "redundant");
          for (const redundant of redundants) {
            if (redundant.affectedWikiIds.length < 2) continue;
            const [keepId, mergeId] = redundant.affectedWikiIds;
            try {
              const keepDoc = fm.getCachedDoc(`wiki:${keepId}`);
              const mergeDoc = fm.getCachedDoc(`wiki:${mergeId}`);
              if (!keepDoc || !mergeDoc) continue;

              // mergeDoc のセクションを抽出して keepDoc に rewrite で統合
              const mergeDetail = extractWikiDetail(mergeId, mergeDoc);
              if (!mergeDetail) continue;

              // mergeDoc の全セクション内容を IngesterOutput 形式に変換
              const mergeSections = mergeDetail.sectionHeadings.map((h, i) => ({
                heading: h,
                content: mergeDetail.sectionPreviews[i] ?? "",
              })).filter((s) => s.content);

              if (mergeSections.length > 0) {
                const mergeSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), getLocale());
                const mergedResult = await rewriteAndMerge(
                  keepDoc,
                  {
                    kind: "claim",
                    title: keepDoc.title,
                    sections: mergeSections,
                    suggestedAction: "merge" as const,
                    mergeTargetId: keepId,
                    confidence: 0.9,
                    relatedClaims: [],
                    externalReferences: [],
                  },
                  mergeDoc.wikiMeta?.derivedFromNotes[0] ?? "",
                  null,
                  getLocale(),
                  buildNoteIndex(fm.noteIndex),
                  mergeSkills,
                );

                // 統合先に mergeDoc の derivedFromNotes も追加
                if (mergedResult.wikiMeta) {
                  mergedResult.wikiMeta.derivedFromNotes = [
                    ...new Set([
                      ...(mergedResult.wikiMeta.derivedFromNotes ?? []),
                      ...(mergeDoc.wikiMeta?.derivedFromNotes ?? []),
                    ]),
                  ];
                }

                await fm.handleSaveWikiFile(keepId, mergedResult, {
                  activityType: "wiki_dedup_merge",
                  sources: [mergeId],
                });
                embedWikiSections(keepId, mergedResult).catch(() => {});

                // 統合元をアーカイブ（参照保護のため物理削除しない）
                // ファイル本体は残し、一覧・検索からのみ除外する。
                // 引用や regenerate からは引き続き解決できるので、
                // derivedFromNotes に旧 ID が残っていても壊れない。
                await fm.handleArchiveWikiFile(mergeId);

                wikiLog.append("merge", [keepId, mergeId],
                  `Auto-merge redundant: "${mergeDoc.title}" → "${keepDoc.title}"`).catch(() => {});

                setIngestToast((prev) => ({
                  items: [
                    ...(prev?.items ?? []),
                    {
                      id: `merge:${crypto.randomUUID()}`,
                      status: "success" as const,
                      noteTitle: `\ud83d\udd04 Merged "${mergeDoc.title}" into "${keepDoc.title}"`,
                      result: redundant.suggestion,
                    },
                  ],
                }));
              }
            } catch {
              // マージ失敗は無視（トースト通知はそのまま残る）
            }
          }

          // stale はログに記録
          const stale = issues.filter((i) => i.type === "stale");
          if (stale.length > 0) {
            wikiLog.append("lint", stale.flatMap((i) => i.affectedWikiIds),
              `Stale pages: ${stale.map((i) => `"${i.title}"`).join(", ")}`).catch(() => {});
          }

          // 全体のログ
          if (useLlm) {
            wikiLog.append("lint", [], `LLM health check: ${issues.length} issue(s) found`).catch(() => {});
          }
        }
        updateStage(
          "lint",
          "done",
          issues.length > 0 ? `${issues.length} issues` : tStatic("ingest.noIssues"),
        );
      }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        updateStage("lint", "skipped", tStatic("ingest.aborted"));
      } else {
        // Lint 失敗は ingest 全体には影響させない
        console.error("Lint failed:", err);
        updateStage("lint", "error", localizeAiError(err));
      }
    }

    ingestAbortRef.current = null;
    ingestRunningRef.current = false;
  }, [fm, capture.handleRecordKnowledged]);

  const enqueueIngest = useCallback((noteId: string, noteTitle: string, doc: import("./lib/document-types").GraphiumDocument) => {
    // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）。
    // ノート / メモ / 一括 Knowledge 化のすべてがここを通るチョークポイント。
    if (!ensureAgentConfigured()) return;
    if (ingestQueueRef.current.some((j) => j.noteId === noteId)) return;
    const newItem: IngestToastItem = { id: noteId, status: "queued", noteTitle };
    ingestQueueRef.current.push({ noteId, noteTitle, doc });
    setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
    processIngestQueue();
  }, [processIngestQueue]);

  // カード選択時のハンドラ:
  // - "ingest-current-note" は現ノートを直接 enqueueIngest して composer を閉じる（プロンプトには流さない）
  // - それ以外は対応するプロンプト文を textarea に流し込む（自動送信はしない）
  const handleComposerCardSelect = useCallback((card: DiscoveryCard) => {
    if (card.action.kind === "custom" && card.action.key === "ingest-current-note") {
      if (fm.activeFileId && fm.activeDoc && fm.activeDoc.source !== "ai") {
        enqueueIngest(fm.activeFileId, fm.activeDoc.title, fm.activeDoc);
      }
      composer.closeComposer();
      return;
    }
    setComposerPrompt(promptForDiscoveryCard(card));
  }, [enqueueIngest, fm.activeFileId, fm.activeDoc, composer]);

  // ノートのタイトルを Retriever に渡す（横断検索で注入するノート本文の断片の引用表示用。
  // 語彙索引の title が空のときの補完）
  useEffect(() => {
    const map = new Map<string, string>();
    for (const n of fm.noteIndex?.notes ?? []) if (n.title) map.set(n.noteId, n.title);
    setNoteTitleMap(map);
  }, [fm.noteIndex]);

  // 構造化インデックスを Retriever に注入（Wiki メタ変更時に更新）
  useEffect(() => {
    if (fm.wikiFiles.length > 0 && fm.wikiMetas.size > 0) {
      const entries = buildWikiIndex(fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc);
      const text = formatWikiIndexForLLM(entries);
      setWikiIndexForRetriever(text);
      // タイトルマップを Retriever に設定（引用用）
      const titleMap = new Map<string, string>();
      for (const wf of fm.wikiFiles) {
        const doc = fm.getCachedDoc(`wiki:${wf.id}`);
        if (doc) titleMap.set(wf.id, doc.title);
      }
      setWikiTitleMap(titleMap);
    } else {
      setWikiIndexForRetriever("");
      setWikiTitleMap(new Map());
    }
  }, [fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc]);

  // 定期 Lint: アプリ起動時に前回 Lint から 24h 以上経過していれば自動実行
  const startupLintDoneRef = useRef(false);
  useEffect(() => {
    if (startupLintDoneRef.current) return;
    if (fm.wikiFiles.length < 2) return;

    startupLintDoneRef.current = true;

    (async () => {
      try {
        const lastLint = await wikiLog.getLastTimestamp("lint");
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        if (lastLint && Date.now() - new Date(lastLint).getTime() < TWENTY_FOUR_HOURS) {
          return; // 24h 未満 → スキップ
        }

        const snapshots = buildWikiSnapshots(fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc);
        if (snapshots.length < 2) return;

        // LLM Lint は 5 ページ以上かつ前回から 24h 以上のときのみ
        const useLlm = snapshots.length >= 5;
        const report = await lintWikis(snapshots, getLocale(), !useLlm);

        if (report.issues.length > 0) {
          // contradiction / gap はトースト通知のみ
          const notifyOnly = report.issues.filter((i) =>
            i.type === "contradiction" || i.type === "gap",
          );
          if (notifyOnly.length > 0) {
            const iconMap: Record<string, string> = {
              contradiction: "\u26a0",
              gap: "\ud83d\udca1",
            };
            setIngestToast((prev) => ({
              items: [
                ...(prev?.items ?? []),
                ...notifyOnly.slice(0, 3).map((issue) => ({
                  id: `auto-lint:${crypto.randomUUID()}`,
                  status: (issue.type === "contradiction" ? "error" : "success") as "error" | "success",
                  noteTitle: `${iconMap[issue.type] ?? "\u26a0"} ${issue.title}`,
                  result: issue.suggestion,
                })),
              ],
            }));
          }

          // redundant: 自動マージ
          const redundants = report.issues.filter((i) => i.type === "redundant");
          for (const redundant of redundants) {
            if (redundant.affectedWikiIds.length < 2) continue;
            const [keepId, mergeId] = redundant.affectedWikiIds;
            try {
              const keepDoc = fm.getCachedDoc(`wiki:${keepId}`);
              const mergeDoc = fm.getCachedDoc(`wiki:${mergeId}`);
              if (!keepDoc || !mergeDoc) continue;

              const mergeDetail = extractWikiDetail(mergeId, mergeDoc);
              if (!mergeDetail) continue;

              const mergeSections = mergeDetail.sectionHeadings.map((h, i) => ({
                heading: h,
                content: mergeDetail.sectionPreviews[i] ?? "",
              })).filter((s) => s.content);

              if (mergeSections.length > 0) {
                const mergeSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), getLocale());
                const mergedResult = await rewriteAndMerge(
                  keepDoc,
                  {
                    kind: "claim",
                    title: keepDoc.title,
                    sections: mergeSections,
                    suggestedAction: "merge" as const,
                    mergeTargetId: keepId,
                    confidence: 0.9,
                    relatedClaims: [],
                    externalReferences: [],
                  },
                  mergeDoc.wikiMeta?.derivedFromNotes[0] ?? "",
                  null,
                  getLocale(),
                  buildNoteIndex(fm.noteIndex),
                  mergeSkills,
                );

                if (mergedResult.wikiMeta) {
                  mergedResult.wikiMeta.derivedFromNotes = [
                    ...new Set([
                      ...(mergedResult.wikiMeta.derivedFromNotes ?? []),
                      ...(mergeDoc.wikiMeta?.derivedFromNotes ?? []),
                    ]),
                  ];
                }

                await fm.handleSaveWikiFile(keepId, mergedResult, {
                  activityType: "wiki_dedup_merge",
                  sources: [mergeId],
                });
                embedWikiSections(keepId, mergedResult).catch(() => {});
                // 統合元をアーカイブ（参照保護のため物理削除しない）
                await fm.handleArchiveWikiFile(mergeId);

                wikiLog.append("merge", [keepId, mergeId],
                  `Startup auto-merge: "${mergeDoc.title}" → "${keepDoc.title}"`).catch(() => {});

                setIngestToast((prev) => ({
                  items: [
                    ...(prev?.items ?? []),
                    {
                      id: `merge:${crypto.randomUUID()}`,
                      status: "success" as const,
                      noteTitle: `\ud83d\udd04 Merged "${mergeDoc.title}" into "${keepDoc.title}"`,
                      result: redundant.suggestion,
                    },
                  ],
                }));
              }
            } catch {
              // マージ失敗は無視
            }
          }
        }

        wikiLog.append("lint", [], `Startup auto-lint: ${report.issues.length} issue(s)`).catch(() => {});
      } catch {
        // 起動時 Lint 失敗は静かに無視
      }
    })();
  }, [fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc]);

  const t = useT();

  // 文脈候補（タグ）を全ノートから削除する。ピッカーのゴミ箱から呼ばれる。
  // 使用中の件数を数え、1 件以上なら確認ダイアログを出す。実際に削除したら true を返す
  // （ピッカー側がセッション表示から即座に消すのに使う）。
  const handleDeleteContextEverywhere = async (value: string): Promise<boolean> => {
    const key = value.trim().toLowerCase();
    const count = (fm.noteIndex?.notes ?? []).filter((n) =>
      (n.noteContexts ?? []).some((c) => c.trim().toLowerCase() === key),
    ).length;
    if (count >= 1 && !window.confirm(t("nav.deleteContextConfirm", { value, count: String(count) }))) {
      return false;
    }
    await fm.deleteNoteContextEverywhere(value);
    return true;
  };

  // エディタ参照（メディアリネーム時のブロック同期用）
  const noteEditorRef = useRef<any>(null);

  // ── モバイル受信箱: 接続と取り込み ────────────────────────────────
  // 同期フォルダ（<root>/Inbox/ の親）を選ぶ。選択したら localStorage に永続化し、
  // setInboxRoot の CustomEvent 経由で useInboxConfig が更新される → inboxSource が
  // 差し替わり、受信箱が即座に再スキャンされる（設定モーダル側の表示も同時に追従）。
  // desktop 専用（Tauri）。
  const handlePickInboxRoot = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      const picked = await pickInboxRoot(getInboxRoot() ?? undefined);
      if (picked) setInboxRoot(picked);
      return picked;
    } catch (e) {
      console.error("[inbox] folder pick failed", e);
      return null;
    }
  }, []);

  // 受信箱の未取り込みメディアを active MediaProvider に取り込む。
  // refs を渡すと選択取り込み、省略すると全部取り込み（受信箱ビューの 2 ボタンに対応）。
  // 取り込んだものは既定で Inbox から削除（keep-archive 設定時は _imported/ へ退避）
  // されるので、再スキャンで一覧から消える。
  //
  // dedup は 2 段構え:
  //   - run 間: media-index の capture.checksum 集合をスナップショットとして seed する
  //   - run 内: 同じ Set を「これから取り込む checksum」で成長させ、同一 run 内の
  //             同一内容の二重取込を弾く（importer が isAlreadyImported を各件呼ぶ直前に判定）
  // importer は success を個別通知しないため、「未取り込み → これから取り込む」の
  // タイミング（isAlreadyImported が false を返す瞬間）で Set に add する。
  const handleImportFromInbox = useCallback(async (refs?: CaptureRef[]) => {
    if (!isTauri()) return;
    // root 未設定ならフォルダ選択を促す。選ばれなければ何もしない。
    let root = getInboxRoot();
    if (!root) {
      root = await handlePickInboxRoot();
      if (!root) return;
    }
    // dedup 用チェックサム集合（run 間スナップショット + run 内成長）。
    const seen = new Set<string>();
    for (const m of fm.mediaIndex?.media ?? []) {
      if (m.capture?.checksum) seen.add(m.capture.checksum);
    }
    const isAlreadyImported = (checksum: string): boolean => {
      if (seen.has(checksum)) return true;
      // 未取り込み → importer はこの直後に取り込む。後続の同一内容を二重取込しないよう記録する。
      seen.add(checksum);
      return false;
    };
    const pushResultToast = (
      status: "success" | "error",
      result: string,
    ) => {
      // ingestToast を流用（AI ガードと同じ単一アイテム置換パターン。固定 id で連続実行でも 1 件）。
      setIngestToast((prev) => ({
        items: [
          ...(prev?.items ?? []).filter((i) => i.id !== "inbox-import"),
          { id: "inbox-import", status, noteTitle: tStatic("mobile.importResult"), result },
        ],
      }));
    };
    try {
      const res = await runInboxImport({
        transport: new FolderInbox(root),
        uploadAsset: fm.handleUploadAsset,
        isAlreadyImported,
        // 取り込み成功後の Inbox 側ファイルの後処理。既定は削除（中身は vault に
        // 着地済みなので冗長コピーを同期フォルダ = クラウドに残さない）。
        // 受信箱のフォルダ設定トグルで「処理済みを _imported/ に残す」を選んだ人だけ
        // アーカイブ。実行時に localStorage を直接読む（表示 state の鮮度に依存しない）。
        disposal: getInboxKeepArchive() ? "archive" : "delete",
        // 未指定なら全件（「全部取り込み」）。
        ...(refs ? { only: refs } : {}),
        // メモ / URL のネイティブ捕獲（.graphium.json）を本物の実体に振り分ける。
        // importer は着地先を知らない（依存注入）— ここが唯一の配線点。
        handlers: {
          // メモ → デスクトップのメモ（capture-store）。書いた時刻を createdAt に引き継ぐ。
          // 保存失敗は handleImportCapture が throw → importer が failed に数え、
          // Inbox に残る（再試行可能）。
          memo: async (payload) => {
            const id = await capture.handleImportCapture(payload.text, payload.createdAt);
            return { fileId: id };
          },
          // URL → URL ブックマーク素材（media-index の url エントリ）。メタは
          // モバイル側で取得済みのものをそのまま使い、デスクトップでは再取得しない。
          // handleAddUrlBookmark が URL 重複を吸収（既存ならエントリを増やさない）。
          // capture: meta を付けて出自と checksum を残す（run 間の冪等 dedup が
          // media-index の checksum 集合で効くようになる）。
          url: async (payload, { meta }) => {
            const domain = extractDomain(payload.url);
            const fileId = generateUrlBookmarkId();
            fm.handleAddUrlBookmark({
              fileId,
              name: payload.title?.trim() || domain,
              type: "url",
              mimeType: "text/x-uri",
              url: payload.url,
              thumbnailUrl: getFaviconUrl(domain),
              uploadedAt: payload.createdAt,
              usedIn: [],
              urlMeta: {
                domain,
                ...(payload.description ? { description: payload.description } : {}),
                ...(payload.ogImage ? { ogImage: payload.ogImage } : {}),
              },
              capture: meta,
            });
            return { fileId };
          },
        },
      });
      await fm.refreshMediaIndex();
      const failed = res.failed.length;
      pushResultToast(
        failed > 0 ? "error" : "success",
        tStatic("mobile.importSummary", {
          imported: String(res.imported.length),
          skipped: String(res.skipped.length),
          failed: String(failed),
        }),
      );
    } catch (e) {
      console.error("[inbox] import failed", e);
      pushResultToast("error", e instanceof Error ? e.message : String(e));
    }
  }, [fm.mediaIndex, fm.handleUploadAsset, fm.handleAddUrlBookmark, fm.refreshMediaIndex, capture.handleImportCapture, handlePickInboxRoot]);

  // メディアリネーム（ブロック props.name 同期付き）
  const handleRenameMediaWithBlockSync = useCallback(async (entry: MediaIndexEntry, newName: string) => {
    await fm.handleRenameMedia(entry, newName);
    // エディタ内で同じ URL を参照しているブロックの props.name も更新
    const editor = noteEditorRef.current;
    if (!editor) return;
    const blockIds = findBlockIdsByMediaUrl(editor.document, entry.url);
    for (const blockId of blockIds) {
      editor.updateBlock(blockId, { props: { name: newName } });
    }
  }, [fm.handleRenameMedia]);

  // Word (.docx) 素材から埋め込み画像を取り出して子素材として登録する。
  // PDF の onExtractPdfPages と機能対称。ノートは作らない（素材として置くだけ）。
  const handleExtractDocxImages = useCallback(
    async (
      entry: MediaIndexEntry,
      onProgress: (done: number, total: number) => void,
    ): Promise<{ extracted: number }> => {
      const provider = getActiveProvider();
      const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
      const blobUrl = await provider.getMediaBlobUrl(fileId);
      const res = await fetch(blobUrl);
      const arrayBuffer = await res.arrayBuffer();

      const { extractDocxImages } = await import("./features/docx-import/extract-images");
      const baseTitle = entry.name.replace(/\.(docx|doc)$/i, "") || "Word";
      const { files, stats } = await extractDocxImages(arrayBuffer, baseTitle);

      if (files.length === 0) {
        if (stats.attempted === 0) {
          throw new Error(tStatic("asset.docxNoImages"));
        }
        throw new Error(tStatic("asset.docxUnsupportedImages"));
      }

      // 再抽出で重複を増やさない: この docx 由来（derivedFromAssets）の既存抽出
      // 画像のうち、ノートで未使用のものは置き換え対象として削除する。
      // 使用中（usedIn あり）はリンク切れ防止のため残す（soft-delete と同じ思想）。
      // 新しい抽出が成功（files > 0）してから消すことで、失敗時に旧画像まで
      // 失う事故を避けている。
      const prevDerived = (fm.mediaIndex?.media ?? []).filter(
        (m) => m.type === "image" && m.derivedFromAssets?.includes(entry.fileId),
      );
      let replaced = 0;
      let keptInUse = 0;
      for (const old of prevDerived) {
        if ((old.usedIn?.length ?? 0) > 0) {
          keptInUse++;
          continue;
        }
        try {
          await fm.handleDeleteMedia(old);
          replaced++;
        } catch (err) {
          console.warn("[note-app] 旧抽出画像の削除失敗:", err);
        }
      }
      if (replaced > 0 || keptInUse > 0) {
        console.info(
          `[note-app] Word 再抽出: 旧画像 ${replaced} 件を置き換え、使用中 ${keptInUse} 件は保持`,
        );
      }

      let extracted = 0;
      for (let i = 0; i < files.length; i++) {
        onProgress(i, files.length);
        try {
          await fm.handleUploadMedia(files[i], { derivedFromAssets: [entry.fileId] });
          extracted++;
        } catch (err) {
          console.error("[note-app] Word 画像登録失敗:", err);
        }
      }
      onProgress(files.length, files.length);
      return { extracted };
    },
    [fm],
  );

  // Wiki 単体の再生成（WikiBanner / Settings の Maintenance タブ両方から呼ばれる）
  // openAfter=true で再生成後にエディタで開く（バナー経由のとき）
  // ⚠️ 早期 return より前に置くこと（Rules of Hooks）
  const regenerateWikiById = useCallback(async (
    wikiId: string,
    options?: { model?: string; openAfter?: boolean; signal?: AbortSignal },
  ): Promise<{ ok: boolean; error?: string; aborted?: boolean }> => {
    // AI 未設定なら発火させない（WikiBanner / 一覧 / Maintenance すべてここを通る）
    if (!ensureAgentConfigured()) {
      return { ok: false, error: tStatic("settings.aiNotConfigured") };
    }
    const fileId = `wiki:${wikiId}`;
    const doc = fm.getCachedDoc(fileId) ?? (await fm.loadDoc(fileId)) ?? null;
    if (!doc || !doc.wikiMeta) {
      return { ok: false, error: "Wiki not found" };
    }

    const wikiTitle = doc.title;
    const selectedModel = options?.model || undefined;
    const openAfter = options?.openAfter ?? false;
    const toastId = `regen:${wikiId}`;
    const wikiKind = doc.wikiMeta.kind;
    const isSynthesis = wikiKind === "synthesis";
    const isAtom = wikiKind === "atom";

    setIngestToast((prev) => ({
      items: [
        ...(prev?.items ?? []),
        { id: toastId, status: "generating" as const, noteTitle: `Regenerating "${wikiTitle}"`, detail: selectedModel ? `Model: ${selectedModel}` : undefined },
      ],
    }));

    try {
      if (isAtom) {
        // Atom (Insight) は ingest パイプラインの出力に含まれないため、専用の
        // atomize 経由で再生成する。derivedFromClaims に記録された上流 Concept を
        // ClaimSnapshot に詰めて atomizer に投げ、新しい構造抽象を採用する
        // （decompose→shape→abstract→transfer の re-lift）。旧タイトルには寄せない。
        const claimIds = doc.wikiMeta.derivedFromClaims ?? [];
        const snapshots: ClaimSnapshot[] = [];
        for (const cId of claimIds) {
          const cDoc = await fm.loadDoc(`wiki:${cId}`);
          if (!cDoc) continue;
          const cMeta = fm.wikiMetas.get(cId);
          // Atom の上流は Claim 前提（atomizer は Concept[] を期待）。
          // kind が消失していたり別 kind に変身している場合はスキップ。
          if (!cMeta || cMeta.kind !== "claim") continue;
          snapshots.push({
            id: cId,
            title: cDoc.title,
            bodyPreview: extractBodyPreview(cDoc, 240),
            level: cMeta.level,
            relatedClaims: [],
            sourceSummaryPreviews: [],
            atomType: undefined,
          });
        }

        // 2 件必須ゲートは撤廃（サーバー側の可搬性テストと整合）。source Claim が
        // 1 件でも可搬なら再生成できる。0 件のときだけ再生成不能としてエラーにする。
        if (snapshots.length < 1) {
          const totalSources = claimIds.length;
          const errMsg =
            totalSources === 0
              ? "Atom has no source Concepts recorded"
              : `Atom's ${totalSources} source Concept(s) no longer exist as Claims`;
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }

        const atomResult = await atomizeConcepts(snapshots, getLocale(), {
          // 自己重複（この Atom 自身）を Existing 扱いで抑止しないため existingAtomTitles は空で渡す。
          // re-lift では旧タイトルと別の抽象になってよい。
          model: selectedModel ?? getChatSynthesisModelName() ?? undefined,
          ...(options?.signal ? { signal: options.signal } : {}),
        });
        // 旧タイトル一致で選ぶと元のドメイン語 Atom を再現してしまい re-lift にならない。
        // 同じ source Claim から作り直した新しい構造抽象の主候補をそのまま採用する。
        const regenAtom = atomResult.atoms[0] ?? null;
        if (!regenAtom) {
          const errMsg = "No atom candidate generated";
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }

        const newDoc = buildAtomDocument(regenAtom, atomResult.model ?? null, getLocale());
        // 既存 Atom が持っていた derivedFromClaims を温存する
        // （atomizer 提案の derivedFromClaims はその回の入力に依存し、
        //  ユーザーが手動で集めたソース集合とは限らない）
        const rewritten: GraphiumDocument = {
          ...newDoc,
          // buildAtomDocument は素の新規 doc を返すため、ここで引き継がないと
          // それまでの成長履歴（ingest/merge/cross-update のリビジョン連鎖）が
          // 再生成 1 回で全消去される。recordRevision は既存チェーンに追記する。
          documentProvenance: doc.documentProvenance,
          createdAt: doc.createdAt ?? newDoc.createdAt,
          modifiedAt: new Date().toISOString(),
          wikiMeta: {
            ...newDoc.wikiMeta!,
            derivedFromClaims: doc.wikiMeta?.derivedFromClaims ?? newDoc.wikiMeta!.derivedFromClaims,
            generatedBy: {
              model: atomResult.model ?? selectedModel ?? "unknown",
              version: "1.0.0",
            },
          },
        };
        await fm.handleSaveWikiFile(wikiId, rewritten, {
          activityType: "wiki_regenerate",
          agentLabel: atomResult.model ?? selectedModel ?? undefined,
          // 実際に再生成へ投入できた Claim だけを used に残す
          sources: snapshots.map((s) => s.id),
        });
        embedWikiSections(wikiId, rewritten).catch(() => {});
        if (openAfter) fm.handleOpenWikiFile(wikiId);
        const modelLabel = atomResult.model ?? selectedModel ?? "default";
        wikiLog.append("regenerate", [wikiId], `Regenerated atom "${wikiTitle}" with ${modelLabel} from ${snapshots.length} source(s)`).catch(() => {});

        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === toastId ? { ...i, status: "success" as const, detail: undefined, result: modelLabel } : i
          ),
        }));
        return { ok: true };
      } else if (isSynthesis) {
        // Synthesis 自動生成パイプラインは撤退（2026-05-27、design revision）。
        // 既存 synthesis ファイルは閲覧・編集できるが regenerate は不可。
        // 将来 Cmd-K Composer 経由で synthesize 体験を再構築する想定。
        const errMsg = "Synthesis regeneration is no longer supported (auto-generation pipeline removed)";
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
          ),
        }));
        return { ok: false, error: errMsg };
      } else {
        // マルチソース regenerate:
        // derivedFromNotes に含まれる note / pdf: / url: prefix のソースをすべて
        // 解決してテキスト化し、1 度の ingest で synthesis し直す。
        // 単一ソースで再生成すると merge ingest で育った内容が消えてしまうため。
        const sourceNoteIds = doc.wikiMeta.derivedFromNotes ?? [];
        const parts: MultiSourcePart[] = [];
        const skipped: string[] = [];

        for (const rawId of sourceNoteIds) {
          // 自己参照（過去の regenerate 不具合で wiki 自身の ID が混入することがある）はスキップ
          if (rawId === wikiId) continue;

          if (rawId.startsWith("pdf:")) {
            const fileId = rawId.slice("pdf:".length);
            try {
              const provider = getActiveProvider();
              const blobUrl = await provider.getMediaBlobUrl(fileId);
              const blob = await (await fetch(blobUrl)).blob();
              const { extractPdfText } = await import("./features/wiki/pdf-text-extractor");
              const extracted = await extractPdfText(blob);
              if (extracted.text && extracted.text.length >= 50) {
                const mediaEntry = fm.mediaIndex?.media?.find((e) => e.fileId === fileId);
                const pdfTitle = extracted.title || mediaEntry?.name || `PDF ${fileId.slice(0, 8)}`;
                parts.push({ sourceNoteId: rawId, kind: "pdf", title: pdfTitle, text: extracted.text });
              } else {
                skipped.push(rawId);
              }
            } catch (e) {
              console.warn("PDF source skipped during regenerate:", rawId, e);
              skipped.push(rawId);
            }
            continue;
          }

          if (rawId.startsWith("url:")) {
            const url = rawId.slice("url:".length);
            try {
              const fetchRes = await fetch(`${apiBase()}/wiki/fetch-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
              });
              if (fetchRes.ok) {
                const urlData = (await fetchRes.json()) as { title: string; description?: string; text: string };
                const text = [urlData.description ? `> ${urlData.description}` : "", urlData.text].filter(Boolean).join("\n\n");
                if (text.length >= 50) {
                  parts.push({ sourceNoteId: rawId, kind: "url", title: urlData.title || url, text });
                } else {
                  skipped.push(rawId);
                }
              } else {
                skipped.push(rawId);
              }
            } catch (e) {
              console.warn("URL source skipped during regenerate:", rawId, e);
              skipped.push(rawId);
            }
            continue;
          }

          if (rawId.startsWith("memo:")) {
            // メモ由来: capture store から本文を再取得する。
            // メモは短い断片が普通なので pdf/url のような最小長ゲートは設けない
            // （通常ノートと同じ trim 非空のみ）。メモが削除済みなら skip。
            const capId = rawId.slice("memo:".length);
            const capEntry = capture.captureIndex?.captures?.find((c) => c.id === capId);
            const capText = capEntry?.text?.trim();
            if (capText) {
              const firstLine = capText.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
              parts.push({ sourceNoteId: rawId, kind: "memo", title: firstLine.slice(0, 40) || "Memo", text: capText });
            } else {
              skipped.push(rawId);
            }
            continue;
          }

          // 通常ノート
          const sDoc = await fm.loadDoc(rawId);
          if (sDoc) {
            const text = extractPlainTextFromDoc(sDoc);
            if (text.trim().length > 0) {
              parts.push({ sourceNoteId: rawId, kind: "note", title: sDoc.title, text });
            } else {
              skipped.push(rawId);
            }
          } else {
            skipped.push(rawId);
          }
        }

        if (parts.length === 0) {
          // 1 件も解決できないときは、Wiki 自身の本文をソースにフォールバック
          // （旧挙動互換。derivedFromNotes 全滅は通常はあり得ないが防御的に）
          const selfText = extractPlainTextFromDoc(doc);
          if (selfText.trim().length > 0) {
            parts.push({ sourceNoteId: wikiId, kind: "note", title: wikiTitle, text: selfText });
          } else {
            setIngestToast((prev) => ({
              items: (prev?.items ?? []).map((i) =>
                i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: "No source available" } : i
              ),
            }));
            return { ok: false, error: "No source available" };
          }
        }

        const regenIngestSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), getLocale());
        const result = await ingestFromMultiSource(
          parts,
          wikiTitle,
          wikiId,
          [],
          getLocale(),
          selectedModel,
          regenIngestSkills,
        );

        // 既存 Wiki と同じ kind の出力のみ採用する。
        // 旧実装は同 kind が無いとき `result.wikis[0]` にフォールバックしていたが、
        // これは Atom (Insight) を Claim/Summary に変身させて一覧から消す事故を起こした。
        // ingest パイプラインは Atom/Synthesis を出さない設計なので、kind 不一致は
        // 「このパスでは再生成できない」と扱い、保存せずエラートーストで終了する。
        const targetKind = doc.wikiMeta?.kind ?? "claim";
        const matched =
          result.wikis.find((w) => w.kind === targetKind && w.title === wikiTitle) ??
          result.wikis.find((w) => w.kind === targetKind) ??
          null;

        if (matched) {
          const newDoc = buildWikiDocument(
            matched,
            // sourceNoteTitle 表示用に primary を 1 件渡す。実際の derivedFromNotes は
            // 後段で「元の wiki が持っていた配列」をそのまま引き継ぐ。
            parts[0].sourceNoteId,
            result.model,
            parts[0].title,
            undefined,
            getLocale(),
            buildNoteIndex(fm.noteIndex),
          );
          // derivedFromNotes は **元の配列をそのまま保持** する。
          // 自己参照（wikiId）と取得失敗ソースだけ落として保存する設計。
          const preservedDerivedFromNotes = (doc.wikiMeta?.derivedFromNotes ?? []).filter(
            (id) => id !== wikiId,
          );
          const rewritten: GraphiumDocument = {
            ...newDoc,
            // buildWikiDocument は素の新規 doc を返すため、ここで引き継がないと
            // それまでの成長履歴（リビジョン連鎖・hash chain）が全消去される。
            documentProvenance: doc.documentProvenance,
            createdAt: doc.createdAt ?? newDoc.createdAt,
            modifiedAt: new Date().toISOString(),
            wikiMeta: {
              ...newDoc.wikiMeta!,
              derivedFromNotes: preservedDerivedFromNotes,
              derivedFromChats: doc.wikiMeta?.derivedFromChats ?? [],
              generatedBy: {
                model: result.model ?? selectedModel ?? "unknown",
                version: "1.0.0",
              },
            },
          };
          await fm.handleSaveWikiFile(wikiId, rewritten, {
            activityType: "wiki_regenerate",
            agentLabel: result.model ?? selectedModel ?? undefined,
            // 解決に成功して実際に投入したソースだけを used に残す
            sources: parts.map((p) => p.sourceNoteId),
          });
          embedWikiSections(wikiId, rewritten).catch(() => {});
          if (openAfter) fm.handleOpenWikiFile(wikiId);
          const modelLabel = result.model ?? selectedModel ?? "default";
          const sourceSummary =
            skipped.length > 0
              ? `${parts.length} sources (${skipped.length} skipped)`
              : `${parts.length} sources`;
          wikiLog.append("regenerate", [wikiId], `Regenerated "${wikiTitle}" with ${modelLabel} from ${sourceSummary}`).catch(() => {});

          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId
                ? { ...i, status: "success" as const, detail: undefined, result: `${modelLabel} · ${sourceSummary}` }
                : i
            ),
          }));
          return { ok: true };
        } else {
          // result.wikis が空、または targetKind と一致する出力が無かった。
          // 後者は Atom (Insight) のように ingest パイプラインが扱わない kind で起きる。
          const errMsg =
            result.wikis.length === 0
              ? "No content generated"
              : `Regenerate not supported for ${targetKind} via this path (ingest returned ${result.wikis.map((w) => w.kind).join(", ")})`;
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }
      }
    } catch (err) {
      if (isAbortError(err) || options?.signal?.aborted) {
        // ユーザーの中断。失敗ではないのでエラー表示にしない。
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === toastId ? { ...i, status: "aborted" as const, detail: undefined, result: tStatic("ingest.aborted") } : i
          ),
        }));
        return { ok: false, aborted: true };
      }
      console.error("Wiki の再生成に失敗:", err);
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: localizeAiError(err) } : i
        ),
      }));
      return { ok: false, error: localizeAiError(err) };
    }
  }, [fm, capture.captureIndex]);

  // 全 Concept を見渡して共通抽象（Atom）を発見する discovery 呼び出し（auto-loop 付き）。
  // - Maintenance タブの「Atom を発見」ボタンから呼ばれる。
  // - 1 回の LLM 呼び出しで上限 5 件しか出ないため、収束（0 件返却）まで内部でループする。
  // - 無限ループ防止に MAX_ITERATIONS の hard cap を置く（必ず終了する保証）。
  // - 各イテレーション後に既存 Atom タイトルを更新して LLM に渡し、重複提案を抑制する。
  // - 自動 Atomize（ingest 後）はループせず 1 回だけ走る — 意図的に分離している。
  // ⚠️ 早期 return より前に置くこと（Rules of Hooks）
  const runAtomizeDiscovery = useCallback(async (
    onProgress?: (info: {
      iteration: number;
      createdSoFar: number;
      clusterLabel?: string;
      clusterTotal?: number;
      clusterSize?: number;
      clusterMemberTitles?: string[];
    }) => void,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean; created: number; iterations: number; error?: string; aborted?: boolean }> => {
    if (!isAtomLayerEnabled()) {
      return { ok: false, created: 0, iterations: 0, error: "Atom layer is disabled" };
    }
    // AI 未設定なら発火させない（Maintenance タブの「発見」ボタン経路）
    if (!ensureAgentConfigured()) {
      return { ok: false, created: 0, iterations: 0, error: tStatic("settings.aiNotConfigured") };
    }
    // Phase 1: クラスタ集中サンプリング（Synthesis Discovery と同じ手法）。
    // 母集団は modifiedTime 上限なしで全 Claim を取得し、farthest-point で
    // 散らした seed ごとに別領域のクラスタを atomizer に投げる。
    const allClaimSnapshots = buildClaimSnapshots(
      fm.wikiFiles,
      fm.wikiMetas,
      fm.getCachedDoc,
      "claim",
      Number.POSITIVE_INFINITY,
    );
    if (allClaimSnapshots.length < 2) {
      return { ok: false, created: 0, iterations: 0, error: "Need at least 2 Claims" };
    }

    const claimModifiedByFileId = new Map(fm.wikiFiles.map((f) => [f.id, f.modifiedTime]));
    const claimEmbeddings = await Promise.all(
      allClaimSnapshots.map((s) => getDocEmbedding(s.id).catch(() => null)),
    );
    const claimCandidates: AtomCandidate[] = allClaimSnapshots.map((s, i) => ({
      snapshot: s,
      similarityText: `${s.title}\n${s.bodyPreview}`,
      embedding: claimEmbeddings[i],
      modifiedTime: claimModifiedByFileId.get(s.id) ?? "",
    }));

    // クラスタ数（= seed 数 = LLM 呼び出し回数）は母集団から動的に決める。
    // 1 クラスタあたり effectiveCoverage ≈ 30 件のユニーク貢献を見込み、上限 10。
    const MAX_ITERATIONS = pickClusterCount(claimCandidates.length, {
      effectiveCoverage: 30,
      maxK: 10,
    });
    const seeds = pickFarthestSeeds(claimCandidates, MAX_ITERATIONS);
    const existingAtomTitles = [...fm.wikiMetas.entries()]
      .filter(([, m]) => m.kind === "atom")
      .map(([, m]) => m.title);

    const atomLabel = tStatic("settings.maintenance.kind.atom");
    const claimLabel = tStatic("settings.maintenance.kind.claim");
    const toastId = `atomize-discovery:${Date.now()}`;
    setIngestToast((prev) => ({
      items: [
        ...(prev?.items ?? []),
        { id: toastId, status: "generating" as const, noteTitle: `Discovering ${atomLabel} across ${allClaimSnapshots.length} ${claimLabel} (${seeds.length} clusters)` },
      ],
    }));

    let totalCreated = 0;
    let totalReinforced = 0;
    let lastIteration = 0;
    try {
      for (let iter = 1; iter <= seeds.length; iter++) {
        // キャンセルされたら次のクラスタへ進まない（作成済み分は残す）
        if (options?.signal?.aborted) break;
        lastIteration = iter;
        const seed = seeds[iter - 1];
        const cluster = buildClusterSlice(claimCandidates, seed, MAX_SNAPSHOTS_PER_RUN);
        const slice = cluster.map((c) => c.snapshot);
        onProgress?.({
          iteration: iter,
          createdSoFar: totalCreated,
          clusterLabel: seed.snapshot.title,
          clusterTotal: seeds.length,
          clusterSize: slice.length,
          clusterMemberTitles: slice.map((s) => s.title),
        });
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === toastId
              ? { ...i, noteTitle: `Discovering · cluster ${iter}/${seeds.length} 「${seed.snapshot.title}」 (${slice.length} ${claimLabel})` }
              : i
          ),
        }));
        const result = await atomizeConcepts(
          slice,
          getLocale(),
          { existingAtomTitles, model: getChatSynthesisModelName() || undefined, ...(options?.signal ? { signal: options.signal } : {}) },
        );
        // クラスタごとに独立して回すため、収束（候補なし）時も次のクラスタは試す。
        if (result.atoms.length === 0) continue;
        // 既存 Atom との embedding 類似度で「新規」と「重複」に分割（embedding 未設定なら全て新規扱い）。
        // 重複候補は捨てずに一致先 Atom への支持追加（reinforcement）に回す。
        // ゴミ箱/アーカイブ済み Atom は除外（不可視 Atom への吸収防止。自動経路と同じ理由）。
        const hiddenWikiIds = new Set(
          (fm.rawNoteIndex?.notes ?? [])
            .filter((n) => n.deletedAt || n.archivedAt)
            .map((n) => n.noteId),
        );
        const existingAtomDocIds = new Set(
          [...fm.wikiMetas.entries()]
            .filter(([id, m]) => m.kind === "atom" && !hiddenWikiIds.has(id))
            .map(([id]) => id),
        );
        const { kept, duplicates } = await partitionCandidatesByEmbedding(result.atoms, existingAtomDocIds);
        totalReinforced += await applyAtomReinforcement({
          duplicates,
          loadDoc: fm.loadDoc,
          saveWikiFile: fm.handleSaveWikiFile,
        });
        if (kept.length === 0) continue; // このクラスタの新規候補は既存と被り → 次のクラスタへ
        for (const candidate of kept) {
          const atomDoc = buildAtomDocument(candidate, result.model ?? null, getLocale());
          const newId = await fm.handleCreateWikiFile(atomDoc, { activityType: "wiki_atomize" });
          embedWikiSections(newId, atomDoc).catch(() => {});
          wikiLog.append(
            "ingest",
            [newId],
            `${atomLabel}: "${candidate.title}" (from ${candidate.derivedFromConceptTitles.join(" + ")})`,
          ).catch(() => {});
          totalCreated += 1;
          // 次イテレーションの dedup に渡す
          existingAtomTitles.push(candidate.title);
        }
      }
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId
            ? {
                ...i,
                status: "success" as const,
                detail: undefined,
                result:
                  `${totalCreated} ${atomLabel}`
                  + (totalReinforced > 0 ? ` / ${tStatic("ingest.reinforced", { count: String(totalReinforced) })}` : ""),
              }
            : i
        ),
      }));
      return { ok: true, created: totalCreated, iterations: lastIteration };
    } catch (err) {
      if (isAbortError(err) || options?.signal?.aborted) {
        // ユーザーの中断。ここまでに作成した Atom は残し、失敗扱いにしない。
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === toastId ? { ...i, status: "aborted" as const, detail: undefined, result: tStatic("ingest.aborted") } : i
          ),
        }));
        return { ok: false, created: totalCreated, iterations: lastIteration, aborted: true };
      }
      console.error("Atomize discovery failed:", err);
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: localizeAiError(err) } : i
        ),
      }));
      return { ok: false, created: totalCreated, iterations: lastIteration, error: localizeAiError(err) };
    }
  }, [fm]);

  // Settings → Maintenance タブから呼ばれる Wiki サマリー
  // ⚠️ 早期 return より前に置くこと（Rules of Hooks）
  const wikiSummariesForSettings = useMemo(() => {
    return fm.wikiFiles.map((wf) => {
      const meta = fm.wikiMetas.get(wf.id);
      const cached = fm.getCachedDoc(`wiki:${wf.id}`);
      return {
        id: wf.id,
        title: cached?.title ?? wf.name ?? wf.id,
        kind: (meta?.kind ?? "claim") as WikiKind,
        model: meta?.model,
      };
    });
  }, [fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc]);

  // 認証読み込み中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  // ローカルストレージは init() 完了後に signedIn=true になるため通常ここは通らない。
  // 何らかの理由で初期化に失敗した場合のみ、簡素なフォールバックを表示する。
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const sidebarProps = {
    activeFileId: fm.activeFileId,
    // ヘッダーの「戻る」導線。ノート A →（ピーク等経由で）ノート B / 素材へ飛んだあと A へ戻る。
    onBack: router.back,
    canGoBack: router.canGoBack,
    onSelect: (fileId: string) => { closeAllViews(); fm.handleOpenFile(fileId); setSidebarOpen(false); router.navigate({ view: "editor", fileId }); },
    onNewNote: () => { closeAllViews(); fm.handleNewNote(); setSidebarOpen(false); },
    onNewMemo: () => { setShowQuickMemoDialog(true); setSidebarOpen(false); },
    onRefresh: fm.refreshFiles,
    onShowReleaseNotes: () => setShowReleaseNotes(true),
    onShowSettings: () => { setShowSettings(true); setSidebarOpen(false); },
    agentConfigured,
    recentNotes: fm.recentNotes,
    onShowNoteList: () => { closeAllViews(); fm.setShowNoteList(true); setSidebarOpen(false); router.navigate({ view: "notes" }); },
    noteListActive: fm.showNoteList,
    onShowProcessGallery: () => { closeAllViews(); fm.setShowProcessGallery(true); setSidebarOpen(false); },
    processGalleryActive: fm.showProcessGallery,
    processCount: processNoteCount,
    mediaIndex: fm.mediaIndex,
    onShowAssetGallery: (type: import("./features/asset-browser").MediaType) => { closeAllViews(); fm.setActiveAssetType(type); setSidebarOpen(false); router.navigate({ view: "assets", mediaType: type }); },
    noteIndex: fm.noteIndex,
    onShowGlobalGraph: () => {
      // 他の排他ビューを全部畳んでから全体グラフを表示する（他の onShow* と同じ作法）。
      closeAllViews();
      setShowGlobalGraph(true);
      setListSidePeekNoteId(null);
      setSidebarOpen(false);
    },
    globalGraphActive: showGlobalGraph,
    onShowLabelGallery: (label: string) => { closeAllViews(); fm.setActiveLabel(label); setSidebarOpen(false); router.navigate({ view: "labels", label }); },
    activeAssetType: fm.activeAssetType,
    activeLabel: fm.activeLabel,
    filesLoading: fm.filesLoading,
    memoCount: capture.captureIndex?.captures.length ?? 0,
    onShowMemos: () => { closeAllViews(); setShowMemos(true); setSidebarOpen(false); router.navigate({ view: "memos" }); },
    memosActive: showMemos,
    // モバイル（受信箱）: **未処理**件数。取り込み済み素材の数ではない。
    // 受信箱は Tauri 専用（web では FS を覗けず何も表示できない）— web では
    // onShowMobile を渡さない＝サイドバーの「モバイル」見出し自体が出ない。
    mobileCount: inboxPendingCount,
    onShowMobile: isTauri()
      ? () => { closeAllViews(); setShowMobile(true); setSidebarOpen(false); router.navigate({ view: "mobile" }); }
      : undefined,
    mobileActive: showMobile,
    wikiCounts: (() => {
      // fm.wikiFiles は trash / archive を除外済み。wikiMetas には全 wiki が残っているため、
      // 表示用カウントは wikiFiles をベースに数える必要がある。
      let summary = 0;
      let claim = 0;
      let atom = 0;
      let synthesis = 0;
      for (const wf of fm.wikiFiles) {
        const meta = fm.wikiMetas.get(wf.id);
        if (!meta) continue;
        if (meta.kind === "summary") summary++;
        else if (meta.kind === "claim") claim++;
        else if (meta.kind === "atom") atom++;
        else if (meta.kind === "synthesis") synthesis++;
      }
      return { summary, claim, atom, synthesis };
    })(),
    // Atom（洞察）レイヤは default 昇格済み（design revision 2026-05-27）。
    // experimental.atomLayer に関わらず常にサイドバーに表示する。
    // synthesis（発想）レイヤはサイドバーから完全に外したので prop 自体を渡さない。
    showAtomLayer: true,
    onShowWikiList: (kind: WikiKind) => { closeAllViews(); fm.setActiveWikiKind(kind); setSidebarOpen(false); router.navigate({ view: "wiki-list", kind }); },
    activeWikiKind: fm.activeWikiKind,
    aiAvailable: aiAvailable ?? false,
    onShowWikiLog: () => { closeAllViews(); setActiveWikiView("log"); setSidebarOpen(false); router.navigate({ view: "wiki-log" }); },
    onShowWikiLint: () => { closeAllViews(); setActiveWikiView("lint"); setSidebarOpen(false); router.navigate({ view: "wiki-lint" }); },
    activeWikiView,
    skillCount: fm.skillMetas.size,
    onShowSkillList: () => { closeAllViews(); setShowSkillList(true); setSidebarOpen(false); },
    skillActive: showSkillList,
    onShowTrash: () => {
      closeAllViews();
      setShowTrash(true);
      setSidebarOpen(false);
    },
    trashActive: showTrash,
    trashCount: fm.trashedNotes.length + fm.archivedNotes.length,
    onShowSharedLibrary: getSharedRoot()
      ? () => {
          closeAllViews();
          setShowSharedLibrary(true);
          setSidebarOpen(false);
          router.navigate({ view: "shared-library" });
        }
      : undefined,
    sharedLibraryActive: showSharedLibrary,
  };

  return (
    <div className="flex flex-col h-dvh font-sans antialiased bg-background text-foreground">
      <UpdateBanner />
      <BackendDownBanner />
      <MissingApiKeyBanner />
      {/* モバイルヘッダー（メモ画面では非表示 — 記録特化体験） */}
      {(isDesktop || fm.activeFileId) && (
        <MobileHeader onMenuToggle={() => setSidebarOpen(true)} />
      )}
      {/* モバイル: Sheet ドロワー（メモ画面では非表示） */}
      {!isDesktop && fm.activeFileId && (
        <Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} side="left">
          <FileSidebar {...sidebarProps} />
        </Sheet>
      )}
      <div className="flex flex-1 min-h-0">
      {/* デスクトップ: 通常のサイドバー（集中モード時は細いレールに退避） */}
      {isDesktop && (
        desktopSidebarCollapsed ? (
          <div className="w-9 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col items-center py-3">
            <button
              onClick={() => setDesktopSidebarCollapsed(false)}
              title={t("sidebar.expand")}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-sidebar-accent"
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
          <FileSidebar
            {...sidebarProps}
            onCollapse={() => setDesktopSidebarCollapsed(true)}
          />
        )
      )}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {showGlobalGraph ? (
          <GlobalGraphView
            data={globalGraphData}
            onSelectNote={(noteId) => {
              // ノード単クリック → 共有 SidePeek で中身プレビュー（本開きは SidePeek 内から）。
              // noteId は wiki ノードに `wiki:` prefix 付き（SidePeek の規約に合わせる）。
              setListMaterialPeekEntry(null);
              setListSidePeekNoteId(noteId);
            }}
            onOpenMemo={handleOpenMemoSource}
            onOpenMedia={(fileId) => {
              // 素材ノードクリック → グラフを離れず素材サイドピークでプレビュー
              //（ノートノードと同じ方針。Full view はピーク内の Maximize から）。
              const target = fm.mediaIndex?.media.find((m) => m.fileId === fileId);
              if (!target) return;
              setListSidePeekNoteId(null);
              setListMaterialPeekEntry(target);
            }}
            onOpenUrl={(url) => {
              // URL ソースノードクリック → 素材サイドピーク（URL リーダー）でプレビュー。
              // 未登録 URL も本文内リンクと同じくアドホック entry でリーダー表示する。
              setListSidePeekNoteId(null);
              setListMaterialPeekEntry(buildUrlPeekEntry(url, fm.mediaIndex ?? null));
            }}
            onClose={() => setShowGlobalGraph(false)}
          />
        ) : fm.activeAssetType ? (
          <AssetGalleryView
            mediaIndex={fm.mediaIndex}
            mediaType={fm.activeAssetType}
            aiAvailable={aiUiEnabled}
            focusFileId={focusedMaterial?.fileId}
            focusFullMode={focusedMaterial?.fullMode}
            onFocusConsumed={() => setFocusedMaterial(null)}
            backToListSeq={assetViewResetSeq}
            onBack={() => { setAssetSidePeekNoteId(null); fm.setActiveAssetType(null); }}
            onOpenNoteInSidePeek={(noteId) => {
              // 利用ノードクリック等：アセット画面を離れず、右に SidePeek で開く。
              // wiki: プレフィックスは剥がさず保持する。SidePeek は noteId の
              // wiki: 有無で loadWikiFile / loadFile を切り替えるため、剥がすと
              // 要約等の Knowledge ノートが loadFile 経由になり「読み込みに失敗」する。
              // getCachedDoc / appKnowledgeMap も wiki: 付きキーで引く。
              setAssetSidePeekNoteId(noteId);
            }}
            onNavigateNote={(noteId) => {
              setAssetSidePeekNoteId(null);
              closeAllViews();
              // PDF アセットの利用ノートグラフから Wiki ノートをクリックしたケース：
              // MediaUsage.noteId は Wiki の場合 `wiki:{id}` prefix で格納されている。
              if (noteId.startsWith("wiki:")) fm.handleOpenWikiFile(noteId.slice(5));
              else fm.handleOpenFile(noteId);
            }}
            onDeleteMedia={fm.handleDeleteMedia}
            onArchiveMedia={fm.handleArchiveMedia}
            countSnapshotRefs={fm.countSnapshotRefsForAsset}
            onRenameMedia={handleRenameMediaWithBlockSync}
            onSharedRefUpdated={fm.handleUpdateMediaSharedRef}
            onAddUrlBookmark={fm.handleAddUrlBookmark}
            onUploadMedia={fm.handleUploadMedia}
            onExtractDocxImages={handleExtractDocxImages}
            resolveKnowledgeWikiId={(entry) => {
              if (entry.type === "url" && entry.url) {
                return appKnowledgeMap.get(`url:${entry.url}`)?.[0]?.noteId;
              }
              if (entry.type === "pdf" && entry.fileId) {
                return appKnowledgeMap.get(`pdf:${entry.fileId}`)?.[0]?.noteId;
              }
              if (entry.type === "document" && entry.fileId) {
                return appKnowledgeMap.get(`document:${entry.fileId}`)?.[0]?.noteId;
              }
              return undefined;
            }}
            onIngestMedia={aiUiEnabled ? (entry) => {
              // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）
              if (!ensureAgentConfigured()) return;
              if (entry.type === "url" && entry.url) {
                // toast ID は一意にしておくが、wiki に保存する sourceNoteId は URL ベースの安定 ID
                // にしておくことで、同じ URL を再 ingest した際に逆引き（Knowledge 化済み判定）
                // が壊れない。
                const toastId = `url-toast:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const sourceNoteId = `url:${entry.url}`;
                const newItem: IngestToastItem = { id: toastId, status: "queued", noteTitle: entry.name || entry.url };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "generating" as const, detail: "Fetching URL..." } : i) }));
                  try {
                    const existingWikis = (fm.noteIndex?.notes ?? []).filter((n) => n.source === "ai" && n.wikiKind).map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                    const result = await ingestFromUrl(entry.url, existingWikis, getLocale());
                    if (result.wikis.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: tStatic("ingest.insufficientContent") } : i) }));
                      return;
                    }
                    for (const wiki of result.wikis) {
                      const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, entry.name || entry.url, undefined, getLocale(), buildNoteIndex(fm.noteIndex));
                      const newId = await fm.handleCreateWikiFile(wikiDoc);
                      embedWikiSections(newId, wikiDoc).catch(() => {});
                    }
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
              } else if (entry.type === "pdf" && entry.fileId) {
                const toastId = `pdf-toast:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const sourceNoteId = `pdf:${entry.fileId}`;
                const newItem: IngestToastItem = { id: toastId, status: "queued", noteTitle: entry.name || entry.fileId };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "generating" as const, detail: "Extracting PDF text..." } : i) }));
                  try {
                    const provider = getActiveProvider();
                    const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
                    const blob = await (await fetch(blobUrl)).blob();
                    const existingWikis = (fm.noteIndex?.notes ?? []).filter((n) => n.source === "ai" && n.wikiKind).map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                    const result = await ingestFromPdf(blob, entry.name || "document.pdf", sourceNoteId, existingWikis, getLocale());
                    if (result.wikis.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: tStatic("ingest.insufficientContent") } : i) }));
                      return;
                    }
                    for (const wiki of result.wikis) {
                      const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, entry.name || "PDF", undefined, getLocale(), buildNoteIndex(fm.noteIndex));
                      const newId = await fm.handleCreateWikiFile(wikiDoc);
                      embedWikiSections(newId, wikiDoc).catch(() => {});
                    }
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
              } else if (entry.type === "document" && entry.fileId
                && entry.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                // Word (.docx) を Knowledge 化: mammoth でテキスト抽出後、PDF と同じ /ingest API に流す
                const toastId = `doc-toast:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const sourceNoteId = `document:${entry.fileId}`;
                const newItem: IngestToastItem = { id: toastId, status: "queued", noteTitle: entry.name || entry.fileId };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "generating" as const, detail: "Extracting Word text..." } : i) }));
                  try {
                    const provider = getActiveProvider();
                    const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
                    const blobUrl = await provider.getMediaBlobUrl(fileId);
                    const blob = await (await fetch(blobUrl)).blob();
                    const existingWikis = (fm.noteIndex?.notes ?? []).filter((n) => n.source === "ai" && n.wikiKind).map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                    const result = await ingestFromDocx(blob, entry.name || "document.docx", sourceNoteId, existingWikis, getLocale());
                    if (result.wikis.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: tStatic("ingest.insufficientContent") } : i) }));
                      return;
                    }
                    for (const wiki of result.wikis) {
                      const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, entry.name || "Word", undefined, getLocale(), buildNoteIndex(fm.noteIndex));
                      const newId = await fm.handleCreateWikiFile(wikiDoc);
                      embedWikiSections(newId, wikiDoc).catch(() => {});
                    }
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
              }
            } : undefined}
            onCreateProvNote={aiUiEnabled ? (entry) => {
              // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）
              if (!ensureAgentConfigured()) return;
              // 既にこの書庫で使われているラベルを ingester に渡す。同じモノに
              // 毎回別名が付いてラベルが増えるのを防ぐ（頻出順に上限付きで抜粋）
              const vocabulary = collectLabelVocabulary(fm.noteIndex?.notes);
              // URL 経路
              if (entry.type === "url" && entry.url) {
                const jobId = `prov-url:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.url };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Fetching & parsing URL..." } : i) }));
                  try {
                    const result = await ingestUrlToProv(entry.url, getLocale(), vocabulary);
                    if (!result.blocks || result.blocks.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: tStatic("ingest.provFailed") } : i) }));
                      return;
                    }
                    const provDoc = buildProvNoteDocument({
                      title: result.title,
                      blocks: result.blocks,
                      sourceUrl: result.sourceUrl,
                      sourceTitle: result.sourceTitle,
                      sourceFetchedAt: result.sourceFetchedAt,
                      model: result.model,
                      tokenUsage: result.tokenUsage,
                    });
                    await fm.handleCreateNoteFromDocument(provDoc);
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.blocks.length} blocks` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
                return;
              }
              // PDF 経路（PROV ノート生成）。画像抽出は onExtractPdfPages 側で扱う。
              if (entry.type === "pdf" && entry.fileId) {
                const jobId = `prov-pdf:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.fileId };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Extracting PDF text..." } : i) }));
                  try {
                    const provider = getActiveProvider();
                    const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
                    const blob = await (await fetch(blobUrl)).blob();
                    const result = await ingestPdfToProv(blob, entry.name || "document.pdf", getLocale(), vocabulary);
                    if (!result.blocks || result.blocks.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: tStatic("ingest.provFailed") } : i) }));
                      return;
                    }
                    const provDoc = buildProvNoteDocument({
                      title: result.title,
                      blocks: result.blocks,
                      sourcePdfFileId: entry.fileId,
                      sourceTitle: result.sourceTitle || entry.name,
                      sourceFetchedAt: result.sourceFetchedAt,
                      model: result.model,
                      tokenUsage: result.tokenUsage,
                    });
                    await fm.handleCreateNoteFromDocument(provDoc);
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.blocks.length} blocks` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
                return;
              }
              // Word 経路（PROV ノート生成）。mammoth で raw text → サーバーの ingest-pdf 経路へ流す。
              if (entry.type === "document" && entry.fileId
                && entry.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                const jobId = `prov-doc:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.fileId };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Extracting Word text..." } : i) }));
                  try {
                    const provider = getActiveProvider();
                    const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
                    const blobUrl = await provider.getMediaBlobUrl(fileId);
                    const blob = await (await fetch(blobUrl)).blob();
                    const result = await ingestDocxToProv(blob, entry.name || "document.docx", getLocale(), vocabulary);
                    if (!result.blocks || result.blocks.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: tStatic("ingest.provFailed") } : i) }));
                      return;
                    }
                    const provDoc = buildProvNoteDocument({
                      title: result.title,
                      blocks: result.blocks,
                      sourceDocumentFileId: entry.fileId,
                      sourceTitle: result.sourceTitle || entry.name,
                      sourceFetchedAt: result.sourceFetchedAt,
                      model: result.model,
                      tokenUsage: result.tokenUsage,
                    });
                    await fm.handleCreateNoteFromDocument(provDoc);
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.blocks.length} blocks` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
                return;
              }
            } : undefined}
            onTranslatePdf={aiUiEnabled ? (entry) => {
              // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）
              if (!ensureAgentConfigured()) return;
              // URL 経路: Reader Mode 本文を「原文構成のまま UI 言語へ全文翻訳」した 1 ノートにする。
              // PDF と違いページ概念が無いので、本文を段落境界でチャンク分割して並列翻訳する。
              if (entry.type === "url" && entry.url) {
                const url = entry.url;
                const jobId = `translate-url:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || url };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Fetching & parsing URL..." } : i) }));
                  try {
                    // 1) Reader 本文を取得（言語判定にも使う。サーバー側でキャッシュ済み）
                    const article = await fetchReaderArticle(url);
                    // 2) 丁寧版: 既に表示言語のページなら無駄な翻訳になるので確認する
                    if (isSameLanguage(article.lang, getLocale())) {
                      const ok = window.confirm(tStatic("asset.translateSameLangConfirm"));
                      if (!ok) {
                        setIngestToast((prev) => prev ? { items: prev.items.filter((i) => i.id !== jobId) } : prev);
                        return;
                      }
                    }
                    // 3) チャンク分割して並列翻訳 → 1 ノート化
                    const result = await translateUrlToNote(article, getLocale(), url, {
                      // 代表画像は取り込み時に一度だけ保存する（本文にリモート URL を残さない）。
                      // 元 URL 素材からの派生として登録し、アセットグラフで辿れるようにする
                      //  —— PDF 経路の抽出図と対称。
                      uploadImage: (file) => fm.handleUploadMedia(file, { derivedFromAssets: [entry.fileId] }),
                      onPhase: (label) => {
                        setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: label } : i) }));
                      },
                      onProgress: (done, total) => {
                        setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: `Translating ${done}/${total}...` } : i) }));
                      },
                    });
                    // B-persist: Reader が取得した原語原文を永続保存し、翻訳ノートに紐付ける。
                    // これでノート内参照 grounding 時にオフラインでも・URL 内容が変わっても同じ原文を引ける。
                    const textFileId = await persistUrlSourceText(article.textContent);
                    if (textFileId) result.doc.sourceTextFileId = textFileId;
                    const newNoteId = await fm.handleCreateNoteFromDocument(result.doc);
                    // Reader を全画面表示にして、その右に翻訳ノートを SidePeek で開く（読みながら照合）
                    setFocusedMaterial({ fileId: entry.fileId, fullMode: true });
                    setAssetSidePeekNoteId(newNoteId);
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.pageCount} parts` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                  }
                })();
                return;
              }
              // PDF を「原文構成のまま UI 言語へ全文翻訳」した 1 ノートを生成する。
              // 要約・構造化（Knowledge / PROV）とは別経路。チャンク分割して順次翻訳する。
              if (entry.type !== "pdf" || !entry.fileId) return;
              const jobId = `translate-pdf:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
              const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.fileId };
              setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
              (async () => {
                setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Extracting PDF text..." } : i) }));
                try {
                  const provider = getActiveProvider();
                  const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
                  const blob = await (await fetch(blobUrl)).blob();
                  // 既にこの PDF から抽出済みの画像があれば再利用（再実行で重複させない）。
                  // ファイル名 "... - p{N} image {M}.png" からページ番号を復元する。
                  const existingImages = (fm.mediaIndex?.media ?? [])
                    .filter((m) => m.type === "image" && m.derivedFromAssets?.includes(entry.fileId!))
                    .map((m) => {
                      const pm = m.name.match(/ - p(\d+) image \d+/);
                      return { pageNumber: pm ? parseInt(pm[1], 10) : 1, url: m.url, name: m.name };
                    });
                  const result = await translatePdfToNote(
                    blob,
                    entry.name || "document.pdf",
                    getLocale(),
                    entry.fileId,
                    {
                      existingImages,
                      // 初回のみ抽出。抽出図は PDF からの派生として登録（アセットグラフで辿れる）
                      uploadImage: (file) => fm.handleUploadMedia(file, { derivedFromAssets: [entry.fileId!] }),
                      onPhase: (label) => {
                        setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: label } : i) }));
                      },
                      onProgress: (done, total) => {
                        setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: `Translating ${done}/${total}...` } : i) }));
                      },
                    },
                  );
                  const newNoteId = await fm.handleCreateNoteFromDocument(result.doc);
                  // PDF を全画面表示にして、その右に翻訳ノートを SidePeek で開く（読みながら照合）。
                  setFocusedMaterial({ fileId: entry.fileId!, fullMode: true });
                  setAssetSidePeekNoteId(newNoteId);
                  const note = `${result.pageCount} pages`
                    + (result.imageCount > 0 ? `, ${result.imageCount} figures` : "")
                    + (result.truncated ? " (truncated)" : "");
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: note } : i) }));
                } catch (err) {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                }
              })();
            } : undefined}
            onExtractPdfPages={async (entry, onProgress) => {
              // PDF 内部に埋め込まれた画像オブジェクトを抽出して画像アセットに登録する。
              // ベクター figure / 表は PDF 内部に「画像」として存在しないため対象外。
              // 失敗時は MaterialSidePeek 側でエラーメッセージを表示する。
              if (entry.type !== "pdf" || !entry.fileId) return { extracted: 0 };
              const provider = getActiveProvider();
              const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
              const blob = await (await fetch(blobUrl)).blob();
              const images = await extractEmbeddedPdfImages(blob, { onProgress });
              // 抽出した画像を順次アップロード。進捗 total は抽出フェーズ（ページ数）
              // とアップロードフェーズ（画像数）で異なるが、ボタン側は数字 progress
              // のみ見せるので「N/M」が読めれば十分。
              for (let i = 0; i < images.length; i++) {
                const file = embeddedImageToFile(images[i], entry.name || "document.pdf");
                // 派生関係を MediaIndex に記録。これで両モーダルのネットワーク図で
                // PDF↔画像 を相互に辿れるようになる。
                await fm.handleUploadMedia(file, { derivedFromAssets: [entry.fileId] });
                onProgress(i + 1, images.length);
              }
              return { extracted: images.length };
            }}
            getKnowledgeKind={(rawId) => fm.wikiMetas.get(rawId)?.kind}
            // 引用は毎回「新規メモ」として保存する。
            // どのノートに入るかが不明瞭という UX 問題を回避するため、ノート直挿入はやめて
            // メモを介する 1 ステップに揃えた。後でメモピッカーから任意のノートに引用できる。
            // PDF スコープのチャットは未実装のため Save → Chat は出さない（別 PR で扱う）。
            onSaveSelectionAsMemo={(source) => {
              const sourceLabel = buildCitationSourceLabel(source);
              const memoText = `${source.selectionText}\n\n— ${sourceLabel}`;
              // PR3-a: 出典素材を構造化して保持する。テキストの末尾ラベルに加えて
              // sourceAsset.fileId を埋めておくことで、ファイル名変更後もメモ↔素材を辿れる。
              void capture.handleCreateCapture(memoText, {
                fileId: source.entry.fileId,
                type: source.entry.type,
                ...(source.pageNumber !== undefined ? { pageNumber: source.pageNumber } : {}),
              });
              // 軽い通知だけ出して、ユーザーは PDF を読み続けられるようにする
              const id = `quote-toast:${Date.now()}`;
              setIngestToast((prev) => ({
                items: [
                  ...(prev?.items ?? []),
                  { id, status: "success" as const, noteTitle: sourceLabel, result: tStatic("asset.quoteToMemoSaved") },
                ],
              }));
              window.setTimeout(() => {
                setIngestToast((prev) => prev ? { items: prev.items.filter((i) => i.id !== id) } : prev);
              }, 2500);
            }}
            onSaveImageAsAsset={async (imageUrl, sourceEntry) => {
              // Reader で表示中の記事画像を Graphium の画像アセットとして保存する。
              // クロスオリジン画像のバイトは canvas の cross-origin taint を避けるため、
              // sidecar の /url/image-proxy 経由で取得する（/url/reader と同じ信頼レベル）。
              // 保存画像は元 URL 素材を親（derivedFromAssets）にして asset graph に並ぶ
              // —— PDF 埋め込み画像抽出と対称。
              const toastId = `save-image:${Date.now()}`;
              try {
                const file = await fetchRemoteImageAsFile(imageUrl);
                await fm.handleUploadMedia(file, {
                  derivedFromAssets: sourceEntry.fileId ? [sourceEntry.fileId] : [],
                });
                setIngestToast((prev) => ({
                  items: [
                    ...(prev?.items ?? []),
                    { id: toastId, status: "success" as const, noteTitle: sourceEntry.name, result: tStatic("asset.imageSaved") },
                  ],
                }));
                window.setTimeout(() => {
                  setIngestToast((prev) => (prev ? { items: prev.items.filter((i) => i.id !== toastId) } : prev));
                }, 2500);
              } catch (err) {
                setIngestToast((prev) => ({
                  items: [
                    ...(prev?.items ?? []),
                    { id: toastId, status: "error" as const, noteTitle: sourceEntry.name, result: tStatic("asset.imageSaveFailed") },
                  ],
                }));
                // UrlReaderView 側の catch が保存ボタンを閉じられるよう再スローする
                throw err;
              }
            }}
            captureIndex={capture.captureIndex}
            onDeleteMemo={capture.handleDeleteCapture}
            onCreateMemoForAsset={async (assetEntry, text) => {
              // Memos タブの入力欄から保存されたメモも sourceAsset を埋める
              // ことで、Quote→Memo と同じ扱いで素材↔メモを辿れるようにする。
              await capture.handleCreateCapture(text, {
                fileId: assetEntry.fileId,
                type: assetEntry.type,
              });
            }}
            notePeekId={assetSidePeekNoteId}
            renderNotePeek={(noteId) => (
              // 他のノートのサイドピークと同じ inline 表示で、PDF 全画面ビューの
              // 右パネル（グラフ）の左に差し込まれる。
              // SidePeek 内部は AiAssistant コンテキストを要求するため Provider で包み、
              // エラーバウンダリでアプリ全体の白画面化を防ぐ。
              <AiAssistantProvider aiAvailable={aiUiEnabled}>
                <ListSidePeekBoundary onClose={() => setAssetSidePeekNoteId(null)}>
                  <SidePeek
                    // ノート切替で丸ごと作り直す（前ノートの本文で上書きするデータ破壊を防ぐ）
                    key={noteId}
                    inline
                    noteId={noteId}
                    cachedDoc={fm.getCachedDoc(noteId) ?? undefined}
                    getCachedDoc={fm.getCachedDoc}
                    onSaved={handleListPeekSaved}
                    onClose={() => setAssetSidePeekNoteId(null)}
                    onNavigate={(navId, savedDoc) => {
                      // SidePeek 内のリンクから本格的に開く場合はアセット画面を含む
                      // 上位ビューを全て畳んでから本文へ遷移する。
                      setAssetSidePeekNoteId(null);
                      closeAllViews();
                      if (navId.startsWith("wiki:")) fm.handleOpenWikiFile(navId.slice(5));
                      else fm.handleOpenFile(navId, savedDoc);
                    }}
                    wikiEntries={appKnowledgeMap.get(noteId) ?? []}
                    mediaIndex={fm.mediaIndex ?? null}
                    captureIndex={capture.captureIndex ?? null}
                    uploadFile={fm.handleUploadMedia}
                    onAddUrlBookmark={fm.handleAddUrlBookmark}
                    noteIndex={fm.noteIndex ?? null}
                    onCreateLinkedNote={fm.handleCreateLinkedNote}
                    onOpenNoteInPeek={(peekId) => setAssetSidePeekNoteId(peekId)}
                    onOpenMemoSource={handleOpenMemoSource}
                  />
                </ListSidePeekBoundary>
              </AiAssistantProvider>
            )}
          />
        ) : fm.showProcessGallery ? (
          <ProcessGalleryView
            processIndex={fm.processIndex}
            onBack={() => fm.setShowProcessGallery(false)}
            onNavigateNote={(noteId) => {
              fm.setShowProcessGallery(false);
              fm.handleOpenFile(noteId);
              router.navigate({ view: "editor", fileId: noteId });
            }}
            onForkProcess={async (noteId) => {
              const newNoteId = await fm.handleForkProcess(noteId);
              if (newNoteId) {
                fm.setShowProcessGallery(false);
                await fm.handleOpenFile(newNoteId);
                router.navigate({ view: "editor", fileId: newNoteId });
              }
              return newNoteId;
            }}
          />
        ) : fm.activeLabel ? (
          <LabelGalleryView
            noteIndex={fm.noteIndex}
            label={fm.activeLabel}
            onBack={() => fm.setActiveLabel(null)}
            onNavigateNote={(noteId) => { fm.setActiveLabel(null); fm.handleOpenFile(noteId); }}
          />
        ) : fm.showNoteList ? (
          <NoteListView
            noteIndex={fm.noteIndex}
            onOpenNote={(noteId) => { setListSidePeekNoteId(noteId); }}
            onOpenNoteFull={(noteId) => { setListSidePeekNoteId(null); closeAllViews(); fm.handleOpenFile(noteId); router.navigate({ view: "editor", fileId: noteId }); }}
            onBack={() => { setListSidePeekNoteId(null); fm.setShowNoteList(false); router.navigate({ view: "home" }); }}
            onDeleteNotes={async (ids) => {
              // 参照警告: 1件以上から参照されている場合は info 確認を出してから移動
              // ゴミ箱への移動なので復元可能 — ここでは情報的な警告にとどめる
              if (fm.rawNoteIndex) {
                const refIds = new Set<string>();
                for (const id of ids) {
                  for (const ref of findIncomingReferences(fm.rawNoteIndex, id)) {
                    if (!ids.includes(ref.noteId)) refIds.add(ref.noteId);
                  }
                }
                if (refIds.size > 0) {
                  const ok = window.confirm(
                    t("nav.refsTrashWarn", { count: String(refIds.size) })
                  );
                  if (!ok) return;
                }
              }
              for (const id of ids) await fm.handleDelete(id);
            }}
            onArchiveNotes={async (ids) => {
              for (const id of ids) await fm.handleArchiveNote(id);
            }}
            onOpenWikiPeek={(wikiNoteId) => { setListSidePeekNoteId(wikiNoteId); }}
            onSetNoteContexts={fm.updateNoteContexts}
            onDeleteContextEverywhere={handleDeleteContextEverywhere}
            onIngestNotes={aiUiEnabled ? async (ids) => {
              // AI 未設定なら発火させない（enqueueIngest にも同ガードがあるが、
              // doc ロード等の無駄な前処理に入る前にここで止める）
              if (!ensureAgentConfigured()) return;
              // Knowledge 化候補から AI 派生（wiki）と既に処理待ちの ID を除外
              const candidates: { id: string; title: string }[] = [];
              const skippedAi: string[] = [];
              for (const id of ids) {
                const entry = fm.noteIndex?.notes.find((n) => n.noteId === id);
                if (!entry) continue;
                if (entry.source === "ai") {
                  skippedAi.push(entry.title || tStatic("nav.untitled"));
                  continue;
                }
                candidates.push({ id, title: entry.title || tStatic("nav.untitled") });
              }
              if (skippedAi.length > 0) {
                window.alert(tStatic("ingest.skippedWikiNotes", { count: String(skippedAi.length) }));
              }
              if (candidates.length === 0) return;

              // doc 本体をロードしてキューに積む
              for (const { id, title } of candidates) {
                const doc = await fm.loadDoc(id);
                if (!doc) continue;
                enqueueIngest(id, title, doc);
              }
            } : undefined}
            onImportMarkdown={async (files, onProgress) => {
              const {
                importMarkdownToGraphiumDoc,
                buildWikiLinkResolver,
                applyWikiLinkResolution,
                isMarkdownFile,
              } = await import("./features/markdown-import/import");

              const mdFiles = files.filter(isMarkdownFile);
              if (mdFiles.length === 0) {
                window.alert(tStatic("import.noMarkdownFiles"));
                return;
              }

              // 画像参照を相対パスで解決するため、フォルダ内の全ファイルからルックアップを作る。
              // webkitdirectory 経由の File は webkitRelativePath を持つ（"vault/foo.md" 等）。
              // 単体選択時は path = name のみなので vault モードかどうかで分岐する。
              const isVaultMode = mdFiles.some((f) => (f as any).webkitRelativePath);
              const allByPath = new Map<string, File>();
              if (isVaultMode) {
                for (const f of files) {
                  const rel: string = (f as any).webkitRelativePath || f.name;
                  allByPath.set(rel.toLowerCase(), f);
                  // 末尾のファイル名のみのキーでも引けるように
                  const baseName = rel.split("/").pop()?.toLowerCase();
                  if (baseName && !allByPath.has(baseName)) allByPath.set(baseName, f);
                }
              }

              const resolveImage = isVaultMode
                ? async (relativePath: string): Promise<File | null> => {
                    const lc = relativePath.toLowerCase();
                    const direct = allByPath.get(lc);
                    if (direct) return direct;
                    const baseName = lc.split("/").pop();
                    if (baseName) {
                      const byName = allByPath.get(baseName);
                      if (byName) return byName;
                    }
                    return null;
                  }
                : undefined;

              // pass 1: 各 MD を doc に変換 → ノート作成
              const baseNameToNoteId = new Map<string, string>();
              const docsByNoteId = new Map<
                string,
                { doc: import("./lib/document-types").GraphiumDocument; wikilinks: { target: string; display: string }[] }
              >();
              const failed: string[] = [];
              let lastNewId: string | null = null;

              for (let i = 0; i < mdFiles.length; i++) {
                const file = mdFiles[i];
                onProgress({ done: i, total: mdFiles.length, current: file.name, failed: [...failed] });
                try {
                  const { doc, wikilinks } = await importMarkdownToGraphiumDoc(file, {
                    resolveImage,
                    uploadImage: fm.handleUploadMedia,
                  });
                  const newId = await fm.handleCreateNoteFromImport(doc);
                  const baseName = file.name.replace(/\.(md|markdown)$/i, "");
                  baseNameToNoteId.set(baseName.toLowerCase(), newId);
                  docsByNoteId.set(newId, { doc, wikilinks });
                  lastNewId = newId;
                } catch (err) {
                  console.error("Markdown インポート失敗:", file.name, err);
                  failed.push(file.name);
                }
                onProgress({ done: i + 1, total: mdFiles.length, failed: [...failed] });
              }

              // pass 2: wikilinks を解決して保存。
              // 解決先は「今回のインポートで作成したノート」→「既存ノート（タイトル一致）」。
              // 全件未解決のノートも必ず保存し直す: pass 1 で保存した本文には
              // プレースホルダ（{{GWLINK_n}}）が残っており、[[リンク]] テキストへ
              // 復元した姿で上書きする必要がある。
              let unresolvedLinkCount = 0;
              if (docsByNoteId.size > 0) {
                // 既存ノートの解決先は noteIndex（タイトルを持ち、アーカイブ除外済み。
                // wiki も含むので、エクスポートした wiki への @リンクも復元できる）
                const resolver = buildWikiLinkResolver(baseNameToNoteId, fm.noteIndex?.notes ?? []);
                const resolution = applyWikiLinkResolution(docsByNoteId, resolver);
                unresolvedLinkCount = resolution.unresolvedCount;
                for (const [noteId, updated] of resolution.updates) {
                  try {
                    await fm.handleSaveImportedDoc(noteId, updated);
                  } catch (err) {
                    console.warn("Markdown リンク解決の保存失敗:", noteId, err);
                  }
                }
                console.info(`[markdown-import] リンク解決: ${resolution.resolvedCount} / ${resolution.resolvedCount + resolution.unresolvedCount}`);
              }

              await fm.refreshFiles();

              const successCount = mdFiles.length - failed.length;
              if (successCount > 0) {
                const msg = [tStatic("import.importedCount", { count: String(successCount) })];
                if (unresolvedLinkCount > 0) {
                  msg.push("", tStatic("import.unresolvedLinksNote"));
                }
                window.alert(msg.join("\n"));
              }

              if (lastNewId && mdFiles.length === 1) {
                fm.setShowNoteList(false);
                fm.handleOpenFile(lastNewId);
                router.navigate({ view: "editor", fileId: lastNewId });
              }
            }}
          />
        ) : showMemos ? (
          <MemoGalleryView
            captureIndex={capture.captureIndex}
            loading={capture.captureLoading}
            onBack={() => setShowMemos(false)}
            onInsertMemo={(captureId, text, deleteAfter) => {
              setPendingMemoInsert({ captureId, text, deleteAfter });
              setShowMemos(false);
            }}
            onDeleteMemo={capture.handleDeleteCapture}
            onArchiveMemo={capture.handleArchiveCapture}
            onEditMemo={capture.handleEditCapture}
            onNavigateNote={(noteId) => {
              setShowMemos(false);
              // knowledgedInto は直接 ingest 化後は wiki:<id> を記録する（ノートではなく
              // ナレッジが生成されるため）。旧フローで記録された生ノート ID とも共存。
              if (noteId.startsWith("wiki:")) fm.handleOpenWikiFile(noteId.slice("wiki:".length));
              else fm.handleOpenFile(noteId);
            }}
            insertDisabled={!fm.activeFileId}
            onCreateMemo={capture.handleCreateCapture}
            creating={capture.capturing}
            onKnowledgeMemos={aiUiEnabled ? (captureIds) => {
              // AI 未設定なら発火させない（enqueueIngest にも同ガードあり）
              if (!ensureAgentConfigured()) return;
              // 選択メモを一時 doc に変換し、ノートを作らず直接 ingest キューに流す。
              // 由来は "memo:<captureId>"（external-source.ts 規約）として wiki の
              // derivedFromNotes に残る。ノート複数選択 Knowledge 化と同じく、
              // 各 ingest 後に vault 全 Claim で atomize がまとめて走る。
              // captureId は安定 ID なので、enqueueIngest の重複ガードで
              // キュー滞留中の二度押しも自然に弾かれる。
              const caps = capture.captureIndex?.captures ?? [];
              for (const id of captureIds) {
                const entry = caps.find((c) => c.id === id);
                const text = entry?.text?.trim();
                if (!text) continue;
                const doc = buildMemoNoteDoc(text, tStatic("memo.title"));
                // ナレッジ化先の逆リンク（knowledgedInto）はノートではなく、ingest で
                // 生成された wiki を記録する。wiki ID はキュー処理内で確定するため、
                // 記録は processIngestQueue 側（memo: ジョブの wiki 保存後）で行う。
                enqueueIngest(`memo:${id}`, doc.title, doc);
              }
            } : undefined}
          />
        ) : showMobile ? (
          // モバイル受信箱: 同期フォルダ <root>/Inbox/ の **まだ取り込んでいない** ファイル一覧。
          // 素材ライブラリ（AssetGalleryView / MediaIndexEntry）とは表示対象の型が違うので
          // 流用せず別コンポーネント。取り込むと素材へ振り分けられ、ここからは消える。
          <InboxView
            rootConfigured={inboxRoot != null}
            source={inboxSource}
            onPickRoot={async () => { await handlePickInboxRoot(); }}
            keepArchive={inboxKeepArchive}
            onKeepArchiveChange={handleInboxKeepArchiveChange}
            onImport={handleImportFromInbox}
            onPendingCount={setInboxPendingCount}
            onBack={() => setShowMobile(false)}
          />
        ) : activeWikiView === "log" ? (
          <WikiLogView
            onBack={() => setActiveWikiView(null)}
            onOpenWiki={(wikiId) => { setActiveWikiView(null); fm.handleOpenWikiFile(wikiId); }}
          />
        ) : activeWikiView === "lint" ? (
          <WikiLintView
            report={lintReport}
            loading={lintLoading}
            onRunLint={async (localOnly) => {
              setLintLoading(true);
              try {
                const snapshots = buildWikiSnapshots(fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc);
                if (snapshots.length === 0) {
                  // Wiki が無いときは API を叩かず空レポートを返す。
                  // サーバーは wikis 必須なので 400 を返すが、ユーザーには「Wiki なし」と
                  // 伝える方が親切。
                  setLintReport({
                    issues: [],
                    summary: { total: 0, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 0 },
                    analyzedAt: new Date().toISOString(),
                  });
                  return;
                }
                const report = await lintWikis(snapshots, getLocale(), localOnly);
                setLintReport(report);
              } catch (err) {
                console.error("Lint failed:", err);
              } finally {
                setLintLoading(false);
              }
            }}
            onOpenWiki={(wikiId) => { setListSidePeekNoteId(`wiki:${wikiId}`); }}
            onBack={() => setActiveWikiView(null)}
            onRegenerateWiki={async (wikiId) => {
              await regenerateWikiById(wikiId, { openAfter: false });
            }}
            onArchiveWiki={async (wikiId) => {
              await fm.handleArchiveWikiFile(wikiId);
            }}
            wikiTitleById={(() => {
              // wikiId → title マップ。Lint カードで UUID ではなくタイトルを表示するため。
              const map = new Map<string, string>();
              for (const [id, meta] of fm.wikiMetas.entries()) {
                if (meta?.title) map.set(id, meta.title);
              }
              return map;
            })()}
          />
        ) : fm.activeWikiKind ? (
          <WikiListView
            noteIndex={fm.noteIndex}
            wikiKind={fm.activeWikiKind}
            wikiFiles={fm.wikiFiles}
            wikiMetas={fm.wikiMetas}
            onOpenWiki={(wikiId) => { setListSidePeekNoteId(`wiki:${wikiId}`); }}
            onOpenWikiFull={(wikiId) => { const kind = fm.activeWikiKind!; setListSidePeekNoteId(null); closeAllViews(); fm.handleOpenWikiFile(wikiId); router.navigate({ view: "wiki-editor", kind, wikiId }); }}
            onBack={() => { setListSidePeekNoteId(null); fm.setActiveWikiKind(null); router.navigate({ view: "home" }); }}
            onDeleteWiki={fm.handleDeleteWikiFile}
            onRegenerateWiki={aiUiEnabled ? (wikiId) => regenerateWikiById(wikiId, { openAfter: false }) : undefined}
            onWorldCheckWiki={aiUiEnabled ? (wikiId) => handleWorldCheckWiki(wikiId, "bulk") : undefined}
            onClearWorldValidity={(wikiId) => handleClearWorldValidity(wikiId)}
          />
        ) : showSharedLibrary && getSharedRoot() ? (
          <SharedLibraryView
            sharedRoot={getSharedRoot()!}
            currentIdentity={loadAuthorIdentity()}
            focusEntryId={sharedLibraryFocusId}
            onFocusConsumed={() => setSharedLibraryFocusId(null)}
            onForkNote={async (sharedId) => {
              const root = getSharedRoot();
              if (!root) return;
              const result = await forkSharedNote(sharedId, { root });
              if (!result.ok) {
                alert(`Fork failed: ${result.error}`);
                return;
              }
              // Phase 2c-2: shared-blob: 参照を自分のローカルメディアに materialize
              let docToSave = result.doc;
              const extraBlobs = (result.original.extra as { blobs?: BlobRef[] } | undefined)?.blobs;
              const blobRoot = getBlobRoot();
              if (Array.isArray(extraBlobs) && extraBlobs.length > 0 && blobRoot) {
                const blobProvider = new LocalFolderBlobProvider(blobRoot);
                const materialized = await materializeSharedBlobs(result.doc, {
                  blobs: extraBlobs,
                  fetchBytes: (ref) => blobProvider.get(ref),
                  uploadMedia: async (file) => ({ url: await fm.handleUploadMedia(file) }),
                });
                docToSave = materialized.doc;
                if (materialized.missing.length > 0) {
                  alert(
                    `Forked, but ${materialized.missing.length} embedded media could not be restored from blob root. They appear as broken references in the new note.`,
                  );
                }
              }
              const newFileId = await fm.handleCreateNoteFromImport(docToSave);
              setShowSharedLibrary(false); setShowGlobalGraph(false);
              fm.handleOpenFile(newFileId);
              router.navigate({ view: "editor", fileId: newFileId });
            }}
            onUnshare={async (entry) => {
              const author = loadAuthorIdentity();
              const root = getSharedRoot();
              if (!author || !root) {
                alert("Identity not registered or shared root not configured.");
                return;
              }
              const result = await unshareEntry(entry.id, {
                root,
                author,
                blobRoot: getBlobRoot() ?? undefined,
              });
              if (!result.ok) {
                alert(`Unshare failed: ${result.error}`);
              }
            }}
            onBack={() => { setShowSharedLibrary(false); setShowGlobalGraph(false); router.navigate({ view: "home" }); }}
          />
        ) : showTrash ? (
          <TrashView
            rawNoteIndex={fm.rawNoteIndex}
            trashedNotes={fm.trashedNotes}
            archivedNotes={fm.archivedNotes}
            onBack={() => { setShowTrash(false); router.navigate({ view: "home" }); }}
            onRestore={async (ids) => {
              for (const id of ids) await fm.handleRestore(id);
            }}
            onPermanentDelete={async (ids) => {
              for (const id of ids) await fm.handlePermanentDelete(id);
            }}
            onRestoreArchive={async (ids) => {
              for (const id of ids) await fm.handleRestoreFromArchive(id);
            }}
            onSendArchiveToTrash={async (ids) => {
              for (const id of ids) await fm.handleSendArchiveToTrash(id);
            }}
            onOpenArchived={(noteId, isWiki) => {
              // アーカイブされた wiki / ノートをサイドピークで閲覧する。
              // 編集導線は WikiBanner 側で「Archived」表示にして抑制する。
              setListSidePeekNoteId(isWiki ? `wiki:${noteId}` : noteId);
            }}
            archivedMedia={fm.mediaIndex?.media.filter((m) => m.archivedAt) ?? []}
            onRestoreMedia={fm.handleRestoreMedia}
            onPermanentDeleteMedia={fm.handleDeleteMedia}
            trashedMemos={capture.captureIndex ? getTrashedCaptures(capture.captureIndex) : []}
            archivedMemos={capture.captureIndex ? getArchivedCaptures(capture.captureIndex) : []}
            onRestoreMemo={capture.handleRestoreCaptureFromTrash}
            onPermanentDeleteMemo={capture.handlePermanentDeleteCapture}
            onRestoreMemoFromArchive={capture.handleRestoreCaptureFromArchive}
            onSendMemoArchiveToTrash={capture.handleSendCaptureArchiveToTrash}
          />
        ) : showSkillList ? (
          <SkillListView
            skillFiles={fm.skillFiles}
            skillMetas={fm.skillMetas}
            onOpenSkill={(skillId) => { setShowSkillList(false); fm.handleOpenSkillFile(skillId); }}
            onOpenSkillFull={(skillId) => { setShowSkillList(false); fm.handleOpenSkillFile(skillId); }}
            onBack={() => setShowSkillList(false)}
            onDeleteSkill={async (skillId) => {
              const meta = fm.skillMetas.get(skillId);
              if (meta?.systemSkillId) {
                alert(tStatic("skill.cannotDeleteSystem"));
                return;
              }
              await fm.handleDeleteSkillFile(skillId);
            }}
            onNewSkill={() => setShowNewSkillDialog(true)}
            onEditSkill={(skillId) => setEditingSkillId(skillId)}
            onResetSystemSkill={fm.handleResetSystemSkill}
          />
        ) : !isDesktop && !fm.activeFileId ? (
          /* モバイル: ノート未選択時はクイックキャプチャビューを表示 */
          <MobileCaptureView
            captureIndex={capture.captureIndex}
            mediaIndex={fm.mediaIndex}
            loading={capture.captureLoading}
            onCreateCapture={capture.handleCreateCapture}
            onDeleteCapture={capture.handleDeleteCapture}
            onEditCapture={capture.handleEditCapture}
            onUploadMedia={fm.handleUploadMedia}
            onAddUrlBookmark={fm.handleAddUrlBookmark}
            onRefresh={async () => {
              await Promise.all([capture.refreshCaptures(), fm.refreshMediaIndex()]);
            }}
            creating={capture.capturing}
          />
        ) : (
          <>
          {/* Skill バナー（Skill ドキュメントの場合）— D0 配置: タイトルバーの上 */}
          {fm.activeDoc?.source === "skill" && fm.activeDoc?.skillMeta && (
            <SkillBanner
              availableForIngest={fm.activeDoc.skillMeta.availableForIngest}
              onEdit={() => {
                const id = fm.activeFileId?.replace(/^skill:/, "");
                if (id) setEditingSkillId(id);
              }}
            />
          )}
          {/* Wiki バナー（AI 生成ドキュメントの場合）— D0 配置: タイトルバーの上
              2026-05-22 議論で D1 (subHeaderSlot 経由) を試したが、右パネル展開時に
              banner と title bar の段組が崩れて見えたため D0 に戻す。
              いずれ D2 (タイトルバーに identity を寄せて、context drawer は本文下に
              展開) を検討する。NoteEditor 側の subHeaderSlot プロップは
              D2 / 将来の sub-header 用に残してある。 */}
          {fm.activeDoc?.source === "ai" && fm.activeDoc?.wikiMeta && (() => {
            const wikiIdForBanner = fm.activeFileId?.replace(/^wiki:/, "") ?? null;
            const isArchived = wikiIdForBanner ? fm.archivedIdSet.has(wikiIdForBanner) : false;
            return (
              <WikiBanner
                wikiMeta={fm.activeDoc.wikiMeta}
                loading={ingestToast?.items?.some((i) => i.id?.startsWith("regen:") && i.status === "generating")}
                archived={isArchived}
                onRestoreFromArchive={isArchived && wikiIdForBanner
                  ? () => fm.handleRestoreFromArchive(wikiIdForBanner)
                  : undefined}
                onRegenerate={() => {
                  if (!fm.activeDoc?.wikiMeta || !fm.activeFileId) return;
                  const wikiId = fm.activeFileId.replace("wiki:", "");
                  void regenerateWikiById(wikiId, { openAfter: true });
                }}
                onDelete={() => {
                  if (!fm.activeFileId) return;
                  const wikiId = fm.activeFileId.replace("wiki:", "");
                  const title = fm.activeDoc?.title ?? wikiId;
                  fm.handleDeleteWikiFile(wikiId);
                  wikiLog.append("delete", [wikiId], `Deleted "${title}"`).catch(() => {});
                }}
                onCheckWorldValidity={
                  fm.activeDoc.wikiMeta.kind === "summary" || !wikiIdForBanner
                    ? undefined
                    : () => void handleWorldCheckWiki(wikiIdForBanner, "manual")
                }
                worldCheckLoading={
                  wikiIdForBanner !== null && worldCheckingWikiId === wikiIdForBanner
                }
              />
            );
          })()}
          <NoteEditor
            key={fm.editorKey}
            provLabelsEnabled={provLabelsEnabled}
            fileId={fm.activeFileId?.replace("wiki:", "").replace("skill:", "") ?? fm.activeFileId}
            initialDoc={fm.activeDoc}
            onDeleteContextEverywhere={handleDeleteContextEverywhere}
            contextDrawerSlot={
              fm.activeDoc?.source === "ai" && fm.activeDoc?.wikiMeta
                ? (() => {
                    const wikiIdForDrawer = fm.activeFileId?.replace(/^wiki:/, "") ?? null;
                    const isArchivedDrawer = wikiIdForDrawer
                      ? fm.archivedIdSet.has(wikiIdForDrawer)
                      : false;
                    return (
                      <WikiContextDrawer
                        wikiMeta={fm.activeDoc.wikiMeta}
                        noteIndex={fm.noteIndex}
                        mediaIndex={fm.mediaIndex}
                        archived={isArchivedDrawer}
                        onNavigateNote={(noteId: string) => {
                          // WikiBanner と同じく SidePeek で開く（ref 未登録時は全画面遷移）。
                          const openSidePeek = openSidePeekRef.current;
                          if (openSidePeek) {
                            openSidePeek(noteId);
                            return;
                          }
                          if (noteId.startsWith("wiki:")) {
                            fm.handleOpenWikiFile(noteId.replace("wiki:", ""));
                          } else {
                            fm.handleOpenFile(noteId);
                          }
                        }}
                        onOpenMemo={handleOpenMemoSource}
                        onClearWorldValidity={
                          wikiIdForDrawer
                            ? () => void handleClearWorldValidity(wikiIdForDrawer)
                            : undefined
                        }
                        wikiId={wikiIdForDrawer ?? undefined}
                        allWikiMetas={fm.wikiMetas}
                      />
                    );
                  })()
                : undefined
            }
            archived={(() => {
              const rawId = fm.activeFileId?.replace(/^(wiki|skill):/, "");
              return rawId ? fm.archivedIdSet.has(rawId) : false;
            })()}
            onRestoreFromArchive={(() => {
              const rawId = fm.activeFileId?.replace(/^(wiki|skill):/, "");
              // 復元後はそのまま開いたままにする（archivedIdSet 更新でバナーが消え編集可に戻る）
              return rawId ? () => fm.handleRestoreFromArchive(rawId) : undefined;
            })()}
            isArchived={(noteId: string) => fm.archivedIdSet.has(noteId.replace(/^(wiki|skill):/, ""))}
            onRestoreArchivedById={(noteId: string) => fm.handleRestoreFromArchive(noteId.replace(/^(wiki|skill):/, ""))}
            trashed={(() => {
              const rawId = fm.activeFileId?.replace(/^(wiki|skill):/, "");
              return rawId ? fm.trashedIdSet.has(rawId) : false;
            })()}
            onRestoreFromTrash={(() => {
              const rawId = fm.activeFileId?.replace(/^(wiki|skill):/, "");
              // 復元後はそのまま開いたままにする（trashedIdSet 更新でバナーが消え編集可に戻る）
              return rawId ? () => fm.handleRestore(rawId) : undefined;
            })()}
            isTrashed={(noteId: string) => fm.trashedIdSet.has(noteId.replace(/^(wiki|skill):/, ""))}
            onRestoreTrashedById={(noteId: string) => fm.handleRestore(noteId.replace(/^(wiki|skill):/, ""))}
            onSave={fm.activeDoc?.source === "ai"
              ? (doc: GraphiumDocument) => {
                  const wikiId = fm.activeFileId?.replace("wiki:", "");
                  if (wikiId) fm.handleSaveWikiFile(wikiId, doc);
                }
              : fm.activeDoc?.source === "skill"
              ? (doc: GraphiumDocument) => {
                  const skillId = fm.activeFileId?.replace("skill:", "");
                  if (skillId) fm.handleSaveSkillFile(skillId, doc);
                }
              : fm.handleSave}
            onDeriveNote={fm.handleDeriveNote}
            onCreateLinkedNote={fm.handleCreateLinkedNote}
            onDeriveWholeNote={fm.handleDeriveWholeNote}
            // スキルでは「版から派生」は不自然（新ノートができてしまう）ので出さず、
            // 代わりに「この版に戻す」を出す。ノートは従来どおり派生のみ。
            onDeriveSnapshot={fm.activeDoc?.source === "skill" ? undefined : fm.handleDeriveFromSnapshot}
            onRestoreSnapshot={fm.activeDoc?.source === "skill" ? async (snapshotId: string) => {
              const skillId = fm.activeFileId?.replace("skill:", "");
              const current = fm.activeDoc;
              if (!skillId || !current) return;
              if (!window.confirm(t("version.restoreConfirm"))) return;
              try {
                const provider = getActiveProvider();
                const snapDoc = await loadSnapshot(provider, snapshotId);
                if (!snapDoc) return;
                let restored = buildRestoredDocument(current, snapDoc);
                const email = await provider.getUserEmail() ?? undefined;
                const author = loadAuthorIdentity() ?? undefined;
                restored = await recordRevision(restored, current.pages[0] ?? null, "snapshot_restore", { force: true, email, author });
                await fm.handleSaveSkillFile(skillId, restored);
                // cache は保存で更新済みなので、開き直しでエディタを新内容で再マウントする
                fm.handleOpenSkillFile(skillId);
              } catch (e) {
                console.error("版の復元に失敗:", e);
              }
            } : undefined}
            derivingDisabled={fm.deriving}
            onDeleteNote={fm.activeFileId && fm.activeDoc?.source !== "ai" ? () => {
              const id = fm.activeFileId!;
              if (fm.rawNoteIndex) {
                const refs = findIncomingReferences(fm.rawNoteIndex, id);
                if (refs.length > 0) {
                  const ok = window.confirm(
                    t("nav.refsTrashWarn", { count: String(refs.length) })
                  );
                  if (!ok) return;
                }
              }
              fm.handleDelete(id);
              router.navigate({ view: "home" });
            } : undefined}
            onArchiveNote={fm.activeFileId && fm.activeDoc?.source !== "ai" ? () => {
              // アーカイブは派生リンクを守るのが目的なので、削除と違い参照警告は出さない。
              const id = fm.activeFileId!;
              fm.handleArchiveNote(id);
              router.navigate({ view: "home" });
            } : undefined}
            onAiDeriveNote={async (doc) => {
              // 派生先ノートは SidePeek で開く（@mention / ノートリンク経路と同じ）。
              // ref が登録されていない（NoteEditorInner 未マウント等）場合は全画面遷移にフォールバック。
              const newFileId = await fm.handleAiDeriveNote(doc);
              const openSidePeek = openSidePeekRef.current;
              if (openSidePeek) {
                openSidePeek(newFileId);
              } else {
                fm.handleOpenFile(newFileId);
              }
              return newFileId;
            }}
            onCreateKnowledgeNote={aiUiEnabled ? async (doc, kind) => {
              // R2 / Loop M2: AI 回答を 知見(claim) / 洞察(atom) として手動取り込み。
              // handleCreateWikiFile が PROV リビジョン記録まで行う。洞察は他の
              // atomize 経路（自動/手動 discovery）と分類を揃えて wiki_atomize にする。
              const newId = await fm.handleCreateWikiFile(doc, {
                activityType: kind === "atom" ? "wiki_atomize" : "wiki_ingest",
              });
              embedWikiSections(newId, doc).catch(() => {});
              wikiLog.append("ingest", [newId], `${kind}: "${doc.title}"`).catch(() => {});
              // 取り込んだノートは SidePeek で開いて即確認できるようにする。
              const openSidePeek = openSidePeekRef.current;
              if (openSidePeek) openSidePeek(`wiki:${newId}`);
              return newId;
            } : undefined}
            onNavigateNote={(noteId: string, cachedDoc?: import("./lib/document-types").GraphiumDocument) => {
              if (noteId.startsWith("wiki:")) {
                fm.handleOpenWikiFile(noteId.replace("wiki:", ""));
              } else {
                fm.handleOpenFile(noteId, cachedDoc);
              }
            }}
            onOpenMedia={(fileId: string) => {
              // ノート右パネルのグラフから素材ノードクリック → Material gallery に切り替え
              // て該当 fileId を Full view で開く（旧 blob: open に代わる導線）。
              const target = fm.mediaIndex?.media.find((m) => m.fileId === fileId);
              if (!target) {
                console.error("メディアが見つかりません:", fileId);
                return;
              }
              fm.setActiveAssetType(target.type);
              setFocusedMaterial({ fileId, fullMode: true });
              router.navigate({ view: "assets", mediaType: target.type });
            }}
            onOpenMemoSource={handleOpenMemoSource}
            getCachedDoc={fm.getCachedDoc}
            onRefreshFiles={fm.refreshFiles}
            saving={fm.saving}
            files={fm.files}
            noteGraphData={fm.noteGraphData}
            lineageTree={fm.lineageTree}
            sourceDoc={fm.sourceDoc}
            onSourceDocChange={fm.setSourceDoc}
            noteIndex={fm.noteIndex}
            rawNoteIndex={fm.rawNoteIndex}
            uploadFile={fm.handleUploadMedia}
            uploadAsset={fm.handleUploadAsset}
            mediaIndex={fm.mediaIndex}
            onAddUrlBookmark={fm.handleAddUrlBookmark}
            pendingMemoInsert={pendingMemoInsert}
            onMemoInserted={() => {
              if (!pendingMemoInsert) return;
              const { captureId, deleteAfter } = pendingMemoInsert;
              // usedIn を記録
              if (fm.activeFileId && fm.activeDoc) {
                capture.handleRecordUsage(captureId, fm.activeFileId, fm.activeDoc.title);
              }
              // 削除オプション
              if (deleteAfter) {
                capture.handleDeleteCapture(captureId);
              }
              setPendingMemoInsert(null);
            }}
            captureIndex={capture.captureIndex}
            onCreateNoteMemo={async (text, block) => {
              // 右パネル「Memos」タブ / ブロックメニュー「メモ」からの新規メモ。
              // sourceNote にノートの fileId とタイトルスナップショットを付与する。
              // block があればブロック紐付け（blockId + テキスト抜粋）も記録する。
              if (!fm.activeFileId) return;
              await capture.handleCreateCapture(text, undefined, {
                fileId: fm.activeFileId,
                title: fm.activeDoc?.title,
                ...(block
                  ? { blockId: block.blockId, blockText: block.blockText }
                  : {}),
              });
            }}
            onDeleteNoteMemo={capture.handleDeleteCapture}
            onEditorRef={(editor) => { noteEditorRef.current = editor; }}
            isWikiDoc={fm.activeDoc?.source === "ai"}
            aiAvailable={aiAvailable ?? false}
            agentConfigured={agentConfigured}
            onOpenComposer={composer.openComposer}
            composerSubmitRef={composerSubmitRef}
            onPeekSaved={fm.reindexNoteFromDoc}
            onPropagateMentionRename={fm.propagateMentionRename}
            openSidePeekRef={openSidePeekRef}
            openMaterialPeekRef={openMaterialPeekRef}
            composerCitationRef={composerCitationRef}
            chatRunApplyRef={chatRunApplyRef}
            skillPrompts={(() => {
              // チャットは ja デフォルト（既存ロジックに揃える。将来 i18n 設定で切替）
              const skills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), getLocale());
              if (skills.length === 0) return undefined;
              return buildSkillPromptSection(skills);
            })()}
            onIngestToWiki={aiUiEnabled && fm.activeDoc?.source !== "ai" ? () => {
              if (!fm.activeFileId || !fm.activeDoc) return;
              enqueueIngest(fm.activeFileId, fm.activeDoc.title, fm.activeDoc);
            } : undefined}
            onIngestFromUrl={aiUiEnabled ? () => {
              // AI 未設定なら URL 入力の前に止める（トースト + 設定 AI タブ導線はヘルパー側）
              if (!ensureAgentConfigured()) return;
              const url = prompt(tStatic("ingest.enterUrl"));
              if (!url) return;
              // toast の追跡には一意な ID、wiki の sourceNoteId には URL ベースの安定 ID
              // を使い分ける。後者で逆引きが効くようにする。
              const jobId = `url-toast:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
              const sourceNoteId = `url:${url}`;
              const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: url };
              ingestQueueRef.current.push({ noteId: jobId, noteTitle: url, doc: null as any });
              setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
              // キュー処理とは別に直接実行（doc が null なので通常のキュー処理は使えない）
              (async () => {
                setIngestToast((prev) => ({
                  items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Fetching URL..." } : i),
                }));
                try {
                  const existingWikis = (fm.noteIndex?.notes ?? [])
                    .filter((n) => n.source === "ai" && n.wikiKind)
                    .map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                  const result = await ingestFromUrl(url, existingWikis, getLocale());
                  if (result.wikis.length === 0) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "error" as const, result: tStatic("ingest.insufficientContent") } : i) }));
                    ingestQueueRef.current = ingestQueueRef.current.filter((j) => j.noteId !== jobId);
                    return;
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "saving" as const, detail: `${result.wikis.length} wiki(s)` } : i) }));
                  for (const wiki of result.wikis) {
                    const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, url, undefined, getLocale(), buildNoteIndex(fm.noteIndex));
                    const newId = await fm.handleCreateWikiFile(wikiDoc);
                    embedWikiSections(newId, wikiDoc).catch(() => {});
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "success" as const, detail: undefined, result: `${result.wikis.length} wiki(s)` } : i) }));
                } catch (err) {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                }
                ingestQueueRef.current = ingestQueueRef.current.filter((j) => j.noteId !== jobId);
              })();
            } : undefined}
            onIngestChat={aiUiEnabled ? (chatMessages) => {
              // AI 未設定なら発火させない（トースト + 設定 AI タブ導線はヘルパー側）
              if (!ensureAgentConfigured()) return;
              const jobId = `chat:${Date.now()}`;
              const chatTitle = chatMessages[0]?.content.slice(0, 30) ?? "Chat";
              const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: `Chat: ${chatTitle}` };
              setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
              (async () => {
                setIngestToast((prev) => ({
                  items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Extracting knowledge..." } : i),
                }));
                try {
                  const existingWikis = (fm.noteIndex?.notes ?? [])
                    .filter((n) => n.source === "ai" && n.wikiKind)
                    .map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                  const result = await ingestFromChat(chatMessages, chatTitle, existingWikis, getLocale());
                  if (result.wikis.length === 0) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: tStatic("ingest.insufficientContent") } : i) }));
                    return;
                  }
                  for (const wiki of result.wikis) {
                    const wikiDoc = buildWikiDocument(wiki, jobId, result.model, chatTitle, undefined, getLocale(), buildNoteIndex(fm.noteIndex));
                    const newId = await fm.handleCreateWikiFile(wikiDoc);
                    embedWikiSections(newId, wikiDoc).catch(() => {});
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                } catch (err) {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: localizeAiError(err) } : i) }));
                }
              })();
            } : undefined}
            provWikiEntities={provWikiEntities}
          />
          </>
        )}
        {/* Ingest トースト通知 */}
        <IngestToast
          state={ingestToast}
          onDismiss={() => setIngestToast(null)}
          onStop={() => {
            // 進行中の fetch を切る（→ サーバー側の LLM 呼び出しも止まる）。
            // 残りのキューは processIngestQueue 側が signal.aborted を見て畳む。
            ingestAbortRef.current?.abort();
          }}
        />
        {/* 派生ノート作成中のオーバーレイ */}
        {fm.deriving && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
            <div className="text-center space-y-2">
              <div className="text-sm font-medium text-foreground">{t("derive.creating")}</div>
              <div className="text-xs text-muted-foreground">{t("derive.savingToDrive")}</div>
            </div>
          </div>
        )}
      </main>
      {/* 一覧ビュー用サイドピーク（NoteEditorInner 外で表示） */}
      {listSidePeekNoteId && (
        <AiAssistantProvider aiAvailable={false}>
          <ListSidePeekBoundary onClose={() => setListSidePeekNoteId(null)}>
            <SidePeek
              // ノート切替で丸ごと作り直す（前ノートの本文で上書きするデータ破壊を防ぐ）
              key={listSidePeekNoteId}
              noteId={listSidePeekNoteId}
              cachedDoc={fm.getCachedDoc?.(listSidePeekNoteId) ?? undefined}
              getCachedDoc={fm.getCachedDoc}
              onSaved={handleListPeekSaved}
              onOpenMaterialPeek={(entry) => {
                // ピーク内の素材リンク（URL/@素材）→ 素材サイドピークへ切り替える
                setListSidePeekNoteId(null);
                setListMaterialPeekEntry(entry);
              }}
              onOpenMemoSource={handleOpenMemoSource}
              archived={(() => {
                const rawId = listSidePeekNoteId.replace(/^(wiki|skill):/, "");
                return fm.archivedIdSet.has(rawId);
              })()}
              onRestoreFromArchive={(() => {
                const rawId = listSidePeekNoteId.replace(/^(wiki|skill):/, "");
                return fm.archivedIdSet.has(rawId)
                  ? () => fm.handleRestoreFromArchive(rawId)
                  : undefined;
              })()}
              trashed={(() => {
                const rawId = listSidePeekNoteId.replace(/^(wiki|skill):/, "");
                return fm.trashedIdSet.has(rawId);
              })()}
              onRestoreFromTrash={(() => {
                const rawId = listSidePeekNoteId.replace(/^(wiki|skill):/, "");
                return fm.trashedIdSet.has(rawId)
                  ? () => fm.handleRestore(rawId)
                  : undefined;
              })()}
              mediaIndex={fm.mediaIndex ?? null}
              captureIndex={capture.captureIndex ?? null}
              uploadFile={fm.handleUploadMedia}
              onAddUrlBookmark={fm.handleAddUrlBookmark}
              noteIndex={fm.noteIndex ?? null}
              onCreateLinkedNote={fm.handleCreateLinkedNote}
              onOpenNoteInPeek={(peekId) => setListSidePeekNoteId(peekId)}
              onClose={() => setListSidePeekNoteId(null)}
              onNavigate={(noteId, savedDoc) => {
                setListSidePeekNoteId(null);
                // 上位のリスト／オーバーレイビュー（スキル一覧・知見一覧・ゴミ箱など）を
                // 全て畳んでから本文へ遷移する。1 つでも残すと activeFileId が変わっても
                // そのビューが優先表示され、「最大化したのに別の一覧が出る」バグになる
                // （例: スキル一覧を開いた後にノートを最大化するとスキル一覧が残る）。
                closeAllViews();
                if (noteId.startsWith("wiki:")) {
                  fm.handleOpenWikiFile(noteId.replace(/^wiki:/, ""));
                } else {
                  fm.handleOpenFile(noteId, savedDoc);
                }
                router.navigate({ view: "editor", fileId: noteId });
              }}
              onNoteContextsChange={(id, doc) => fm.reindexNoteFromDoc(id, doc)}
              onDeleteContextEverywhere={handleDeleteContextEverywhere}
              wikiEntries={appKnowledgeMap.get(listSidePeekNoteId) ?? []}
              onAddToKnowledge={
                aiUiEnabled && !listSidePeekNoteId.startsWith("wiki:")
                  ? () => {
                      // 一覧→ピークのフローでは fm.cachedDocs に doc が乗っていないことが
                      // ある（SidePeek が独自にロードするため）ので、未キャッシュ時は
                      // storage provider から直接ロードしてから ingest する。
                      const cached = fm.getCachedDoc?.(listSidePeekNoteId);
                      if (cached && cached.source !== "ai") {
                        enqueueIngest(listSidePeekNoteId, cached.title, cached);
                        return;
                      }
                      void getActiveProvider()
                        .loadFile(listSidePeekNoteId)
                        .then((doc) => {
                          if (doc.source === "ai") return;
                          enqueueIngest(listSidePeekNoteId, doc.title, doc);
                        })
                        .catch((err) => {
                          console.error("[SidePeek] Add to Knowledge load failed:", err);
                        });
                    }
                  : undefined
              }
            />
          </ListSidePeekBoundary>
        </AiAssistantProvider>
      )}
      {/* 一覧・全体グラフ用の素材サイドピーク（NoteEditorInner 外で表示） */}
      {listMaterialPeekEntry && (
        <MaterialSidePeek
          entry={listMaterialPeekEntry}
          onClose={() => setListMaterialPeekEntry(null)}
          mediaIndex={fm.mediaIndex ?? null}
          onRegisterAsset={listPeekUrlUnregistered ? handleRegisterUrlFromListPeek : undefined}
          onToggleFull={
            // 登録済み素材のみ Full view へ昇格できる（アドホック URL entry は gallery に実体が無い）
            fm.mediaIndex?.media.some((m) => m.fileId === listMaterialPeekEntry.fileId)
              ? () => {
                  const target = fm.mediaIndex?.media.find(
                    (m) => m.fileId === listMaterialPeekEntry.fileId,
                  );
                  if (!target) return;
                  setListMaterialPeekEntry(null);
                  closeAllViews();
                  fm.setActiveAssetType(target.type);
                  setFocusedMaterial({ fileId: target.fileId, fullMode: true });
                  router.navigate({ view: "assets", mediaType: target.type });
                }
              : undefined
          }
          onOpenNoteInSidePeek={(noteId) => {
            // 素材ピーク内の利用ノードクリック → ノートの SidePeek に切り替える
            setListMaterialPeekEntry(null);
            setListSidePeekNoteId(noteId);
          }}
          onNavigateNote={(noteId) => {
            setListMaterialPeekEntry(null);
            setListSidePeekNoteId(null);
            closeAllViews();
            // MediaUsage.noteId は Wiki の場合 `wiki:{id}` prefix で格納されている。
            if (noteId.startsWith("wiki:")) fm.handleOpenWikiFile(noteId.slice(5));
            else fm.handleOpenFile(noteId);
          }}
        />
      )}
      {showReleaseNotes && (
        <ReleaseNotesPanel onClose={() => setShowReleaseNotes(false)} />
      )}
      <WelcomeDialog />
      <SettingsModal
        isOpen={showSettings}
        initialTab={settingsInitialTab}
        onClose={() => {
          setShowSettings(false);
          setSettingsInitialTab(undefined);
          void checkAiReadiness();
          setExperimentalFlags(loadSettings().experimental);
        }}
        wikiSummaries={wikiSummariesForSettings}
        onRegenerateWiki={(wikiId, options) => regenerateWikiById(wikiId, { model: options?.model, openAfter: false })}
        onRunAtomizeDiscovery={runAtomizeDiscovery}
        onReembedAllWikis={async (onProgress) => {
          // 全 Wiki を順次 embed し直す。キャッシュにない wiki は storage から読み出す。
          const { getActiveProvider } = await import("./lib/storage/registry");
          const provider = getActiveProvider();
          const total = fm.wikiFiles.length;
          let successCount = 0;
          let failCount = 0;
          for (let i = 0; i < total; i++) {
            const wf = fm.wikiFiles[i];
            try {
              let doc = fm.getCachedDoc(`wiki:${wf.id}`);
              if (!doc && provider.loadWikiFile) {
                doc = await provider.loadWikiFile(wf.id);
              }
              if (doc) {
                await embedWikiSections(wf.id, doc);
                successCount++;
              } else {
                failCount++;
                console.warn(`re-embed: doc not found for ${wf.id}`);
              }
            } catch (e) {
              failCount++;
              console.warn(`re-embed failed for ${wf.id}`, e);
            }
            onProgress(i + 1, total);
          }
          console.log(`Re-embed complete: ${successCount} success / ${failCount} failed / ${total} total`);
        }}
      />
      <Composer
        open={composer.open}
        mode={composer.mode}
        onModeChange={composer.setMode}
        prompt={composerPrompt}
        onPromptChange={setComposerPrompt}
        onSubmit={handleComposerSubmit}
        onClose={composer.closeComposer}
        discoveryCards={composerDiscoveryCards}
        onDiscoveryCardSelect={handleComposerCardSelect}
        noteIndex={fm.noteIndex ?? null}
        onNoteSelect={handleComposerNoteSelect}
        mediaIndex={fm.mediaIndex ?? null}
        onMediaSelect={handleComposerMediaSelect}
        citationCount={composerCitationCount}
        canAskAi={composerCanAskAi}
      />
      {showNewSkillDialog && (
        <SkillDialog
          mode="create"
          onClose={() => setShowNewSkillDialog(false)}
          onSubmit={async ({ title, description, availableForIngest, language }) => {
            const doc = buildSkillDocument(title, description, "", availableForIngest, language ? { language } : undefined);
            const newId = await fm.handleCreateSkillFile(doc);
            setShowNewSkillDialog(false);
            setShowSkillList(false);
            fm.handleOpenSkillFile(newId);
          }}
        />
      )}
      {editingSkillId && (() => {
        const id = editingSkillId;
        const meta = fm.skillMetas.get(id);
        if (!meta) return null;
        return (
          <SkillDialog
            mode="edit"
            initial={{
              title: meta.title,
              description: meta.description,
              availableForIngest: meta.availableForIngest,
              language: meta.language,
            }}
            onClose={() => setEditingSkillId(null)}
            onSubmit={async (values) => {
              await fm.handleUpdateSkillMeta(id, values);
              setEditingSkillId(null);
            }}
          />
        );
      })()}
      {showQuickMemoDialog && (
        <CaptureDialog
          variant={isDesktop ? "centered" : "fullscreen"}
          onSubmit={async (text) => {
            await capture.handleCreateCapture(text);
            setShowQuickMemoDialog(false);
          }}
          onClose={() => setShowQuickMemoDialog(false)}
          submitting={capture.capturing}
        />
      )}
      </div>
    </div>
  );
}
