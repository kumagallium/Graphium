// ノートアプリのメイン画面
// Google Drive と連携してノートの作成・保存・読み込みを行う

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Save, FileDown, Share2, MoreHorizontal, Network, GitBranch, MessageSquare, History, FileText, PanelLeftOpen, BookPlus, BookOpen, Trash2 } from "lucide-react";
import { apiBase, isTauri } from "./lib/platform";
import { ensureSidecar } from "./lib/sidecar";
import { SandboxEditor } from "./base/editor";
import { pdfViewerBlock } from "./blocks/pdf-viewer";
import { bookmarkBlock, bookmarkSlashItem, setBookmarkPickerCallback } from "./blocks/bookmark";
import {
  LabelStoreProvider,
  useLabelStore,
  LabelDropdownPortal,
} from "./features/context-label";
import {
  MediaInlineLabelProvider,
  useMediaInlineLabelStore,
} from "./features/inline-label/media-store";
import { regenInlineEntitiesInBlocks } from "./features/inline-label/regen-on-paste";
import {
  ProvIndicatorLayer,
  ProvIndicatorHoverHint,
  BlockHoverHighlight,
  ScopeHighlight,
  setOnPrevStepLinkSelected,
} from "./features/context-label/prov-indicator";
import {
  buildLabelSlashMenuItems,
  setSlashMenuLabelCallback,
} from "./features/context-label/slash-menu-items";
import {
  IndexTableStoreProvider,
  useIndexTableStore,
  IndexTableIconLayer,
  indexTableSlashItem,
  setIndexTableCallbacks,
  setRegisterIndexTableCallback,
} from "./features/index-table";
import { SidePeek } from "./features/index-table/side-peek";
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
} from "./features/block-link/mention-menu";
import {
  ProvGraphPanel,
} from "./features/prov-generator";
import {
  GraphLinksPanel,
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
import type { AgentChatMessage } from "./features/ai-assistant";
import { extractLabelMarkersFromBlocks } from "./features/ai-assistant/label-markers";
import { SettingsModal, isAgentConfigured, getSelectedModel, getDisabledTools, getChatSynthesisLLMModel, getChatSynthesisModelName, loadSettings, isAtomLayerEnabled, isSynthesisEnabled, type ExperimentalSettings } from "./features/settings";
import { useStorage } from "./lib/storage/use-storage";
import { getActiveProvider } from "./lib/storage/registry";
import type { GraphiumDocument, NoteLink } from "./lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "./lib/document-migration";
import { recordRevision, detectActivityType } from "./features/document-provenance/tracker";
import { loadAuthorIdentity } from "./features/identity";
import { getSharedRoot, getBlobRoot } from "./lib/storage/shared";
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
import { NoteListView, TrashView, buildKnowledgeMap, findIncomingReferences, type GraphiumIndex, type NoteIndexEntry } from "./features/navigation";
import { useHashRouter, type AppRoute, type RouteActions } from "./hooks/use-hash-router";
import {
  WikiListView, WikiLogView, WikiLintView, WikiBanner,
  IngestToast, type IngestToastState, type IngestToastItem, type IngestStage, type IngestStageStatus,
  ingestNote, ingestFromUrl, ingestFromChat, ingestFromPdf, ingestFromMultiSource,
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
  fetchSynthesisCandidates, buildSynthesisDocument, buildClaimSnapshots, MAX_SNAPSHOTS_PER_RUN,
  type ClaimSnapshot,
  type AtomCandidate, getDocEmbedding, pickFarthestSeeds, buildClusterSlice, pickClusterCount,
  rankCandidatesByRelevance,
  // Atom（実験的）
  atomizeConcepts, buildAtomDocument,
  // Discovery 共通: embedding ベース重複検出
  dedupCandidatesByEmbedding,
  // インライン引用リンク
  buildNoteIndex,
  // 操作ログ
  wikiLog,
} from "./features/wiki";
import { setWikiIndexForRetriever, setWikiTitleMap } from "./features/wiki/retriever";
import { KnowledgeStatusChip } from "./features/wiki/KnowledgeStatusChip";
import { ingestUrlToProv, ingestPdfToProv, buildProvNoteDocument } from "./features/url-to-prov";
import { SkillListView, SkillBanner, NewSkillDialog, buildSkillDocument, extractSkillPrompt, buildSkillPromptSection, pickActiveSkills } from "./features/skill";
import type { WikiKind } from "./lib/document-types";
import { MobileCaptureView, MemoGalleryView, MemoPickerModal, getMemoSlashMenuItem, setMemoPickerCallback, CaptureDialog } from "./features/mobile-capture";
import { TemplatePickerModal, getTemplateSlashMenuItem, setTemplatePickerCallback, getAllTemplates } from "./features/template";
import type { CaptureEntry } from "./features/mobile-capture";
import {
  AssetGalleryView,
  LabelGalleryView,
  MediaPickerModal,
  getMediaSlashMenuItems,
  setMediaPickerCallback,
  DEFAULT_MEDIA_SLASH_TITLES,
  UrlPasteMenu,
  generateUrlBookmarkId,
  getFaviconUrl,
  extractDomain,
  fetchUrlMetadata,
  type MediaType,
  findBlockIdsByMediaUrl,
  type MediaIndexEntry,
} from "./features/asset-browser";
import { extractEmbeddedPdfImages, embeddedImageToFile } from "./features/asset-browser/pdf-image-extractor";
import { useT, t as tStatic, getLocale } from "./i18n";
import { exportNoteToPdf } from "./features/pdf-export";
import { exportProvJsonLd, type WikiEntityInfo } from "./features/prov-export";

// hooks
import { useAutoSave } from "./hooks/use-auto-save";
import { useProvGeneration } from "./hooks/use-prov-generation";
import { useFileManager } from "./hooks/use-file-manager";
import { useCapture } from "./hooks/use-capture";

// components
import { WelcomeDialog } from "./components/WelcomeDialog";
import { FileSidebar } from "./components/FileSidebar";
import { NoteSideMenu, collectHeadingScope, setOpenLinkDropdownFn } from "./components/side-menu";
import { NoteFormattingToolbar } from "./components/formatting-toolbar";
import { SourceDocPanel, extractBlockTitle } from "./components/SourceDocPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { MobileHeader } from "./components/MobileHeader";
import { Sheet } from "./ui/sheet";
import { useIsDesktop } from "./hooks/use-media-query";
import { Composer, useComposer, type ComposerSubmission, type DiscoveryCard } from "./features/composer";
import { buildDiscoveryCards, promptForDiscoveryCard } from "./features/composer/discovery-cards";
import type { WikiLogEntry } from "./features/wiki/wiki-log";
import { EmptyNoteGuide } from "./features/onboarding";

import type { GraphiumFile } from "./lib/document-types";
import type { NoteGraphData, LineageNode } from "./features/network-graph";

// ── ヘッダーメニュー（Notion 風ドロップダウン） ──
function NoteHeaderMenu({
  onSave,
  saveDisabled,
  onExportPdf,
  pdfExporting,
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
  onDelete,
  deleteDisabled,
  onShare,
  shareDisabled,
  isShared,
  shareBusy,
  shareDisabledReason,
  t,
}: {
  onSave: () => void;
  saveDisabled: boolean;
  onExportPdf: () => void;
  pdfExporting: boolean;
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
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
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
            disabled={provExportDisabled}
            onClick={() => { onExportProvJsonLd(); setOpen(false); }}
          >
            <Share2 size={14} />
            {t("prov.export")}
          </button>
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
          {onDelete && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={`${itemClass} text-destructive hover:bg-destructive/10`}
                disabled={deleteDisabled}
                onClick={() => { onDelete(); setOpen(false); }}
              >
                <Trash2 size={14} />
                {t("editor.deleteNote")}
              </button>
            </>
          )}
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
  onAiDeriveNote: (doc: GraphiumDocument) => Promise<void>;
  onNavigateNote: (noteId: string, cachedDoc?: GraphiumDocument) => void;
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
  /** メディアアップロード関数（メディアインデックス自動登録付き） */
  uploadFile?: (file: File) => Promise<string>;
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
  /** エディタ参照を親に伝播するコールバック */
  onEditorRef?: (editor: any) => void;
  /** Knowledge に追加コールバック */
  onIngestToWiki?: () => void;
  /** URL から Knowledge コールバック */
  onIngestFromUrl?: () => void;
  /** ノート全体を派生コールバック（ヘッダーメニューから呼ばれる） */
  onDeriveWholeNote?: () => void;
  /** 派生処理中（ボタンを無効化） */
  derivingDisabled?: boolean;
  /** ノート削除（ゴミ箱送り）コールバック。ヘッダーメニューから呼ばれる */
  onDeleteNote?: () => void;
  /** チャットから Knowledge コールバック（手動） */
  onIngestChat?: (messages: import("./lib/document-types").ChatMessage[]) => void;
  /** Wiki ドキュメントかどうか */
  isWikiDoc?: boolean;
  /** AI バックエンドが利用可能か（false なら Chat タブを非表示） */
  aiAvailable?: boolean;
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
  /** Phase 4: PROV-JSON-LD エクスポートに含める Wiki Knowledge Layer のメタ。
   *  NoteApp が wiki state から組み立てて渡す。空配列 / undefined のときは
   *  Wiki Entity を出力しない（ノートの PROV だけになる）。 */
  provWikiEntities?: WikiEntityInfo[];
};

function NoteEditor(props: NoteEditorProps) {
  return (
    <LabelStoreProvider>
      <LinkStoreProvider>
        <IndexTableStoreProvider>
        <MediaInlineLabelProvider>
        <AiAssistantProvider aiAvailable={props.aiAvailable}>
          <NoteEditorInner {...props} />
        </AiAssistantProvider>
        </MediaInlineLabelProvider>
        </IndexTableStoreProvider>
      </LinkStoreProvider>
    </LabelStoreProvider>
  );
}

// BlockNote スキーマに存在しないブロック型を再帰的に除去する
// 保存済みノートに未登録ブロック（sampleScope 等）が含まれる場合のクラッシュ防止
const KNOWN_BLOCK_TYPES = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "table", "image", "video", "audio", "file",
  "codeBlock", "pdf", "bookmark",
]);

// インラインコンテンツから未知の型を除去（mention 等）
const KNOWN_INLINE_TYPES = new Set(["text", "link"]);

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

function sanitizeBlocks(blocks: any[]): any[] {
  return blocks
    .filter((b) => KNOWN_BLOCK_TYPES.has(b.type))
    .map((b) => ({
      ...b,
      content: sanitizeInlineContent(b.content),
      children: b.children?.length ? sanitizeBlocks(b.children) : b.children,
    }));
}

function NoteEditorInner({
  fileId,
  initialDoc,
  onSave,
  onDeriveNote,
  onAiDeriveNote,
  onNavigateNote,
  onRefreshFiles,
  saving,
  files,
  noteGraphData,
  lineageTree,
  sourceDoc,
  onSourceDocChange,
  getCachedDoc,
  noteIndex,
  uploadFile,
  mediaIndex,
  onAddUrlBookmark,
  pendingMemoInsert,
  onMemoInserted,
  captureIndex: captureIndexProp,
  onEditorRef,
  onIngestToWiki,
  onIngestFromUrl,
  onDeriveWholeNote,
  derivingDisabled,
  onDeleteNote,
  onIngestChat,
  isWikiDoc,
  aiAvailable = true,
  skillPrompts,
  onOpenComposer,
  composerSubmitRef,
  archived = false,
  provWikiEntities,
}: NoteEditorProps) {
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const { removeBlockMetadata } = useBlockLifecycle();
  const indexTableStore = useIndexTableStore();
  const mediaInlineLabelStore = useMediaInlineLabelStore();
  const aiAssistant = useAiAssistant();
  const isDesktop = useIsDesktop();
  const editorRef = useRef<any>(null);
  // このノートを派生元として参照する wiki エントリ（Knowledge 化済み判定用）
  const knowledgeMap = useMemo(() => buildKnowledgeMap(noteIndex ?? null), [noteIndex]);
  const wikiEntriesForCurrentNote: NoteIndexEntry[] = fileId ? (knowledgeMap.get(fileId) ?? []) : [];
  const [sidePeekNoteId, setSidePeekNoteId] = useState<string | null>(null);
  const noteLinksRef = useRef<NoteLink[]>(initialDoc?.noteLinks ?? []);
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
  const [rightTab, setRightTab] = useState<"graph" | "prov" | "chat" | "history" | "source" | null>(null);
  // アイコンレールのトグル: 同じタブクリックで閉じる
  const toggleRightTab = useCallback((tab: "graph" | "prov" | "chat" | "history" | "source") => {
    setRightTab((prev) => prev === tab ? null : tab);
    if (tab !== "history") setHighlightBlockIds([]);
  }, []);
  // PROV パネル自動オープンを 1 ノートあたり 1 回に絞るための記憶
  const provAutoOpenedRef = useRef(false);
  const t = useT();
  const [title, setTitle] = useState(initialDoc?.title || tStatic("editor.newNote"));

  // ── PDF エクスポート（状態のみ — ハンドラーは provDoc 宣言後） ──
  const [pdfExporting, setPdfExporting] = useState(false);

  // ── メディアピッカー ──
  const [pickerMediaType, setPickerMediaType] = useState<MediaType | null>(null);

  // ── メモピッカーモーダル ──
  const [memoPickerOpen, setMemoPickerOpen] = useState(false);

  // スラッシュメニューからピッカーを開くコールバック登録
  useEffect(() => {
    setMediaPickerCallback((type: MediaType) => setPickerMediaType(type));
    return () => { setMediaPickerCallback(null); };
  }, []);

  // スラッシュメニューからメモピッカーを開くコールバック登録
  useEffect(() => {
    setMemoPickerCallback(() => setMemoPickerOpen(true));
    return () => { setMemoPickerCallback(null); };
  }, []);

  // スラッシュメニューから URL ブックマークピッカーを開くコールバック登録
  useEffect(() => {
    setBookmarkPickerCallback(() => setUrlSlashPickerOpen(true));
    return () => { setBookmarkPickerCallback(null); };
  }, []);

  // スラッシュメニューからテンプレートピッカーを開くコールバック登録
  useEffect(() => {
    setTemplatePickerCallback((triggerBlock: any) => {
      templateTriggerBlockRef.current = triggerBlock;
      setTemplatePickerOpen(true);
    });
    return () => { setTemplatePickerCallback(null); };
  }, []);

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

    const { blocks, labels, provLinks } = tmpl.build(tStatic);

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

    // ラベル付与・前手順リンク追加（次フレームに延期して、エディタの状態反映後に実行）
    if (labels.length > 0 || (provLinks && provLinks.length > 0)) {
      setTimeout(() => {
        for (const { path, label } of labels) {
          const block = resolveByPath(path);
          if (block?.id) {
            labelStore.setLabel(block.id, label);
          }
        }
        for (const link of provLinks ?? []) {
          const source = resolveByPath(link.sourcePath);
          const target = resolveByPath(link.targetPath);
          if (source?.id && target?.id) {
            linkStore.addLink({
              sourceBlockId: source.id,
              targetBlockId: target.id,
              type: link.type,
              createdBy: "human",
            });
          }
        }
      }, 0);
    }

    // フォーカスブロックにカーソルを移動
    const focusBlock = resolveByPath(tmpl.focusPath);
    if (focusBlock) {
      editor.setTextCursorPosition(focusBlock, "end");
    }

    templateTriggerBlockRef.current = null;
    // insertBlocks による onChange で自動的に markDirty される
  }, [labelStore, linkStore]);

  // ピッカーで選択されたメディアをエディタに挿入
  const handlePickerSelect = useCallback((entry: MediaIndexEntry) => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) return;

    // PDF はカスタムブロック、それ以外は BlockNote 標準ブロック
    const newBlock = entry.type === "pdf"
      ? { type: "pdf", props: { url: entry.url, name: entry.name } }
      : {
          type: entry.type === "video" ? "video" : entry.type === "audio" ? "audio" : "image",
          props: { url: entry.url, name: entry.name },
        };
    editor.insertBlocks([newBlock], currentBlock, "after");

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
    // onChange が自動的にトリガーされるので markDirty() は不要
  }, [removeBlockMetadata]);

  // スラッシュメニューアイテム（既存メディア・メモから挿入）
  const mediaSlashItems = useMemo(() => getMediaSlashMenuItems(), []);
  const memoSlashItem = useMemo(() => getMemoSlashMenuItem(), []);
  const templateSlashItem = useMemo(() => getTemplateSlashMenuItem(), []);

  // テンプレートピッカーモーダル
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templateTriggerBlockRef = useRef<any>(null);

  // ── URL ペースト検知 ──
  const [pastedUrl, setPastedUrl] = useState<{ url: string; position: { x: number; y: number }; blockId: string } | null>(null);
  const pasteListenerRef = useRef<((e: ClipboardEvent) => void) | null>(null);
  const copyListenerRef = useRef<((e: ClipboardEvent) => void) | null>(null);

  // スラッシュメニューからの URL ピッカーモーダル用状態
  const [urlSlashPickerOpen, setUrlSlashPickerOpen] = useState(false);

  // ペースト → ブックマーク選択: モーダルなしで直接挿入 + 裏でアセット登録
  const handleInsertBookmarkDirect = useCallback((url: string, blockId: string) => {
    setPastedUrl(null);
    const editor = editorRef.current;
    if (!editor) return;
    const block = editor.getBlock(blockId);
    if (block) {
      // bookmark ブロックを即座に挿入（メタデータはブロック側で非同期取得）
      editor.insertBlocks(
        [{
          type: "bookmark",
          props: { url, title: "", description: "", ogImage: "", domain: extractDomain(url) },
        }],
        block,
        "after",
      );
      // 元のテキストブロックに URL テキストだけが残っていたら削除
      const content = block.content;
      if (Array.isArray(content) && content.length <= 1) {
        const text = content[0]?.text?.trim() ?? "";
        if (text === url || text === "") {
          removeBlockMetadata([block.id]);
          editor.removeBlocks([block]);
        }
      }
    }
    // 裏でアセットブラウザに登録（重複チェックは useFileManager 側で行う）
    if (onAddUrlBookmark) {
      fetchUrlMetadata(url).then((meta) => {
        onAddUrlBookmark!({
          fileId: generateUrlBookmarkId(),
          name: meta.title,
          type: "url",
          mimeType: "text/x-uri",
          url,
          thumbnailUrl: getFaviconUrl(meta.domain),
          uploadedAt: new Date().toISOString(),
          usedIn: [],
          urlMeta: { domain: meta.domain, description: meta.description, ogImage: meta.ogImage },
        });
      });
    }
  }, [onAddUrlBookmark, removeBlockMetadata]);

  // スラッシュメニューのピッカーから選択 → bookmark ブロック挿入
  const handleUrlSlashPickerSelect = useCallback((entry: MediaIndexEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) return;
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
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      removeBlockMetadata([currentBlock.id]);
      editor.removeBlocks([currentBlock]);
    }
    setUrlSlashPickerOpen(false);
  }, [removeBlockMetadata]);

  // ラベル自動設定のコールバック
  const labelAutoRef = useRef<(() => void) | null>(null);

  // エディタ参照を保持
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
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
          // ProseMirror / BlockNote の paste handler も同じ DOM に付いており、
          // preventDefault だけだと続けて走ってブロックを改行追加 + paragraph 置換してしまう。
          // capture phase で完全に乗っ取るため stopImmediatePropagation も呼ぶ。
          e.preventDefault();
          e.stopImmediatePropagation();
          // 末尾の改行はクリップボードに含まれる「行末コピー」由来で、ブロック内に
          // 持ち込むと BlockNote が hard break を増やすため除去する。
          const cleaned = plain.replace(/\r?\n+$/g, "");
          editor.updateBlock(cursorBlock, {
            content: [{ type: "text", text: cleaned, styles: {} }],
          });
          return;
        }
      }
      // 全コピペ共通: 挿入後にインライン entityId を再発番する後処理（Phase E, 2026-04-30）
      // 同 entityId 共有は意図しない場合が多いので、コピー範囲内では一貫した
      // 新 ID に置き換える（旧 ID 同一なら新 ID も同一になる remap）。
      // 詳細: features/inline-label/regen-on-paste.ts
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
        return;
      }

      // Graphium ペイロード以外でも entity 再発番は走らせる（プレーン Markdown / HTML 等）
      scheduleEntityRegen();

      // 既存: URL のみのペーストならブックマーク選択メニューを出す
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      try {
        const parsed = new URL(text);
        if (!parsed.protocol.startsWith("http")) return;
      } catch {
        return;
      }
      const currentBlock = editor.getTextCursorPosition()?.block;
      if (!currentBlock) return;
      const sel = window.getSelection();
      let x = 0, y = 0;
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        x = rect.left;
        y = rect.bottom;
      }
      setTimeout(() => {
        setPastedUrl({ url: text, position: { x, y }, blockId: currentBlock.id });
      }, 100);
    };
    pasteListenerRef.current = pasteListener;

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
      // bubble phase でも copy を補足する（capture phase で setData した内容を
      // ProseMirror が clearData している場合、bubble の最後でもう一度 setData する）
      domEl.addEventListener("copy", copyListener, false);
    };
    attachClipboardListeners();
  }, [labelStore, linkStore]);

  // ── 保存ロジック ──
  const buildDocument = useCallback(async (): Promise<GraphiumDocument> => {
    const blocks = editorRef.current?.document || [];
    const labelSnapshot = labelStore.getSnapshot();
    const labelsObj: Record<string, string> = {};
    for (const [k, v] of labelSnapshot.labels) {
      labelsObj[k] = v;
    }
    const allLinks = linkStore.getAllLinks();
    const provLinks = allLinks.filter((l) => l.layer === "prov");
    const knowledgeLinks = allLinks.filter((l) => l.layer === "knowledge");
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
    // インデックステーブルの状態を収集
    const indexTablesSnapshot = indexTableStore.getSnapshot();
    const hasIndexTables = Object.keys(indexTablesSnapshot).length > 0;
    // メディアインラインラベル（Phase D-3-β）
    const mediaInlineLabelsSnapshot = mediaInlineLabelStore.getSnapshot();
    const hasMediaInlineLabels =
      Object.keys(mediaInlineLabelsSnapshot).length > 0;
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
          indexTables: hasIndexTables ? indexTablesSnapshot : undefined,
          mediaInlineLabels: hasMediaInlineLabels
            ? mediaInlineLabelsSnapshot
            : undefined,
        },
      ],
      noteLinks: noteLinksRef.current.length > 0 ? noteLinksRef.current : undefined,
      derivedFromNoteId: initialDoc?.derivedFromNoteId,
      derivedFromBlockId: initialDoc?.derivedFromBlockId,
      documentProvenance: currentProvenance,
      chats: savedChats.length > 0 ? savedChats : undefined,
      // Wiki / Skill メタデータを保持（source, wikiMeta, skillMeta, generatedBy）
      source: initialDoc?.source,
      wikiMeta: initialDoc?.wikiMeta,
      skillMeta: initialDoc?.skillMeta,
      generatedBy: initialDoc?.generatedBy,
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
    doc = await recordRevision(doc, prevPageRef.current, actType, { agentLabel: actLabel, email, author });
    // 前回保存状態を更新
    prevPageRef.current = structuredClone(doc.pages[0]);

    return doc;
  }, [title, labelStore, linkStore, indexTableStore, mediaInlineLabelStore, aiAssistant, initialDoc, currentProvenance]);

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

  const handleSave = useCallback(async () => {
    const baseDoc = await buildDocument();
    // 通常保存時にも sharedRef を持たせる（buildDocument が落とすため）。
    // これがないと auto-save ごとに sharedRef がディスクから消え、再共有時に
    // 既存 entry を見つけられず author check が発動しない、という連鎖バグになる。
    const doc: GraphiumDocument = sharedRefState
      ? { ...baseDoc, sharedRef: sharedRefState }
      : baseDoc;
    onSave(doc);
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
  }, [onSave, buildDocument, fileId, sharedRefState]);

  // ── オートセーブ ──
  const { dirty, setDirty, markDirty, saveNow } = useAutoSave(handleSave);

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
  const { provDoc, generateProv, triggerRegeneration } = useProvGeneration(
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
    if (provAutoOpenedRef.current) return;
    if (rightTab !== null) return;
    const hasActivity =
      provDoc?.["@graph"].some((n) => n["@type"] === "prov:Activity") ?? false;
    if (hasActivity) {
      setRightTab("prov");
      provAutoOpenedRef.current = true;
    }
  }, [provDoc, rightTab]);

  // ── PDF エクスポートハンドラー ──
  const handleExportPdf = useCallback(async () => {
    const editorEl = document.querySelector("[data-label-wrapper] .bn-editor") as HTMLElement | null;
    if (!editorEl) return;
    setPdfExporting(true);
    try {
      await exportNoteToPdf({
        title,
        editorElement: editorEl,
        provDoc,
        labels: labelStore.labels,
      });
    } finally {
      setPdfExporting(false);
    }
  }, [title, provDoc, labelStore.labels]);

  // ── PROV-JSON-LD エクスポートハンドラー ──
  // Phase 4 (PR-B7): Wiki Knowledge Layer も @graph に含める。NoteApp 側で
  // wiki state から組み立てた wikiEntities を prop で受け取り、ここでは受け流す。
  const handleExportProvJsonLd = useCallback(() => {
    if (!provDoc || provDoc["@graph"].length === 0) return;
    void exportProvJsonLd({ title, provDoc, wikiEntities: provWikiEntities });
  }, [title, provDoc, provWikiEntities]);

  // ラベル・リンク・インデックステーブル変更時に自動保存トリガー
  const prevLabelsRef = useRef(labelStore.labels);
  const prevLinksRef = useRef(linkStore.links);
  const prevTablesRef = useRef(indexTableStore.tables);
  const prevMediaLabelsRef = useRef(mediaInlineLabelStore.labels);
  useEffect(() => {
    if (
      prevLabelsRef.current !== labelStore.labels ||
      prevLinksRef.current !== linkStore.links ||
      prevTablesRef.current !== indexTableStore.tables ||
      prevMediaLabelsRef.current !== mediaInlineLabelStore.labels
    ) {
      prevLabelsRef.current = labelStore.labels;
      prevLinksRef.current = linkStore.links;
      prevTablesRef.current = indexTableStore.tables;
      prevMediaLabelsRef.current = mediaInlineLabelStore.labels;
      markDirty();
    }
  }, [labelStore.labels, linkStore.links, indexTableStore.tables, mediaInlineLabelStore.labels, markDirty]);

  // AI チャットパネル用ハンドラー（継続対話）
  const handleAiChatSubmit = useCallback(
    async (question: string, attachedNotes?: AttachedNote[]) => {
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
      const now = new Date().toISOString();
      // 添付ノートがある場合はメッセージ表示に含める
      const displayContent = attachedNotes && attachedNotes.length > 0
        ? `${question}\n\n📎 ${attachedNotes.map((n) => n.isWiki ? `🤖 ${n.title}` : n.title).join(", ")}`
        : question;
      aiAssistant.addMessage({ role: "user", content: displayContent, timestamp: now });
      aiAssistant.setLoading(true);
      try {
        const isFirstMessage = aiAssistant.messages.length === 0;
        let userMessage = question;
        if (isFirstMessage) {
          if (aiAssistant.quotedMarkdown) {
            // ブロック選択チャット: 選択ブロックのコンテキストを付加
            userMessage = [
              "以下の内容について質問があります。",
              "",
              "---",
              aiAssistant.quotedMarkdown,
              "---",
              "",
              question,
            ].join("\n");
          } else if (aiAssistant.sourceBlockIds.length === 0 && editorRef.current) {
            // ページ全体チャット: ドキュメント全体をコンテキストとして付加
            const allBlocks = editorRef.current.document;
            const pageMarkdown = await editorRef.current.blocksToMarkdownLossy(allBlocks);
            if (pageMarkdown.trim()) {
              userMessage = [
                "以下のドキュメント全体について質問があります。",
                "",
                "---",
                pageMarkdown,
                "---",
                "",
                question,
              ].join("\n");
            }
          }
        }
        // @ メンションで添付されたノートの内容をコンテキストに追加
        if (attachedNotes && attachedNotes.length > 0) {
          const noteContents: string[] = [];
          for (const attached of attachedNotes) {
            try {
              const provider = getActiveProvider();
              const doc = attached.isWiki && provider.loadWikiFile
                ? await provider.loadWikiFile(attached.id)
                : await provider.loadFile(attached.id);
              if (doc) {
                const page = doc.pages[0];
                const blocks = page?.blocks ?? [];
                // プレーンテキスト抽出（ブロック構造から確実にテキストを取得）
                const content = blocks
                  .map((b: any) => {
                    const prefix = b.type === "heading" ? "#".repeat(b.props?.level ?? 2) + " " : "";
                    const c = b.content;
                    if (!c) return "";
                    if (typeof c === "string") return prefix + c;
                    if (Array.isArray(c)) return prefix + c.map((x: any) => x.text ?? "").join("");
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n");
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

        const selectedModel = getSelectedModel();
        const disabledTools = getDisabledTools();
        // Wiki Retriever: 関連する Wiki コンテキストを検索
        let wikiContext: string | undefined;
        try {
          const { retrieveWikiContext } = await import("./features/wiki/retriever");
          wikiContext = (await retrieveWikiContext(userMessage)) ?? undefined;
        } catch {
          // Retriever 失敗は無視（embedding が無い場合など）
        }
        // 会話履歴を組み立ててサーバーに送る。
        // サーバーは stateless（session を保持しない）。履歴の正本はノート側の ScopeChat。
        const history: AgentChatMessage[] = aiAssistant.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const response = await runAgent({
          message: userMessage,
          messages: [...history, { role: "user", content: userMessage }],
          session_id: aiAssistant.sessionId ?? undefined,
          ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {}),
          ...(wikiContext ? { wiki_context: wikiContext } : {}),
          ...(skillPrompts ? { custom_instructions: skillPrompts } : {}),
          language: getLocale(),
          options: { max_turns: 5, ...(selectedModel && { model: selectedModel }) },
        });
        // Wiki コンテキストが使われ���場合、引用情報を処理
        let assistantMessage = response.message;
        if (wikiContext) {
          // wikiContext に含まれていた候補タイトル（Retriever が embedding 検索で抽出して
          // LLM に渡した、引用が特に期待される正式タイトル）
          const candidateTitles: string[] = [];
          const titlePattern = /\[id:\s*[^,]+,\s*title:\s*"([^"]+)"\]/g;
          let tm;
          while ((tm = titlePattern.exec(wikiContext)) !== null) {
            candidateTitles.push(tm[1]);
          }

          // <wiki-index> 内で LLM に提示した全 Wiki ページタイトル。LLM はこの中からも
          // 引用してよい（Retriever のヒットに無くても、index にあれば妥当な引用元）。
          const indexTitles: string[] = [];
          const indexBlockMatch = wikiContext.match(/<wiki-index>([\s\S]*?)<\/wiki-index>/);
          if (indexBlockMatch) {
            const titleInIndex = /^- \*\*(.+?)\*\*/gm;
            let im;
            while ((im = titleInIndex.exec(indexBlockMatch[1])) !== null) {
              indexTitles.push(im[1]);
            }
          }
          const allValidTitles = [...new Set([...candidateTitles, ...indexTitles])];

          // 候補タイトルへの正規化: LLM が `[Source: "..."]` でなく `【Source: @prefix...】`
          // のような派生形式で出すことがあるので、候補に対して prefix match で正式タイトルに復元する。
          const resolveTitle = (raw: string): string | null => {
            const cleaned = raw.replace(/^@/, "").trim();
            const exact = allValidTitles.find((t) => t === cleaned);
            if (exact) return exact;
            const prefix = allValidTitles.find((t) => t.startsWith(cleaned) || cleaned.startsWith(t));
            return prefix ?? null;
          };

          const sources = new Set<string>();
          // 半角形式 [Source: "..."] と 全角形式【Source: ...】の両方を拾う
          const halfWidth = /\[Source:\s*"?([^"\]]+?)"?\]/g;
          const fullWidth = /【Source:\s*([^】]+?)】/g;
          let m: RegExpExecArray | null;
          // 元メッセージから半角を抽出
          while ((m = halfWidth.exec(assistantMessage)) !== null) {
            const resolved = resolveTitle(m[1]);
            if (resolved) sources.add(resolved);
          }
          // 全角を抽出 + 元テキストでも半角形式に置換（panel 側のレンダラがクリック可能にできるよう）
          // 解決できない引用は LLM の hallucination（実在しないタイトル）なので、本文から除去する。
          assistantMessage = assistantMessage.replace(fullWidth, (_full, raw: string) => {
            const resolved = resolveTitle(raw);
            if (resolved) {
              sources.add(resolved);
              return `[Source: "${resolved}"]`;
            }
            return "";
          });
          // 半角形式の hallucination も除去（実在タイトルでない引用は表示価値が低い）
          assistantMessage = assistantMessage.replace(halfWidth, (_full, raw: string) => {
            const resolved = resolveTitle(raw);
            return resolved ? `[Source: "${resolved}"]` : "";
          });

          // LLM が一度も引用しなかった場合は wikiContext の全候補を trailing list に並べる
          if (sources.size === 0) {
            for (const t of candidateTitles) sources.add(t);
          }

          if (sources.size > 0) {
            const sourceList = [...sources].map((s) => `  - [Source: "${s}"]`).join("\n");
            assistantMessage += `\n\n---\n**Knowledge referenced:**\n${sourceList}`;
          } else {
            assistantMessage += "\n\n---\n📎 *Knowledge referenced*";
          }
        }
        // <!-- wiki_worthy: true/false --> タグは表示には不要なので除去する。
        // 自動 Wiki 保存はユーザーフィードバックを受けて廃止。Wiki 化は明示的なボタン操作で行う。
        const cleanMessage = assistantMessage.replace(/\s*<!--\s*wiki_worthy:\s*(?:true|false)\s*-->\s*$/, "");

        const assistantTimestamp = new Date().toISOString();
        aiAssistant.addMessage({
          role: "assistant",
          content: cleanMessage,
          timestamp: assistantTimestamp,
        });
        aiAssistant.setSessionId(response.session_id);
        aiAssistant.setLoading(false);
        markDirty();
      } catch (err) {
        aiAssistant.setError(
          err instanceof Error ? err.message : "AI 実行に失敗しました",
        );
      }
    },
    [fileId, aiAssistant, markDirty],
  );

  // Composer 結果をドキュメント末尾にブロックとして挿入するヘルパー。
  // Compose / Insert PROV で共通利用。scope は意図的に気にせず常に末尾挿入（Composer の呼び出し点は
  // グローバルで、ブロック選択スコープに紐付かないため、末尾が最も予測可能）。
  const insertComposerResultAtEnd = useCallback(async (markdown: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const parsed = markdown.trim();
    if (!parsed) return;
    const blocks = await editor.tryParseMarkdownToBlocks(parsed);
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
    const selectedModel = getSelectedModel();
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
  });
  composerHandlersRef.current = {
    handleAiChatSubmit,
    runComposerAgent,
    insertComposerResultAtEnd,
    setRightTab,
    setPickerMediaType,
    parkChat: aiAssistant.parkChat,
  };

  useEffect(() => {
    if (!composerSubmitRef) return;
    composerSubmitRef.current = async (submission) => {
      const { mode, prompt } = submission;
      const h = composerHandlersRef.current;

      if (mode === "ask") {
        // Cmd+K で開く Composer は「新しい問いを立てる」ショートカットとして扱う。
        // 既存チャットがあれば履歴 (chats) に退避してから新セッションを開始する。
        // チャット欄を開いている状態での追加質問は、チャット欄の input を使えばよい。
        h.parkChat();
        h.setRightTab("chat");
        await h.handleAiChatSubmit(prompt);
        return;
      }

      if (mode === "insert-media") {
        h.setPickerMediaType("image");
        return;
      }

      if (!isAgentConfigured()) {
        window.alert(tStatic("settings.aiNotConfigured"));
        return;
      }

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
        window.alert(err instanceof Error ? err.message : tStatic("aiChat.runFailed"));
      }
    };
    return () => {
      if (composerSubmitRef.current) composerSubmitRef.current = null;
    };
  }, [composerSubmitRef]);

  // AI 回答から別ノートとして派生
  const handleAiDeriveFromChat = useCallback(
    async (question: string, answer: string) => {
      if (!fileId || !editorRef.current) return;
      const chatTitle = await generateTitle(answer).catch(() => question.slice(0, 25));
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
        parseMarkdown: (md) => editorRef.current.tryParseMarkdownToBlocks(md),
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

  // 挿入されたブロック配列に対して、抽出済みラベルを path 経由で実 ID に解決して
  // labelStore に適用し、連続する procedure 見出しを informed_by で自動連結する。
  // handleInsertToScope と handleReplaceBlocks の双方から使う。
  const applyExtractedLabels = useCallback(
    (inserted: any[], extracted: { path: number[]; label: string }[]) => {
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

  // AI 回答をスコープに反映
  const handleInsertToScope = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;

      const targetBlockId = aiAssistant.sourceBlockIds[0];
      if (!targetBlockId) {
        // ページ全体チャット: ドキュメント末尾に挿入
        const parsed = editor.tryParseMarkdownToBlocks(markdown);
        if (parsed.length === 0) return;
        const { blocks, labels } = extractLabelMarkersFromBlocks(parsed);
        const allBlocks = editor.document;
        const lastBlock = allBlocks[allBlocks.length - 1];
        if (lastBlock) {
          const inserted = editor.insertBlocks(blocks, lastBlock, "after");
          applyExtractedLabels(inserted as any[], labels);
        }
        lastAiInsertRef.current = true;
        markDirty();
        return;
      }
      const targetBlock = editor.getBlock(targetBlockId);
      if (!targetBlock) return;
      if (targetBlock.type === "heading") {
        const parsed = editor.tryParseMarkdownToBlocks(markdown);
        if (parsed.length === 0) return;
        const { blocks, labels } = extractLabelMarkersFromBlocks(parsed);
        const scope = collectHeadingScope(editor.document, targetBlock);
        const insertAfterBlock = scope[scope.length - 1];
        const inserted = editor.insertBlocks(blocks, insertAfterBlock, "after");
        applyExtractedLabels(inserted as any[], labels);
      } else {
        // 段落・リストへの追記: マーカーは平文のまま見えてしまうので、
        // 単純な文字列レベルで剥がしてから追記する（ラベル付与はスキップ）。
        const stripped = markdown.replace(/^\s*\[\[label:[a-z]+\]\][ 　]?/gm, "");
        const existingContent = Array.isArray(targetBlock.content) ? targetBlock.content : [];
        const newContent = [
          ...existingContent,
          { type: "text" as const, text: "\n" + stripped, styles: {} },
        ];
        editor.updateBlock(targetBlockId, { content: newContent });
      }
      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant.sourceBlockIds, applyExtractedLabels],
  );

  // AI 回答で対象ブロックを置換
  const handleReplaceBlocks = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;
      const blockIds = aiAssistant.sourceBlockIds;
      if (blockIds.length === 0) return;

      const parsedBlocks = editor.tryParseMarkdownToBlocks(markdown);
      if (parsedBlocks.length === 0) return;
      const { blocks: newBlocks, labels: extractedLabels } =
        extractLabelMarkersFromBlocks(parsedBlocks);

      const firstBlock = editor.getBlock(blockIds[0]);
      if (!firstBlock) return;

      let inserted: any[] = [];
      if (firstBlock.type === "heading") {
        // 見出しスコープ: 見出し配下のブロックを置換（見出し自体は残す）
        const scope = collectHeadingScope(editor.document, firstBlock);
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
          // 単一ブロック更新時は extractedLabels の対象外として扱う
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
      }

      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant, removeBlockMetadata, applyExtractedLabels],
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
      if (page.indexTables) {
        indexTableStore.restore(page.indexTables);
        const existingLinks = noteLinksRef.current;
        let added = false;
        for (const [blockId, linkedNotes] of Object.entries(page.indexTables)) {
          for (const noteId of Object.values(linkedNotes)) {
            const exists = existingLinks.some(
              (l) => l.targetNoteId === noteId
            );
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
    }
    if (initialDoc.chats && initialDoc.chats.length > 0) {
      aiAssistant.restoreChats(initialDoc.chats);
    }
  }, [initialDoc, labelStore, linkStore, indexTableStore, aiAssistant]);

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

  // スラッシュメニューからのラベル設定コールバック
  useEffect(() => {
    setSlashMenuLabelCallback((blockId: string, label: string) => {
      labelStore.setLabel(blockId, label);
    });
    return () => { setSlashMenuLabelCallback(null); };
  }, [labelStore]);

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
      if (!isMentionSpan(target)) return;
      const noteName = target.textContent!.trim().slice(1);
      const resolved = resolveMentionNoteId(noteName);
      if (resolved) {
        e.preventDefault();
        e.stopPropagation();
        // ノート / Wiki どちらでもまずサイドピークで開く。SidePeek 内の「Open full」で
        // 完全表示に切り替えられる方が、いきなりページ遷移するより流れが良い。
        // Wiki の場合は SidePeek が wiki: プレフィックスで loadWikiFile を呼ぶ。
        const peekId = resolved.isWiki ? `wiki:${resolved.noteId}` : resolved.noteId;
        setSidePeekNoteId(peekId);
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [noteIndex, files]);

  // スラッシュメニューからのインデックステーブル登録コールバック
  useEffect(() => {
    setRegisterIndexTableCallback((blockId: string) => {
      indexTableStore.register(blockId);
    });
    return () => { setRegisterIndexTableCallback(null); };
  }, [indexTableStore]);

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

  // エディタ内容変更時にも再生成をトリガー + ラベル自動設定
  const handleContentChange = useCallback(() => {
    markDirty();
    labelAutoRef.current?.();
    triggerRegeneration();
    // 空ノート予示を隠す（本文に 1 度でも変化があれば以降は非表示）
    setHasBeenEdited(true);
  }, [markDirty, triggerRegeneration]);

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
    if (block.type === "heading") {
      const scope = collectHeadingScope(editorRef.current.document, block);
      return scope.map((b: any) => b.id);
    }
    return [blockId];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab, aiAssistant.sourceBlockIds, dirty]);

  // ── レンダリング ──
  return (
    <>
      <ProvIndicatorLayer />
      <IndexTableIconLayer editorRef={editorRef} />
      <ProvIndicatorHoverHint />
      <BlockHoverHighlight />
      <ScopeHighlight blockIds={chatScopeBlockIds} />
      <LabelDropdownPortal />
      {/* URL ペーストスタイル選択メニュー */}
      {pastedUrl && (
        <UrlPasteMenu
          url={pastedUrl.url}
          position={pastedUrl.position}
          onSelectBookmark={() => handleInsertBookmarkDirect(pastedUrl.url, pastedUrl.blockId)}
          onSelectLink={() => setPastedUrl(null)}
          onDismiss={() => setPastedUrl(null)}
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
        />
      )}
      {/* メモピッカーモーダル（スラッシュメニュー /memo から） */}
      <MemoPickerModal
        open={memoPickerOpen}
        onClose={() => setMemoPickerOpen(false)}
        captureIndex={captureIndexProp ?? null}
        onSelect={(entry: CaptureEntry) => {
          // カーソル位置の後に paragraph ブロックとして挿入
          const editor = editorRef.current;
          if (!editor) return;
          const blocks = entry.text.split("\n").map((line: string) => ({
            type: "paragraph",
            content: [{ type: "text" as const, text: line, styles: {} }],
          }));
          if (blocks.length === 0) return;
          const currentBlock = editor.getTextCursorPosition()?.block;
          if (currentBlock) {
            editor.insertBlocks(blocks, currentBlock, "after");
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
        />
      )}
      {/* テンプレートピッカーモーダル（スラッシュメニュー /template から） */}
      {templatePickerOpen && (
        <TemplatePickerModal
          onSelect={handleTemplateSelect}
          onClose={() => setTemplatePickerOpen(false)}
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
        {!isWikiDoc && aiAvailable && (
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
          saveDisabled={saving}
          onExportPdf={handleExportPdf}
          pdfExporting={pdfExporting}
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
          onDelete={onDeleteNote}
          deleteDisabled={!fileId || saving}
          onShare={!isWikiDoc ? handleShare : undefined}
          shareDisabled={!!shareDisabledReason || saving}
          shareDisabledReason={shareDisabledReason}
          isShared={isShared}
          shareBusy={shareBusy}
          t={t}
        />
      </div>

      <div className="flex h-full w-full overflow-hidden">
        {/* 左: エディタ */}
        <div data-label-wrapper className="flex-1 min-w-0 overflow-auto relative">
          <div style={{ padding: "16px 0", paddingLeft: isDesktop ? 100 : 16, paddingRight: isDesktop ? 100 : 16, paddingBottom: isDesktop ? 16 : 72 }}>
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
              onKeyDown={(e) => {
                // IME 変換確定の Enter を奪わない。
                // isComposing (および Safari 互換のための keyCode 229) を見て
                // 変換中の Enter は素通しする。これを忘れると、変換確定の
                // Enter で focus が editor に移り、確定文字がエディタの
                // 1 行目へ流れ込む（タイトル直下に同じ文字が現れる）バグになる。
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              rows={1}
              placeholder={t("editor.titlePlaceholder")}
              aria-label={t("editor.titlePlaceholder")}
              className="block w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 text-3xl font-bold leading-tight mt-3 mb-5 px-[54px] resize-none overflow-hidden break-words"
            />
            <SandboxEditor
              key={fileId || "new"}
              editable={!archived}
              blocks={[pdfViewerBlock, bookmarkBlock]}
              initialContent={initialContent}
              sideMenu={NoteSideMenu}
              extraSlashMenuItems={[...buildLabelSlashMenuItems(), indexTableSlashItem, templateSlashItem, ...mediaSlashItems, bookmarkSlashItem, memoSlashItem]}
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
              onHashtagSelect={(blockId, label) => labelStore.setLabel(blockId, label)}
              getMentionSuggestions={() => {
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
                    if (tableBlockId && indexTableStore.isIndexTable(tableBlockId)) {
                      mentionContextRef.current = { tableBlockId, rowIndex };
                    }
                  }
                }
                return [
                  ...getHeadingSuggestions(),
                  ...getNoteSuggestions(files, fileId ?? undefined, noteIndex),
                ];
              }}
              onMentionSelect={(sourceBlockId, suggestion) => {
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
                    indexTableStore.setLinkedNote(tableBlockId, `@${noteName}`, suggestion.id);
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
                    setTimeout(() => {
                      editorRef.current?.insertInlineContent([
                        { type: "text", text: `@${suggestion.label}`, styles: { textColor: "blue" } },
                        { type: "text", text: " ", styles: {} },
                      ]);
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
                }
              }}
            />
            {/* 空ノート予示: ⌘K / # / @ / / の入口をさりげなく案内 */}
            <div className="px-[54px]">
              <EmptyNoteGuide
                visible={showEmptyNoteGuide}
                onOpenComposer={onOpenComposer}
              />
            </div>
          </div>
        </div>

        {/* SidePeek（inline）— エディタの右、右パネルの左に差し込まれる。
            デスクトップのみ inline（モバイルは overlay にフォールバック）。 */}
        {sidePeekNoteId && isDesktop && (
          <SidePeek
            inline
            noteId={sidePeekNoteId}
            cachedDoc={getCachedDoc?.(sidePeekNoteId)}
            onClose={() => setSidePeekNoteId(null)}
            onNavigate={(noteId, savedDoc) => {
              setSidePeekNoteId(null);
              onNavigateNote(noteId, savedDoc);
            }}
            wikiEntries={knowledgeMap.get(sidePeekNoteId) ?? []}
          />
        )}
        {sidePeekNoteId && !isDesktop && (
          <SidePeek
            noteId={sidePeekNoteId}
            cachedDoc={getCachedDoc?.(sidePeekNoteId)}
            onClose={() => setSidePeekNoteId(null)}
            onNavigate={(noteId, savedDoc) => {
              setSidePeekNoteId(null);
              onNavigateNote(noteId, savedDoc);
            }}
            wikiEntries={knowledgeMap.get(sidePeekNoteId) ?? []}
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
                  aria-label="閉じる"
                >
                  ✕
                </button>
              )}
              <span className="text-xs font-bold tracking-wide text-foreground">
                {rightTab === "graph" ? "Graph" : rightTab === "prov" ? t("panel.prov") : rightTab === "chat" ? "Chat" : rightTab === "history" ? t("panel.history") : "Source"}
              </span>
              {rightTab === "prov" && (
                <button
                  onClick={generateProv}
                  title={t("panel.generateManual")}
                  className="px-2.5 py-0.5 text-xs font-semibold rounded border border-primary bg-primary/5 text-primary cursor-pointer hover:bg-primary/10 transition-colors ml-auto"
                >
                  {t("panel.generate")}
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
                  onOpenMedia={async (fileId) => {
                    try {
                      const blobUrl = await getActiveProvider().getMediaBlobUrl(fileId);
                      window.open(blobUrl, "_blank", "noopener,noreferrer");
                    } catch (err) {
                      console.error("メディアのオープンに失敗:", err);
                    }
                  }}
                />
              )}
              {rightTab === "prov" && (
                <ProvGraphPanel doc={provDoc} />
              )}
              {rightTab === "chat" && (
                <AiAssistantPanel
                  onSubmit={handleAiChatSubmit}
                  onInsertToScope={handleInsertToScope}
                  onReplaceBlocks={handleReplaceBlocks}
                  onDeriveNote={handleAiDeriveFromChat}
                  onIngestChat={onIngestChat}
                  noteIndex={noteIndex}
                  onOpenWiki={(wikiId) => onNavigateNote(`wiki:${wikiId}`)}
                />
              )}
              {rightTab === "history" && (
                <DocumentProvenancePanel provenance={currentProvenance} onHighlightBlocks={setHighlightBlockIds} />
              )}
              {rightTab === "source" && sourceDoc && (
                <SourceDocPanel doc={sourceDoc} />
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
            { tab: "chat" as const, icon: <MessageSquare size={18} />, label: "Chat", show: aiAvailable },
            { tab: "graph" as const, icon: <Network size={18} />, label: "Graph", show: noteGraphData.nodes.length > 1 || (lineageTree?.parents.length ?? 0) > 0 },
            { tab: "prov" as const, icon: <GitBranch size={18} />, label: t("panel.prov"), show: labelStore.labels.size > 0 },
            { tab: "history" as const, icon: <History size={18} />, label: t("panel.history"), show: true },
            ...(sourceDoc ? [{ tab: "source" as const, icon: <FileText size={18} />, label: "Source", show: true }] : []),
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
          minWidth: 400, maxWidth: 800, background: "var(--color-card)",
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
  // AI バックエンド接続チェック（GitHub Pages 等の静的サイトでは false）
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchModels } = await import("./features/ai-assistant/api");
        await fetchModels();
        if (!cancelled) setAiAvailable(true);
      } catch {
        // sidecar 復旧を試みる（Tauri 環境のみ）
        try {
          const recovered = await ensureSidecar();
          if (recovered) {
            const { fetchModels } = await import("./features/ai-assistant/api");
            await fetchModels();
            if (!cancelled) setAiAvailable(true);
            return;
          }
        } catch { /* sidecar 復旧も失敗 */ }
        if (!cancelled) setAiAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // デスクトップ用: 集中モード（左サイドバーを折り畳む）。設定は localStorage に永続化。
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("graphium-sidebar-collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("graphium-sidebar-collapsed", desktopSidebarCollapsed ? "1" : "0"); } catch {}
  }, [desktopSidebarCollapsed]);
  const [showMemos, setShowMemos] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showSharedLibrary, setShowSharedLibrary] = useState(false);

  // Cmd+K Composer（統一された AI 呼び出し口 / UX Audit #04）
  // Ask のみ UI 公開。他モードの実装は NoteEditorInner 内のハンドラに保持（将来用）。
  // useComposer の組み込みショートカットは無効化して、ここで fm.activeFileId を見て
  // 「ノート上でのみ開く」よう制御する。
  const composer = useComposer({ disableShortcut: true });
  const [composerPrompt, setComposerPrompt] = useState("");
  // 発見カード — Composer が開かれたときに直近 7 日の wikiLog を取得して計算
  const [recentWikiLogEntries, setRecentWikiLogEntries] = useState<WikiLogEntry[]>([]);
  const composerSubmitRef = useRef<
    ((submission: ComposerSubmission) => void | Promise<void>) | null
  >(null);
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
  const [ingestToast, setIngestToast] = useState<IngestToastState>(null);
  const ingestQueueRef = useRef<{ noteId: string; noteTitle: string; doc: import("./lib/document-types").GraphiumDocument }[]>([]);
  const ingestRunningRef = useRef(false);
  // Wiki Log 表示状態
  const [activeWikiView, setActiveWikiView] = useState<"log" | "lint" | null>(null);
  // Skill 表示状態
  const [showSkillList, setShowSkillList] = useState(false);
  const [showNewSkillDialog, setShowNewSkillDialog] = useState(false);
  const [lintReport, setLintReport] = useState<import("./server/services/wiki-linter").LintReport | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  // メモ挿入リクエスト（メモギャラリー → エディタ）
  const [pendingMemoInsert, setPendingMemoInsert] = useState<{ captureId: string; text: string; deleteAfter: boolean } | null>(null);
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
  const capture = useCapture(authenticated);
  // 通常ノート ID → 派生 wiki エントリ配列の逆引きマップ（Knowledge 化済み判定用）
  const appKnowledgeMap = useMemo(() => buildKnowledgeMap(fm.noteIndex ?? null), [fm.noteIndex]);

  // Phase 4 (PR-B7): PROV-JSON-LD エクスポートに含める Wiki Knowledge Layer の
  // 意味的な型（atomType / synthesisMode / procedureContext / ...）を組み立てる。
  // wiki state が変わったときだけ再計算する。
  const provWikiEntities = useMemo<WikiEntityInfo[]>(() => {
    const out: WikiEntityInfo[] = [];
    for (const wf of fm.wikiFiles) {
      const meta = fm.wikiMetas.get(wf.id);
      if (!meta) continue;
      const doc = fm.getCachedDoc(`wiki:${wf.id}`);
      const wm = doc?.wikiMeta;
      out.push({
        title: meta.title,
        kind: meta.kind,
        status: meta.status ?? "active",
        generatedAt: wm?.generatedAt ?? wf.modifiedTime,
        model: wm?.generatedBy?.model ?? meta.model ?? "unknown",
        derivedFromNotes: wm?.derivedFromNotes ?? [],
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
  }, [fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc]);

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

  // Cmd+K: NoteEditor がマウント中のみ Composer を開く。
  // composerSubmitRef.current は NoteEditorInner の useEffect で登録/解除されるので、
  // 「ハンドラがある＝編集面が表示されている」を一発の真偽で判定できる。
  // 一覧・Wiki ハブ・アセットギャラリー等では NoteEditor がそもそも描画されないため null。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (!composerSubmitRef.current) return;
        e.preventDefault();
        composer.toggleComposer();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [composer]);

  // ⌘+⇧+M: どこからでも Quick Memo ダイアログを開く。
  // メモは「気軽な思いつきを書き留める原料」なので、画面状態に依存せず
  // ノート編集中でも一覧画面でも同じ操作で開けるよう document レベルで購読する。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setShowQuickMemoDialog(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ノートにはグローバルショートカットを設けない。
  // 理由: ⌘⇧N はブラウザのシークレットウィンドウと衝突して preventDefault が効かないため、
  // 学習させたショートカットが裏切る体験になる。サイドバーの「+ ノート」ボタンが常設の入口。
  // ノートはじっくり書くもの、メモは即記録、というメンタルモデルの非対称さも UI で素直に表現する。

  // Composer が開いた瞬間だけ wikiLog の直近イベントを取得してカード計算に使う
  // (常時 subscribe しない理由: ログは IndexedDB なので軽量、開いた時だけで十分)
  useEffect(() => {
    if (!composer.open) return;
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
    setShowSharedLibrary: (show: boolean) => setShowSharedLibrary(show),
    clearViews: () => {
      fm.setShowNoteList(false);
      fm.setActiveAssetType(null);
      fm.setActiveLabel(null);
      fm.setActiveWikiKind(null);
      setActiveWikiView(null);
      setShowMemos(false);
      setShowSharedLibrary(false);
    },
  }), [fm]);
  const router = useHashRouter(routeActions, !fm.filesLoading);

  // Ingest キューを処理する関数
  const processIngestQueue = useCallback(async () => {
    if (ingestRunningRef.current) return;
    ingestRunningRef.current = true;

    while (ingestQueueRef.current.length > 0) {
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
          "ja",
        );

        // 設定で選んだ既定モデル名を渡す。Tauri モードではヘッダーに API キーを乗せないため、
        // body.model 経由でサーバーに伝えないと models.json 先頭のモデルにフォールバックしてしまう。
        const result = await ingestNote(job.noteId, job.doc, existingWikis, "ja", getSelectedModel() || undefined, ingestSkills);

        if (result.wikis.length === 0) {
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === jobId ? { ...i, status: "error" as const, detail: undefined, result: "内容不足" } : i
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
                const mergedDoc = await rewriteAndMerge(existingDoc, wiki, job.noteId, result.model, "ja", nIdx, ingestSkills);
                await fm.handleSaveWikiFile(wiki.mergeTargetId, mergedDoc, {
                  activityType: "ai_generation",
                  agentLabel: result.model ?? undefined,
                });
                embedWikiSections(wiki.mergeTargetId, mergedDoc).catch(() => {});
                createdWikiIds.push(wiki.mergeTargetId);
                createdWikiTitles.push(wiki.title);
                wikiLog.append("merge", [wiki.mergeTargetId], `Merged into "${wiki.title}" from "${job.noteTitle}"`).catch(() => {});
                continue;
              }
            } catch { /* fallback to create */ }
          }
          const wikiTitleMap = existingWikis.map((w) => ({ id: w.id, title: w.title }));
          const wikiDoc = buildWikiDocument(wiki, job.noteId, result.model, job.noteTitle, wikiTitleMap, "ja", buildNoteIndex(fm.noteIndex));
          // 使用した Skill を記録
          if (ingestSkills.length > 0 && wikiDoc.wikiMeta) {
            wikiDoc.wikiMeta.skillsUsed = ingestSkills.map((s) => s.title);
          }
          const newId = await fm.handleCreateWikiFile(wikiDoc);
          embedWikiSections(newId, wikiDoc).catch(() => {});
          createdWikiIds.push(newId);
          createdWikiTitles.push(wiki.title);
          wikiLog.append("ingest", [newId], `Created "${wiki.title}" from "${job.noteTitle}"`).catch(() => {});
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
                const noteContent = job.doc.pages[0]?.blocks
                  ?.map((b: any) => {
                    if (Array.isArray(b.content)) return b.content.map((c: any) => c.text ?? "").join("");
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n") ?? "";

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
                  language: "ja",
                  ...(ingestSkills.length > 0 ? { skills: ingestSkills } : {}),
                });

                for (const proposal of crossResult.proposals) {
                  const targetDoc = fm.getCachedDoc(`wiki:${proposal.targetWikiId}`);
                  if (!targetDoc) continue;
                  const updatedDoc = await applyCrossUpdate(targetDoc, proposal, job.noteId, result.model, buildNoteIndex(fm.noteIndex), ingestSkills);
                  await fm.handleSaveWikiFile(proposal.targetWikiId, updatedDoc, {
                    activityType: "ai_generation",
                    agentLabel: result.model ?? undefined,
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
        setIngestToast((prev) => ({
          items: (prev?.items ?? []).map((i) =>
            i.id === jobId
              ? { ...i, status: "error" as const, detail: undefined, result: err instanceof Error ? err.message : "Error" }
              : i
          ),
        }));
      }

      ingestQueueRef.current.shift();
    }

    // パイプライン後半（Atomize / Synthesize / Lint）の進捗を 1 つの
    // トーストアイテムで可視化する。スキップ理由・件数を ユーザーに見せ、
    // 「summary 出た後に何が動いているのか分からない」状態を解消する。
    const pipelineId = `pipeline:${Date.now()}`;
    const pipelineStages: IngestStage[] = [
      { key: "atomize", label: "Atomize", status: "pending" },
      { key: "synthesize", label: "Synthesize", status: "pending" },
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

    // 自動 Atomize: experimental.atomLayer 有効時、全 Concept を見渡して
    // 共通抽象を discover する。Phase 1: クラスタ集中サンプリングを適用。
    // バルク投入直後の自動実行なので、メンテよりも K の上限を控えめ（=3）にする。
    //
    // 直後の Synthesize 段でも参照できるように、新規 Atom の ClaimSnapshot を
    // ローカルに蓄積する。`fm.wikiMetas` はクロージャ閉じ込みで再 render するまで
    // 更新されないため、ここで作った Atom を直に渡さないと Synthesize は
    // 「Atom 0 件」状態で走ってしまう（過去のバルク投入で発想が全く出なかった主因）。
    const newAtomSnapshots: ClaimSnapshot[] = [];
    const atomLabel = tStatic("settings.maintenance.kind.atom");
    const synthLabel = tStatic("settings.maintenance.kind.synthesis");
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
          updateStage("atomize", "skipped", `Claim ${allClaimSnapshots.length} 件（2 件以上で実行）`);
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
          updateStage(
            "atomize",
            "running",
            `${allClaimSnapshots.length} claims / ${seeds.length} clusters を分析中...`,
          );
          for (let i = 0; i < seeds.length; i++) {
            const seed = seeds[i];
            const cluster = buildClusterSlice(claimCandidates, seed, MAX_SNAPSHOTS_PER_RUN);
            const slice = cluster.map((c) => c.snapshot);
            updateStage(
              "atomize",
              "running",
              `cluster ${i + 1}/${seeds.length} 「${seed.snapshot.title}」 (${slice.length} ${atomLabel})`,
            );
            const atomResult = await atomizeConcepts(
              slice,
              "ja",
              { existingAtomTitles, model: getChatSynthesisModelName() || undefined },
            );
            for (const candidate of atomResult.atoms) {
              const atomDoc = buildAtomDocument(candidate, atomResult.model ?? null, "ja");
              const newId = await fm.handleCreateWikiFile(atomDoc);
              embedWikiSections(newId, atomDoc).catch(() => {});
              wikiLog.append(
                "ingest",
                [newId],
                `${atomLabel}: "${candidate.title}" (from ${candidate.derivedFromConceptTitles.join(" + ")})`,
              ).catch(() => {});
              createdAtoms += 1;
              existingAtomTitles.push(candidate.title);
              // Synthesize 段に渡すため新規 Atom を ClaimSnapshot 形に詰めておく。
              // body は atom 本文ではなく abstraction の summary（candidate.body）が
              // 最も意味的に近いので preview として使う。
              newAtomSnapshots.push({
                id: newId,
                title: candidate.title,
                bodyPreview: candidate.body ?? "",
                level: undefined,
                relatedClaims: [],
                sourceSummaryPreviews: [],
                atomType: candidate.atomType,
              });
            }
          }
          updateStage(
            "atomize",
            "done",
            createdAtoms > 0 ? `${createdAtoms} ${atomLabel}` : `新規 ${atomLabel} なし`,
          );
        }
      } catch (err) {
        console.error("Atomize failed:", err);
        updateStage("atomize", "error", err instanceof Error ? err.message : String(err));
      }
    } else {
      updateStage("atomize", "skipped", "Atom Layer が無効");
    }

    // 自動 Synthesis: synthesis レイヤが有効なときのみ。
    // Phase 1: クラスタ集中サンプリング + バルク経路では K 上限 2 で控えめに実行。
    // 入力 Atom には wikiMetas 由来（過去の Atom）+ 直前の Atomize で作った新規 Atom を
    // マージして渡す。`fm.wikiMetas` だけだと新規 Atom がスタールで含まれない。
    if (isSynthesisEnabled()) {
      try {
        const existingAtomSnapshots = buildClaimSnapshots(
          fm.wikiFiles,
          fm.wikiMetas,
          fm.getCachedDoc,
          "atom",
          Number.POSITIVE_INFINITY,
        );
        const allAtomSnapshots = [...existingAtomSnapshots, ...newAtomSnapshots];
        if (allAtomSnapshots.length < 3) {
          updateStage("synthesize", "skipped", `Atom ${allAtomSnapshots.length} 件（3 件以上で実行）`);
        } else {
          const atomModifiedByFileId = new Map(fm.wikiFiles.map((f) => [f.id, f.modifiedTime]));
          const nowIso = new Date().toISOString();
          const atomEmbeddings = await Promise.all(
            allAtomSnapshots.map((s) => getDocEmbedding(s.id).catch(() => null)),
          );
          const atomCandidates: AtomCandidate[] = allAtomSnapshots.map((s, i) => ({
            snapshot: s,
            similarityText: `${s.title}\n${s.bodyPreview}`,
            embedding: atomEmbeddings[i],
            // 新規 Atom は wikiFiles にまだ載っていないので最新時刻扱いにする
            modifiedTime: atomModifiedByFileId.get(s.id) ?? nowIso,
          }));
          const clusterCount = pickClusterCount(atomCandidates.length, {
            effectiveCoverage: 30,
            maxK: 2,
          });
          const seeds = pickFarthestSeeds(atomCandidates, clusterCount);
          const existingSynthesisTitles = [...fm.wikiMetas.entries()]
            .filter(([, m]) => m.kind === "synthesis")
            .map(([, m]) => m.title);
          let createdSyntheses = 0;
          updateStage(
            "synthesize",
            "running",
            `${allAtomSnapshots.length} atoms / ${seeds.length} clusters を結晶化中...`,
          );
          for (let i = 0; i < seeds.length; i++) {
            const seed = seeds[i];
            const cluster = buildClusterSlice(atomCandidates, seed, MAX_SNAPSHOTS_PER_RUN);
            const slice = cluster.map((c) => c.snapshot);
            updateStage(
              "synthesize",
              "running",
              `cluster ${i + 1}/${seeds.length} 「${seed.snapshot.title}」 (${slice.length} ${atomLabel})`,
            );
            const synthResult = await fetchSynthesisCandidates(
              slice,
              existingSynthesisTitles,
              "ja",
              getChatSynthesisModelName() || undefined,
            );
            for (const candidate of synthResult.candidates) {
              const synthDoc = buildSynthesisDocument(candidate, synthResult.model ?? null, "ja", buildNoteIndex(fm.noteIndex));
              const newId = await fm.handleCreateWikiFile(synthDoc);
              embedWikiSections(newId, synthDoc).catch(() => {});
              wikiLog.append(
                "ingest",
                [newId],
                `${synthLabel}: "${candidate.title}" (from ${candidate.sourceConceptTitles.join(" + ")})`,
              ).catch(() => {});
              createdSyntheses += 1;
              existingSynthesisTitles.push(candidate.title);
            }
          }
          updateStage(
            "synthesize",
            "done",
            createdSyntheses > 0 ? `${createdSyntheses} ${synthLabel}` : `新規 ${synthLabel} なし`,
          );
        }
      } catch (err) {
        console.error("Synthesis failed:", err);
        updateStage("synthesize", "error", err instanceof Error ? err.message : String(err));
      }
    } else {
      updateStage("synthesize", "skipped", "Synthesis Layer が無効");
    }

    // 自動 Lint: ローカル検出 + LLM 分析（5ページ以上で LLM 実行）
    try {
      const snapshots = buildWikiSnapshots(fm.wikiFiles, fm.wikiMetas, fm.getCachedDoc);
      if (snapshots.length < 2) {
        updateStage("lint", "skipped", `Wiki ${snapshots.length} 件（2 件以上で実行）`);
      } else {
        updateStage("lint", "running", `${snapshots.length} wikis を分析中...`);
        // LLM Lint: 5ページ以上で矛盾・ギャップを LLM で分析
        const useLlm = snapshots.length >= 5;
        const report = await lintWikis(snapshots, "ja", !useLlm);
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
                const orphanSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
                const crossResult = await fetchCrossUpdateProposals({
                  newNoteTitle: doc.title,
                  newNoteContent: detail.sectionPreviews.join("\n"),
                  newWikiTitles: [doc.title],
                  existingWikis: otherConcepts,
                  language: "ja",
                  ...(orphanSkills.length > 0 ? { skills: orphanSkills } : {}),
                });
                for (const proposal of crossResult.proposals) {
                  const targetDoc = fm.getCachedDoc(`wiki:${proposal.targetWikiId}`);
                  if (!targetDoc) continue;
                  const updated = await applyCrossUpdate(targetDoc, proposal, wikiId, null, buildNoteIndex(fm.noteIndex), orphanSkills);
                  await fm.handleSaveWikiFile(proposal.targetWikiId, updated, {
                    activityType: "ai_generation",
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
                const mergeSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
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
                  "ja",
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
                  activityType: "ai_generation",
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
          issues.length > 0 ? `${issues.length} issues` : "問題なし",
        );
      }
    } catch (err) {
      // Lint 失敗は ingest 全体には影響させない
      console.error("Lint failed:", err);
      updateStage("lint", "error", err instanceof Error ? err.message : String(err));
    }

    ingestRunningRef.current = false;
  }, [fm]);

  const enqueueIngest = useCallback((noteId: string, noteTitle: string, doc: import("./lib/document-types").GraphiumDocument) => {
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
        const report = await lintWikis(snapshots, "ja", !useLlm);

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
                const mergeSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
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
                  "ja",
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
                  activityType: "ai_generation",
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

  // エディタ参照（メディアリネーム時のブロック同期用）
  const noteEditorRef = useRef<any>(null);

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

  // Wiki 単体の再生成（WikiBanner / Settings の Maintenance タブ両方から呼ばれる）
  // openAfter=true で再生成後にエディタで開く（バナー経由のとき）
  // ⚠️ 早期 return より前に置くこと（Rules of Hooks）
  const regenerateWikiById = useCallback(async (
    wikiId: string,
    options?: { model?: string; openAfter?: boolean },
  ): Promise<{ ok: boolean; error?: string }> => {
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
        // ClaimSnapshot に詰めて atomizer に投げ、同タイトルの候補を採用する。
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

        if (snapshots.length < 2) {
          const totalSources = claimIds.length;
          const errMsg =
            totalSources === 0
              ? "Atom has no source Concepts recorded"
              : `Atom needs ≥2 source Concepts; only ${snapshots.length} of ${totalSources} remain as Claim`;
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }

        const atomResult = await atomizeConcepts(snapshots, "ja", {
          // 同タイトルの再提案を阻害しないため existingAtomTitles は空で渡す
          model: selectedModel ?? getChatSynthesisModelName() ?? undefined,
        });
        const matchedAtom =
          atomResult.atoms.find((a) => a.title === wikiTitle) ?? atomResult.atoms[0] ?? null;
        if (!matchedAtom) {
          const errMsg = "No atom candidate generated";
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }

        const newDoc = buildAtomDocument(matchedAtom, atomResult.model ?? null, "ja");
        // 既存 Atom が持っていた derivedFromClaims を温存する
        // （atomizer 提案の derivedFromClaims はその回の入力に依存し、
        //  ユーザーが手動で集めたソース集合とは限らない）
        const rewritten: GraphiumDocument = {
          ...newDoc,
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
          activityType: "ai_generation",
          agentLabel: atomResult.model ?? selectedModel ?? undefined,
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
        const sourceConceptIds = doc.wikiMeta.derivedFromNotes;
        const concepts: { id: string; title: string; bodyPreview: string; level?: "principle" | "finding" | "bridge"; relatedClaims: string[] }[] = [];
        for (const cId of sourceConceptIds) {
          const cDoc = await fm.loadDoc(`wiki:${cId}`);
          if (!cDoc) continue;
          // Synthesis のソースは Concept (claim) / Atom / Summary を許容する。
          // 過去の synthesizer 出力では Summary も sourceConceptIds に混じることがあり、
          // ここで弾くと既存 synthesis が「source pages missing」で再生成不能になる
          // （実データで Summary を含む derivedFromNotes が観測されている）。
          const sourceKind = cDoc.wikiMeta?.kind;
          if (sourceKind !== "claim" && sourceKind !== "atom" && sourceKind !== "summary") continue;
          concepts.push({
            id: cId,
            title: cDoc.title,
            bodyPreview: extractBodyPreview(cDoc, 240),
            level: cDoc.wikiMeta?.level,
            relatedClaims: [],
          });
        }

        if (concepts.length < 2) {
          // Synthesis は最低 2 件のソース（Concept/Atom）が必要。
          // 1 件残っている場合と 0 件の場合で文言を分け、ユーザーが状況を理解できるようにする。
          const totalSources = doc.wikiMeta.derivedFromNotes.length;
          const errMsg =
            totalSources === 0
              ? "Synthesis has no source pages recorded"
              : concepts.length === 0
                ? `All ${totalSources} source page(s) are missing or deleted`
                : `Synthesis needs ≥2 source pages; only ${concepts.length} of ${totalSources} remain`;
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }

        const synthHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (!isTauri()) {
          // Synthesis は Chat & Synthesis モデル経由（未設定なら default にフォールバック）
          const llmModel = getChatSynthesisLLMModel();
          if (llmModel) {
            synthHeaders["X-LLM-API-Key"] = JSON.stringify({
              provider: llmModel.provider, modelId: llmModel.modelId,
              apiKey: llmModel.apiKey, apiBase: llmModel.apiBase, name: llmModel.name,
            });
          }
        }
        const synthSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
        const synthRes = await fetch(`${apiBase()}/wiki/synthesize`, {
          method: "POST",
          headers: synthHeaders,
          body: JSON.stringify({
            concepts,
            existingSynthesisTitles: [],
            language: "ja",
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(synthSkills.length > 0 ? { skills: synthSkills } : {}),
          }),
        });
        const synthResult = synthRes.ok
          ? await synthRes.json() as {
              candidates: any[];
              model?: string;
              stats?: {
                rawCount: number;
                droppedByConfidence: number;
                maxDroppedConfidence?: number;
                threshold: number;
              };
            }
          : { candidates: [] as any[], stats: undefined };
        if (synthResult.candidates && synthResult.candidates.length > 0) {
          const candidate = synthResult.candidates[0];
          const newDoc = buildSynthesisDocument(candidate, synthResult.model ?? null, "ja", buildNoteIndex(fm.noteIndex));
          if (newDoc.wikiMeta) {
            newDoc.wikiMeta.generatedBy = {
              model: synthResult.model ?? selectedModel ?? "unknown",
              version: "1.0.0",
            };
          }

          // 縮小ガード: 既存 Synthesis (Idea) が育っていた場合、新しい候補が
          // 極端に短ければ採用しない。merge ingest や手動編集で蓄積された本文を
          // 一発の synthesize 出力で痩せさせる事故を防ぐ。
          // 閾値: 既存が 200 文字超 かつ 新出力が既存の 50% 未満。
          const existingTextLength = extractPlainTextFromDoc(doc).length;
          const newTextLength = extractPlainTextFromDoc(newDoc).length;
          if (existingTextLength > 200 && newTextLength < existingTextLength * 0.5) {
            const errMsg = `New synthesis is shorter than half of the existing body (${newTextLength} < ${existingTextLength}/2). Kept existing.`;
            setIngestToast((prev) => ({
              items: (prev?.items ?? []).map((i) =>
                i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
              ),
            }));
            return { ok: false, error: errMsg };
          }

          await fm.handleSaveWikiFile(wikiId, newDoc, {
            activityType: "ai_generation",
            agentLabel: synthResult.model ?? selectedModel ?? undefined,
          });
          embedWikiSections(wikiId, newDoc).catch(() => {});
          if (openAfter) fm.handleOpenWikiFile(wikiId);
          const modelLabel = synthResult.model ?? selectedModel ?? "default";
          wikiLog.append("regenerate", [wikiId], `Regenerated synthesis "${wikiTitle}" with ${modelLabel}`).catch(() => {});

          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "success" as const, detail: undefined, result: modelLabel } : i
            ),
          }));
          return { ok: true };
        } else {
          // 「No synthesis generated」が confidence ガード由来か LLM 出力空かを区別する
          const stats = (synthResult as { stats?: { rawCount: number; droppedByConfidence: number; maxDroppedConfidence?: number; threshold: number } }).stats;
          let errMsg = "No synthesis generated";
          if (stats) {
            if (stats.droppedByConfidence > 0 && stats.droppedByConfidence === stats.rawCount) {
              const maxConf = stats.maxDroppedConfidence?.toFixed(2) ?? "?";
              errMsg = `Quality below threshold (max conf ${maxConf} < ${stats.threshold}). Source pages may be too few or unrelated to synthesize confidently.`;
            } else if (stats.rawCount === 0) {
              errMsg = "LLM returned no synthesis candidates. Source pages may be too few or unrelated.";
            }
          }
          setIngestToast((prev) => ({
            items: (prev?.items ?? []).map((i) =>
              i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: errMsg } : i
            ),
          }));
          return { ok: false, error: errMsg };
        }
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

        const regenIngestSkills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
        const result = await ingestFromMultiSource(
          parts,
          wikiTitle,
          wikiId,
          [],
          "ja",
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
            "ja",
            buildNoteIndex(fm.noteIndex),
          );
          // derivedFromNotes は **元の配列をそのまま保持** する。
          // 自己参照（wikiId）と取得失敗ソースだけ落として保存する設計。
          const preservedDerivedFromNotes = (doc.wikiMeta?.derivedFromNotes ?? []).filter(
            (id) => id !== wikiId,
          );
          const rewritten: GraphiumDocument = {
            ...newDoc,
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
            activityType: "ai_generation",
            agentLabel: result.model ?? selectedModel ?? undefined,
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
      console.error("Wiki の再生成に失敗:", err);
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: err instanceof Error ? err.message : "Failed" } : i
        ),
      }));
      return { ok: false, error: err instanceof Error ? err.message : "Failed" };
    }
  }, [fm]);

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
  ): Promise<{ ok: boolean; created: number; iterations: number; error?: string }> => {
    if (!isAtomLayerEnabled()) {
      return { ok: false, created: 0, iterations: 0, error: "Atom layer is disabled" };
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
    let lastIteration = 0;
    try {
      for (let iter = 1; iter <= seeds.length; iter++) {
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
          "ja",
          { existingAtomTitles, model: getChatSynthesisModelName() || undefined },
        );
        // クラスタごとに独立して回すため、収束（候補なし）時も次のクラスタは試す。
        if (result.atoms.length === 0) continue;
        // 既存 Atom との embedding 類似度で post-filter（embedding 未設定なら素通し）
        const existingAtomDocIds = new Set(
          [...fm.wikiMetas.entries()].filter(([, m]) => m.kind === "atom").map(([id]) => id),
        );
        const filtered = await dedupCandidatesByEmbedding(result.atoms, existingAtomDocIds);
        if (filtered.length === 0) continue; // このクラスタは既存と被り → 次のクラスタへ
        for (const candidate of filtered) {
          const atomDoc = buildAtomDocument(candidate, result.model ?? null, "ja");
          const newId = await fm.handleCreateWikiFile(atomDoc);
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
            ? { ...i, status: "success" as const, detail: undefined, result: `${totalCreated} ${atomLabel}` }
            : i
        ),
      }));
      return { ok: true, created: totalCreated, iterations: lastIteration };
    } catch (err) {
      console.error("Atomize discovery failed:", err);
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: err instanceof Error ? err.message : "Failed" } : i
        ),
      }));
      return { ok: false, created: totalCreated, iterations: lastIteration, error: err instanceof Error ? err.message : "Failed" };
    }
  }, [fm]);

  // 全 Atom を見渡して新しい洞察（Synthesis）を発見する discovery 呼び出し（auto-loop 付き）。
  // 構造は runAtomizeDiscovery と同じ。Synthesis は Atom 層の上に乗るため、
  // experimental.synthesis（atomLayer 前提）が ON のときのみ動く。
  // ⚠️ 早期 return より前に置くこと（Rules of Hooks）
  const runSynthesisDiscovery = useCallback(async (
    onProgress?: (info: {
      iteration: number;
      createdSoFar: number;
      clusterLabel?: string;
      clusterTotal?: number;
      clusterSize?: number;
      clusterMemberTitles?: string[];
    }) => void,
  ): Promise<{ ok: boolean; created: number; iterations: number; error?: string }> => {
    if (!isSynthesisEnabled()) {
      return { ok: false, created: 0, iterations: 0, error: "Synthesis layer is disabled" };
    }

    // Phase 1: クラスタ集中サンプリング。
    // 母集団は modifiedTime 上限なしで全 Atom を取得し、シードを farthest-point で
    // 散らして iteration ごとに別領域のクラスタを synthesizer に投げる。
    // これにより「直近触れた領域だけ繰り返し見る」問題を解消する。
    const allAtomSnapshots = buildClaimSnapshots(
      fm.wikiFiles,
      fm.wikiMetas,
      fm.getCachedDoc,
      "atom",
      Number.POSITIVE_INFINITY,
    );
    if (allAtomSnapshots.length < 3) {
      return { ok: false, created: 0, iterations: 0, error: "Need at least 3 Atoms" };
    }

    // 各 Atom の代表 embedding（section 平均）を並列取得。未生成は null。
    const modifiedByFileId = new Map(fm.wikiFiles.map((f) => [f.id, f.modifiedTime]));
    const embeddings = await Promise.all(
      allAtomSnapshots.map((s) => getDocEmbedding(s.id).catch(() => null)),
    );
    const atomCandidates: AtomCandidate[] = allAtomSnapshots.map((s, i) => ({
      snapshot: s,
      similarityText: `${s.title}\n${s.bodyPreview}`,
      embedding: embeddings[i],
      modifiedTime: modifiedByFileId.get(s.id) ?? "",
    }));

    // Synthesis は Atom の組み合わせから立ち上がる洞察。組み合わせ数は C(n,2..4) で
    // 爆発するため、原理的には収束しない。母集団規模からクラスタ数を動的決定し、
    // 1 クリックの LLM コストを上限 8 で抑える。続きが欲しければユーザーが再押下する。
    const MAX_ITERATIONS = pickClusterCount(atomCandidates.length, {
      effectiveCoverage: 30,
      maxK: 8,
    });
    const seeds = pickFarthestSeeds(atomCandidates, MAX_ITERATIONS);
    const existingSynthesisTitles = [...fm.wikiMetas.entries()]
      .filter(([, m]) => m.kind === "synthesis")
      .map(([, m]) => m.title);

    const atomLabel = tStatic("settings.maintenance.kind.atom");
    const synthLabel = tStatic("settings.maintenance.kind.synthesis");
    const toastId = `synthesis-discovery:${Date.now()}`;
    setIngestToast((prev) => ({
      items: [
        ...(prev?.items ?? []),
        { id: toastId, status: "generating" as const, noteTitle: `Discovering ${synthLabel} across ${allAtomSnapshots.length} ${atomLabel} (${seeds.length} clusters)` },
      ],
    }));

    let totalCreated = 0;
    let lastIteration = 0;
    try {
      for (let iter = 1; iter <= seeds.length; iter++) {
        lastIteration = iter;
        const seed = seeds[iter - 1];
        const cluster = buildClusterSlice(atomCandidates, seed, MAX_SNAPSHOTS_PER_RUN);
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
              ? { ...i, noteTitle: `Discovering · cluster ${iter}/${seeds.length} 「${seed.snapshot.title}」 (${slice.length} ${atomLabel})` }
              : i
          ),
        }));
        const result = await fetchSynthesisCandidates(
          slice,
          existingSynthesisTitles,
          "ja",
          getChatSynthesisModelName() || undefined,
        );
        // クラスタごとに独立して回すため、収束（候補なし）時も次のクラスタは試す。
        if (result.candidates.length === 0) continue;
        // 既存 Synthesis との embedding 類似度で post-filter（embedding 未設定なら素通し）
        const existingSynthDocIds = new Set(
          [...fm.wikiMetas.entries()].filter(([, m]) => m.kind === "synthesis").map(([id]) => id),
        );
        // dedup ヘルパは { title, body } を期待するので sections を結合した body を作る
        const candidatesForDedup = result.candidates.map((c) => ({
          title: c.title,
          body: c.sections.map((s) => `${s.heading}\n${s.content}`).join("\n\n"),
          original: c,
        }));
        const filtered = await dedupCandidatesByEmbedding(candidatesForDedup, existingSynthDocIds);
        if (filtered.length === 0) continue;
        for (const f of filtered) {
          const candidate = f.original;
          const synthDoc = buildSynthesisDocument(
            candidate,
            result.model ?? null,
            "ja",
            buildNoteIndex(fm.noteIndex),
          );
          const newId = await fm.handleCreateWikiFile(synthDoc);
          embedWikiSections(newId, synthDoc).catch(() => {});
          wikiLog.append(
            "ingest",
            [newId],
            `${synthLabel}: "${candidate.title}" (from ${candidate.sourceConceptTitles.join(" + ")})`,
          ).catch(() => {});
          totalCreated += 1;
          existingSynthesisTitles.push(candidate.title);
        }
      }
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId
            ? { ...i, status: "success" as const, detail: undefined, result: `${totalCreated} ${synthLabel}` }
            : i
        ),
      }));
      return { ok: true, created: totalCreated, iterations: lastIteration };
    } catch (err) {
      console.error("Synthesis discovery failed:", err);
      setIngestToast((prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === toastId ? { ...i, status: "error" as const, detail: undefined, result: err instanceof Error ? err.message : "Failed" } : i
        ),
      }));
      return { ok: false, created: totalCreated, iterations: lastIteration, error: err instanceof Error ? err.message : "Failed" };
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
    onSelect: (fileId: string) => { fm.handleOpenFile(fileId); setShowMemos(false); setShowTrash(false); setShowSharedLibrary(false); setShowSkillList(false); setActiveWikiView(null); setSidebarOpen(false); router.navigate({ view: "editor", fileId }); },
    onNewNote: () => { fm.handleNewNote(); setShowMemos(false); setShowTrash(false); setShowSharedLibrary(false); setShowSkillList(false); setActiveWikiView(null); setSidebarOpen(false); },
    onNewMemo: () => { setShowQuickMemoDialog(true); setSidebarOpen(false); },
    onRefresh: fm.refreshFiles,
    onShowReleaseNotes: () => setShowReleaseNotes(true),
    onShowSettings: () => { setShowSettings(true); setSidebarOpen(false); },
    agentConfigured,
    recentNotes: fm.recentNotes,
    onShowNoteList: () => { fm.setShowNoteList(true); fm.setActiveAssetType(null); fm.setActiveLabel(null); setShowMemos(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "notes" }); },
    noteListActive: fm.showNoteList,
    mediaIndex: fm.mediaIndex,
    onShowAssetGallery: (type: import("./features/asset-browser").MediaType) => { fm.setActiveAssetType(type); fm.setShowNoteList(false); fm.setActiveLabel(null); setShowMemos(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "assets", mediaType: type }); },
    noteIndex: fm.noteIndex,
    onShowLabelGallery: (label: string) => { fm.setActiveLabel(label); fm.setActiveAssetType(null); fm.setShowNoteList(false); setShowMemos(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "labels", label }); },
    activeAssetType: fm.activeAssetType,
    activeLabel: fm.activeLabel,
    filesLoading: fm.filesLoading,
    memoCount: capture.captureIndex?.captures.length ?? 0,
    onShowMemos: () => { setShowMemos(true); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "memos" }); },
    memosActive: showMemos,
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
    showAtomLayer: experimentalFlags.atomLayer,
    showSynthesisLayer: experimentalFlags.atomLayer && experimentalFlags.synthesis,
    onShowWikiList: (kind: WikiKind) => { fm.setActiveWikiKind(kind); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setShowMemos(false); setActiveWikiView(null); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "wiki-list", kind }); },
    activeWikiKind: fm.activeWikiKind,
    aiAvailable: aiAvailable ?? false,
    onShowWikiLog: () => { setActiveWikiView("log"); fm.setActiveWikiKind(null); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setShowMemos(false); setShowSkillList(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "wiki-log" }); },
    onShowWikiLint: () => { setActiveWikiView("lint"); fm.setActiveWikiKind(null); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setShowMemos(false); setShowSkillList(false); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); router.navigate({ view: "wiki-lint" }); },
    activeWikiView,
    skillCount: fm.skillMetas.size,
    onShowSkillList: () => { setShowSkillList(true); fm.setActiveWikiKind(null); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setShowMemos(false); setActiveWikiView(null); setShowTrash(false); setShowSharedLibrary(false); setSidebarOpen(false); },
    skillActive: showSkillList,
    onShowTrash: () => {
      setShowTrash(true);
      fm.setActiveAssetType(null);
      fm.setActiveLabel(null);
      fm.setActiveWikiKind(null);
      fm.setShowNoteList(false);
      setShowMemos(false);
      setShowSkillList(false);
      setActiveWikiView(null);
      setShowSharedLibrary(false);
      setSidebarOpen(false);
    },
    trashActive: showTrash,
    trashCount: fm.trashedNotes.length + fm.archivedNotes.length,
    onShowSharedLibrary: getSharedRoot()
      ? () => {
          setShowSharedLibrary(true);
          fm.setActiveAssetType(null);
          fm.setActiveLabel(null);
          fm.setActiveWikiKind(null);
          fm.setShowNoteList(false);
          setShowMemos(false);
          setShowSkillList(false);
          setActiveWikiView(null);
          setShowTrash(false);
          setSidebarOpen(false);
          router.navigate({ view: "shared-library" });
        }
      : undefined,
    sharedLibraryActive: showSharedLibrary,
  };

  return (
    <div className="flex flex-col h-dvh font-sans antialiased bg-background text-foreground">
      <UpdateBanner />
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
        {fm.activeAssetType ? (
          <AssetGalleryView
            mediaIndex={fm.mediaIndex}
            mediaType={fm.activeAssetType}
            onBack={() => fm.setActiveAssetType(null)}
            onNavigateNote={(noteId) => {
              fm.setActiveAssetType(null);
              // PDF アセットの利用ノートグラフから Wiki ノートをクリックしたケース：
              // MediaUsage.noteId は Wiki の場合 `wiki:{id}` prefix で格納されている。
              if (noteId.startsWith("wiki:")) fm.handleOpenWikiFile(noteId.slice(5));
              else fm.handleOpenFile(noteId);
            }}
            onDeleteMedia={fm.handleDeleteMedia}
            onRenameMedia={handleRenameMediaWithBlockSync}
            onSharedRefUpdated={fm.handleUpdateMediaSharedRef}
            onAddUrlBookmark={fm.handleAddUrlBookmark}
            onUploadMedia={fm.handleUploadMedia}
            resolveKnowledgeWikiId={(entry) => {
              if (entry.type === "url" && entry.url) {
                return appKnowledgeMap.get(`url:${entry.url}`)?.[0]?.noteId;
              }
              if (entry.type === "pdf" && entry.fileId) {
                return appKnowledgeMap.get(`pdf:${entry.fileId}`)?.[0]?.noteId;
              }
              return undefined;
            }}
            onIngestMedia={aiAvailable ? (entry) => {
              if (entry.type === "url" && entry.url) {
                // toast ID は一意にしておくが、wiki に保存する sourceNoteId は URL ベースの安定 ID
                // にしておくことで、同じ URL を再 ingest した際に逆引き（Knowledge 化済み判定）
                // が壊れない。
                const toastId = `url-toast:${Date.now()}`;
                const sourceNoteId = `url:${entry.url}`;
                const newItem: IngestToastItem = { id: toastId, status: "queued", noteTitle: entry.name || entry.url };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "generating" as const, detail: "Fetching URL..." } : i) }));
                  try {
                    const existingWikis = (fm.noteIndex?.notes ?? []).filter((n) => n.source === "ai" && n.wikiKind).map((n) => ({ id: n.noteId, title: n.title, kind: n.wikiKind! }));
                    const result = await ingestFromUrl(entry.url, existingWikis, "ja");
                    if (result.wikis.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: "内容不足" } : i) }));
                      return;
                    }
                    for (const wiki of result.wikis) {
                      const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, entry.name || entry.url, undefined, "ja", buildNoteIndex(fm.noteIndex));
                      const newId = await fm.handleCreateWikiFile(wikiDoc);
                      embedWikiSections(newId, wikiDoc).catch(() => {});
                    }
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                  }
                })();
              } else if (entry.type === "pdf" && entry.fileId) {
                const toastId = `pdf-toast:${Date.now()}`;
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
                    const result = await ingestFromPdf(blob, entry.name || "document.pdf", sourceNoteId, existingWikis, "ja");
                    if (result.wikis.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: "内容不足" } : i) }));
                      return;
                    }
                    for (const wiki of result.wikis) {
                      const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, entry.name || "PDF", undefined, "ja", buildNoteIndex(fm.noteIndex));
                      const newId = await fm.handleCreateWikiFile(wikiDoc);
                      embedWikiSections(newId, wikiDoc).catch(() => {});
                    }
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                  } catch (err) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === toastId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                  }
                })();
              }
            } : undefined}
            onCreateProvNote={aiAvailable ? (entry) => {
              // URL 経路
              if (entry.type === "url" && entry.url) {
                const jobId = `prov-url:${Date.now()}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.url };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Fetching & parsing URL..." } : i) }));
                  try {
                    const result = await ingestUrlToProv(entry.url, getLocale());
                    if (!result.blocks || result.blocks.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: "PROV 構造を生成できませんでした" } : i) }));
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
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                  }
                })();
                return;
              }
              // PDF 経路（PROV ノート生成）。画像抽出は onExtractPdfPages 側で扱う。
              if (entry.type === "pdf" && entry.fileId) {
                const jobId = `prov-pdf:${Date.now()}`;
                const newItem: IngestToastItem = { id: jobId, status: "queued", noteTitle: entry.name || entry.fileId };
                setIngestToast((prev) => ({ items: [...(prev?.items ?? []), newItem] }));
                (async () => {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "generating" as const, detail: "Extracting PDF text..." } : i) }));
                  try {
                    const provider = getActiveProvider();
                    const blobUrl = await provider.getMediaBlobUrl(entry.fileId);
                    const blob = await (await fetch(blobUrl)).blob();
                    const result = await ingestPdfToProv(blob, entry.name || "document.pdf", getLocale());
                    if (!result.blocks || result.blocks.length === 0) {
                      setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: "PROV 構造を生成できませんでした" } : i) }));
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
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                  }
                })();
                return;
              }
            } : undefined}
            onExtractPdfPages={async (entry, onProgress) => {
              // PDF 内部に埋め込まれた画像オブジェクトを抽出して画像アセットに登録する。
              // ベクター figure / 表は PDF 内部に「画像」として存在しないため対象外。
              // 失敗時は MediaDetailModal 側でエラーメッセージを表示する。
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
            onOpenNoteFull={(noteId) => { setListSidePeekNoteId(null); fm.setShowNoteList(false); fm.handleOpenFile(noteId); router.navigate({ view: "editor", fileId: noteId }); }}
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
            onOpenWikiPeek={(wikiNoteId) => { setListSidePeekNoteId(wikiNoteId); }}
            onIngestNotes={aiAvailable ? async (ids) => {
              // Knowledge 化候補から AI 派生（wiki）と既に処理待ちの ID を除外
              const candidates: { id: string; title: string }[] = [];
              const skippedAi: string[] = [];
              for (const id of ids) {
                const entry = fm.noteIndex?.notes.find((n) => n.noteId === id);
                if (!entry) continue;
                if (entry.source === "ai") {
                  skippedAi.push(entry.title || "(無題)");
                  continue;
                }
                candidates.push({ id, title: entry.title || "(無題)" });
              }
              if (skippedAi.length > 0) {
                window.alert(`Wiki ノートはスキップしました（${skippedAi.length} 件）`);
              }
              if (candidates.length === 0) return;

              // doc 本体をロードしてキューに積む
              for (const { id, title } of candidates) {
                const doc = await fm.loadDoc(id);
                if (!doc) continue;
                enqueueIngest(id, title, doc);
              }
            } : undefined}
            onImportDocx={async (files, onProgress) => {
              const { importDocxToGraphiumDoc } = await import("./features/docx-import/import");
              let lastNewId: string | null = null;
              const failed: string[] = [];
              for (let i = 0; i < files.length; i++) {
                const file = files[i];
                onProgress({ done: i, total: files.length, current: file.name, failed: [...failed] });
                try {
                  const doc = await importDocxToGraphiumDoc(file, {
                    uploadImage: fm.handleUploadMedia,
                    addUrlBookmark: (url, anchorText) => {
                      fm.handleAddUrlBookmark({
                        fileId: `url:${url}`,
                        name: anchorText,
                        type: "url",
                        mimeType: "text/uri-list",
                        url,
                        thumbnailUrl: "",
                        uploadedAt: new Date().toISOString(),
                        usedIn: [],
                      });
                    },
                  });
                  const newId = await fm.handleCreateNoteFromImport(doc);
                  lastNewId = newId;
                } catch (err) {
                  console.error("Word インポート失敗:", file.name, err);
                  failed.push(file.name);
                }
                onProgress({ done: i + 1, total: files.length, failed: [...failed] });
              }
              await fm.refreshFiles();

              // 画像周りの既知制約を一度だけ通知（成功が 1 件以上ある時のみ）
              const successCount = files.length - failed.length;
              if (successCount > 0) {
                window.alert(
                  [
                    `${successCount} 件のノートを取り込みました。`,
                    "",
                    "※ 一部の画像が表示されない / トリミング前の状態で展開されることがあります。",
                    "  原因: EMF/WMF・SmartArt・数式などはブラウザ変換ではサポート外、",
                    "  Word のクロップ情報はメタデータとして別管理されているため反映されません。",
                    "  必要に応じて元の Word と見比べて、ノート上で差し替えてください。",
                  ].join("\n"),
                );
              }

              // 単発取り込みなら自動で開く。複数なら一覧に留まる
              if (lastNewId && files.length === 1) {
                fm.setShowNoteList(false);
                fm.handleOpenFile(lastNewId);
                router.navigate({ view: "editor", fileId: lastNewId });
              }
            }}
            onImportMarkdown={async (files, onProgress) => {
              const {
                importMarkdownToGraphiumDoc,
                resolveWikiLinks,
                isMarkdownFile,
                buildVaultMap,
              } = await import("./features/markdown-import/import");

              const mdFiles = files.filter(isMarkdownFile);
              if (mdFiles.length === 0) {
                window.alert("Markdown ファイルが見つかりませんでした。");
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
              const vaultMap = buildVaultMap(mdFiles);
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

              // pass 2: wikilinks を解決して保存
              if (vaultMap.size > 0) {
                let resolvedCount = 0;
                let unresolvedCount = 0;
                for (const [noteId, { doc, wikilinks }] of docsByNoteId) {
                  if (wikilinks.length === 0) continue;
                  const resolver = (target: string): string | null => {
                    const id = baseNameToNoteId.get(target.toLowerCase());
                    if (id) {
                      resolvedCount++;
                      return id;
                    }
                    unresolvedCount++;
                    return null;
                  };
                  const updated = resolveWikiLinks(doc, wikilinks, resolver);
                  if (updated.pages[0].knowledgeLinks.length > 0) {
                    try {
                      await fm.handleSaveImportedDoc(noteId, updated);
                    } catch (err) {
                      console.warn("Markdown リンク解決の保存失敗:", noteId, err);
                    }
                  }
                }
                console.info(`[markdown-import] リンク解決: ${resolvedCount} / ${resolvedCount + unresolvedCount}`);
              }

              await fm.refreshFiles();

              const successCount = mdFiles.length - failed.length;
              if (successCount > 0) {
                const msg = [`${successCount} 件のノートを取り込みました。`];
                if (vaultMap.size > 0) {
                  msg.push("", "解決できなかった [[リンク]] はテキストとして残しています。");
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
            onEditMemo={capture.handleEditCapture}
            onNavigateNote={(noteId) => { setShowMemos(false); fm.handleOpenFile(noteId); }}
            insertDisabled={!fm.activeFileId}
            onCreateMemo={capture.handleCreateCapture}
            creating={capture.capturing}
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
                const report = await lintWikis(snapshots, "ja", localOnly);
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
            onOpenWikiFull={(wikiId) => { setListSidePeekNoteId(null); fm.setActiveWikiKind(null); fm.handleOpenWikiFile(wikiId); router.navigate({ view: "wiki-editor", kind: fm.activeWikiKind!, wikiId }); }}
            onBack={() => { setListSidePeekNoteId(null); fm.setActiveWikiKind(null); router.navigate({ view: "home" }); }}
            onDeleteWiki={fm.handleDeleteWikiFile}
            onRegenerateWiki={aiAvailable ? (wikiId) => regenerateWikiById(wikiId, { openAfter: false }) : undefined}
          />
        ) : showSharedLibrary && getSharedRoot() ? (
          <SharedLibraryView
            sharedRoot={getSharedRoot()!}
            currentIdentity={loadAuthorIdentity()}
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
              setShowSharedLibrary(false);
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
            onBack={() => { setShowSharedLibrary(false); router.navigate({ view: "home" }); }}
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
                alert("システム同梱スキルは削除できません。デフォルトに戻すには「リセット」を使ってください。");
                return;
              }
              await fm.handleDeleteSkillFile(skillId);
            }}
            onNewSkill={() => setShowNewSkillDialog(true)}
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
          {/* Skill バナー（Skill ドキュメントの場合） */}
          {fm.activeDoc?.source === "skill" && fm.activeDoc?.skillMeta && (
            <SkillBanner availableForIngest={fm.activeDoc.skillMeta.availableForIngest} />
          )}
          {/* Wiki バナー（AI 生成ドキュメントの場合） */}
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
              />
            );
          })()}
          <NoteEditor
            key={fm.editorKey}
            fileId={fm.activeFileId?.replace("wiki:", "").replace("skill:", "") ?? fm.activeFileId}
            initialDoc={fm.activeDoc}
            archived={(() => {
              const rawId = fm.activeFileId?.replace(/^(wiki|skill):/, "");
              return rawId ? fm.archivedIdSet.has(rawId) : false;
            })()}
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
            onDeriveWholeNote={fm.handleDeriveWholeNote}
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
            onAiDeriveNote={fm.handleAiDeriveNote}
            onNavigateNote={(noteId: string, cachedDoc?: import("./lib/document-types").GraphiumDocument) => {
              if (noteId.startsWith("wiki:")) {
                fm.handleOpenWikiFile(noteId.replace("wiki:", ""));
              } else {
                fm.handleOpenFile(noteId, cachedDoc);
              }
            }}
            getCachedDoc={fm.getCachedDoc}
            onRefreshFiles={fm.refreshFiles}
            saving={fm.saving}
            files={fm.files}
            noteGraphData={fm.noteGraphData}
            lineageTree={fm.lineageTree}
            sourceDoc={fm.sourceDoc}
            onSourceDocChange={fm.setSourceDoc}
            noteIndex={fm.noteIndex}
            uploadFile={fm.handleUploadMedia}
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
            onEditorRef={(editor) => { noteEditorRef.current = editor; }}
            isWikiDoc={fm.activeDoc?.source === "ai"}
            aiAvailable={aiAvailable ?? false}
            onOpenComposer={composer.openComposer}
            composerSubmitRef={composerSubmitRef}
            skillPrompts={(() => {
              // チャットは ja デフォルト（既存ロジックに揃える。将来 i18n 設定で切替）
              const skills = pickActiveSkills(fm.skillMetas, (id) => fm.getCachedDoc(`skill:${id}`), "ja");
              if (skills.length === 0) return undefined;
              return buildSkillPromptSection(skills);
            })()}
            onIngestToWiki={aiAvailable && fm.activeDoc?.source !== "ai" ? () => {
              if (!fm.activeFileId || !fm.activeDoc) return;
              enqueueIngest(fm.activeFileId, fm.activeDoc.title, fm.activeDoc);
            } : undefined}
            onIngestFromUrl={aiAvailable ? () => {
              const url = prompt("URL を入力してください:");
              if (!url) return;
              // toast の追跡には一意な ID、wiki の sourceNoteId には URL ベースの安定 ID
              // を使い分ける。後者で逆引きが効くようにする。
              const jobId = `url-toast:${Date.now()}`;
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
                  const result = await ingestFromUrl(url, existingWikis, "ja");
                  if (result.wikis.length === 0) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "error" as const, result: "内容不足" } : i) }));
                    ingestQueueRef.current = ingestQueueRef.current.filter((j) => j.noteId !== jobId);
                    return;
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "saving" as const, detail: `${result.wikis.length} wiki(s)` } : i) }));
                  for (const wiki of result.wikis) {
                    const wikiDoc = buildWikiDocument(wiki, sourceNoteId, result.model, url, undefined, "ja", buildNoteIndex(fm.noteIndex));
                    const newId = await fm.handleCreateWikiFile(wikiDoc);
                    embedWikiSections(newId, wikiDoc).catch(() => {});
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "success" as const, detail: undefined, result: `${result.wikis.length} wiki(s)` } : i) }));
                } catch (err) {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i) => i.id === jobId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                }
                ingestQueueRef.current = ingestQueueRef.current.filter((j) => j.noteId !== jobId);
              })();
            } : undefined}
            onIngestChat={aiAvailable ? (chatMessages) => {
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
                  const result = await ingestFromChat(chatMessages, chatTitle, existingWikis, "ja");
                  if (result.wikis.length === 0) {
                    setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: "内容不足" } : i) }));
                    return;
                  }
                  for (const wiki of result.wikis) {
                    const wikiDoc = buildWikiDocument(wiki, jobId, result.model, chatTitle, undefined, "ja", buildNoteIndex(fm.noteIndex));
                    const newId = await fm.handleCreateWikiFile(wikiDoc);
                    embedWikiSections(newId, wikiDoc).catch(() => {});
                  }
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "success" as const, result: `${result.wikis.length} wiki(s)` } : i) }));
                } catch (err) {
                  setIngestToast((prev) => ({ items: (prev?.items ?? []).map((i: IngestToastItem) => i.id === jobId ? { ...i, status: "error" as const, result: err instanceof Error ? err.message : "Error" } : i) }));
                }
              })();
            } : undefined}
            provWikiEntities={provWikiEntities}
          />
          </>
        )}
        {/* Ingest トースト通知 */}
        <IngestToast state={ingestToast} onDismiss={() => setIngestToast(null)} />
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
              noteId={listSidePeekNoteId}
              cachedDoc={fm.getCachedDoc?.(listSidePeekNoteId) ?? undefined}
              archived={(() => {
                const rawId = listSidePeekNoteId.replace(/^(wiki|skill):/, "");
                return fm.archivedIdSet.has(rawId);
              })()}
              onClose={() => setListSidePeekNoteId(null)}
              onNavigate={(noteId, savedDoc) => {
                setListSidePeekNoteId(null);
                // アーカイブ画面 (showTrash) などの上位ビューを閉じてからルート遷移する。
                // これを忘れると activeFileId が wiki に変わっても上位ビューが残り続け、
                // 「Open full」が無反応に見える。
                setShowTrash(false);
                fm.setShowNoteList(false);
                fm.setActiveAssetType(null);
                fm.setActiveLabel(null);
                setShowMemos(false);
                if (noteId.startsWith("wiki:")) {
                  fm.handleOpenWikiFile(noteId.replace(/^wiki:/, ""));
                } else {
                  fm.handleOpenFile(noteId, savedDoc);
                }
                router.navigate({ view: "editor", fileId: noteId });
              }}
              wikiEntries={appKnowledgeMap.get(listSidePeekNoteId) ?? []}
              onAddToKnowledge={
                (aiAvailable ?? false) && !listSidePeekNoteId.startsWith("wiki:")
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
      {showReleaseNotes && (
        <ReleaseNotesPanel onClose={() => setShowReleaseNotes(false)} />
      )}
      <WelcomeDialog />
      <SettingsModal
        isOpen={showSettings}
        onClose={() => {
          setShowSettings(false);
          setAgentConfigured(isAgentConfigured());
          setExperimentalFlags(loadSettings().experimental);
        }}
        wikiSummaries={wikiSummariesForSettings}
        onRegenerateWiki={(wikiId, options) => regenerateWikiById(wikiId, { model: options?.model, openAfter: false })}
        onRunAtomizeDiscovery={runAtomizeDiscovery}
        onRunSynthesisDiscovery={runSynthesisDiscovery}
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
      />
      {showNewSkillDialog && (
        <NewSkillDialog
          onClose={() => setShowNewSkillDialog(false)}
          onCreate={async (title, description, availableForIngest) => {
            const doc = buildSkillDocument(title, description, "", availableForIngest);
            const newId = await fm.handleCreateSkillFile(doc);
            setShowNewSkillDialog(false);
            setShowSkillList(false);
            fm.handleOpenSkillFile(newId);
          }}
        />
      )}
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
