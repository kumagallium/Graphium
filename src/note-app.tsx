// ノートアプリのメイン画面
// Google Drive と連携してノートの作成・保存・読み込みを行う

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Save, FileDown, Share2, MoreHorizontal, Network, GitBranch, MessageSquare, History, FileText } from "lucide-react";
import { isTauri } from "./lib/platform";
import { SandboxEditor } from "./base/editor";
import { pdfViewerBlock } from "./blocks/pdf-viewer";
import { bookmarkBlock, bookmarkSlashItem, setBookmarkPickerCallback } from "./blocks/bookmark";
import {
  LabelStoreProvider,
  useLabelStore,
  LabelDropdownPortal,
} from "./features/context-label";
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
import {
  getHeadingSuggestions,
  getNoteSuggestions,
} from "./features/block-link/mention-menu";
import {
  ProvGraphPanel,
} from "./features/prov-generator";
import {
  NetworkGraphPanel,
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
import { SettingsModal, isAgentConfigured, getSelectedModel, getSelectedProfile, getDisabledTools } from "./features/settings";
import { useStorage } from "./lib/storage/use-storage";
import { getActiveProvider } from "./lib/storage/registry";
import type { GraphiumDocument, NoteLink } from "./lib/document-types";
import { recordRevision, detectActivityType } from "./features/document-provenance/tracker";
import { DocumentProvenancePanel } from "./features/document-provenance";
import { cn } from "./lib/utils";
import { NoteListView, type GraphiumIndex } from "./features/navigation";
import { MobileCaptureView, MemoGalleryView } from "./features/mobile-capture";
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
  type MediaIndexEntry,
} from "./features/asset-browser";
import { useT, t as tStatic } from "./i18n";
import { exportNoteToPdf } from "./features/pdf-export";
import { exportProvJsonLd } from "./features/prov-export";

// hooks
import { useAutoSave } from "./hooks/use-auto-save";
import { useProvGeneration } from "./hooks/use-prov-generation";
import { useFileManager } from "./hooks/use-file-manager";
import { useCapture } from "./hooks/use-capture";

// components
import { LoginScreen } from "./components/LoginScreen";
import { FileSidebar } from "./components/FileSidebar";
import { NoteSideMenu, collectHeadingScope, setOpenLinkDropdownFn } from "./components/side-menu";
import { NoteFormattingToolbar } from "./components/formatting-toolbar";
import { SourceDocPanel, extractBlockTitle } from "./components/SourceDocPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { MobileHeader } from "./components/MobileHeader";
import { Sheet } from "./ui/sheet";
import { useIsDesktop } from "./hooks/use-media-query";

import type { GraphiumFile } from "./lib/document-types";
import type { NoteGraphData } from "./features/network-graph";

// ── ヘッダーメニュー（Notion 風ドロップダウン） ──
function NoteHeaderMenu({
  onSave,
  saveDisabled,
  onExportPdf,
  pdfExporting,
  onExportProvJsonLd,
  provExportDisabled,
  t,
}: {
  onSave: () => void;
  saveDisabled: boolean;
  onExportPdf: () => void;
  pdfExporting: boolean;
  onExportProvJsonLd: () => void;
  provExportDisabled: boolean;
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
};

function NoteEditor(props: NoteEditorProps) {
  return (
    <LabelStoreProvider>
      <LinkStoreProvider>
        <IndexTableStoreProvider>
        <AiAssistantProvider>
          <NoteEditorInner {...props} />
        </AiAssistantProvider>
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

function sanitizeBlocks(blocks: any[]): any[] {
  return blocks
    .filter((b) => KNOWN_BLOCK_TYPES.has(b.type))
    .map((b) => ({
      ...b,
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
  sourceDoc,
  onSourceDocChange,
  getCachedDoc,
  noteIndex,
  uploadFile,
  mediaIndex,
  onAddUrlBookmark,
  pendingMemoInsert,
  onMemoInserted,
}: NoteEditorProps) {
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const indexTableStore = useIndexTableStore();
  const aiAssistant = useAiAssistant();
  const isDesktop = useIsDesktop();
  const editorRef = useRef<any>(null);
  const [sidePeekNoteId, setSidePeekNoteId] = useState<string | null>(null);
  const noteLinksRef = useRef<NoteLink[]>(initialDoc?.noteLinks ?? []);
  // 前回保存時のページ状態（差分計算用）
  const prevPageRef = useRef<import("./lib/google-drive").GraphiumPage | null>(
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
  const t = useT();
  const [title, setTitle] = useState(initialDoc?.title || tStatic("editor.newNote"));

  // ── PDF エクスポート（状態のみ — ハンドラーは provDoc 宣言後） ──
  const [pdfExporting, setPdfExporting] = useState(false);

  // ── メディアピッカー ──
  const [pickerMediaType, setPickerMediaType] = useState<MediaType | null>(null);

  // スラッシュメニューからピッカーを開くコールバック登録
  useEffect(() => {
    setMediaPickerCallback((type: MediaType) => setPickerMediaType(type));
    return () => { setMediaPickerCallback(null); };
  }, []);

  // スラッシュメニューから URL ブックマークピッカーを開くコールバック登録
  useEffect(() => {
    setBookmarkPickerCallback(() => setUrlSlashPickerOpen(true));
    return () => { setBookmarkPickerCallback(null); };
  }, []);

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
      editor.removeBlocks([currentBlock]);
    }
    // onChange が自動的にトリガーされるので markDirty() は不要
  }, []);

  // スラッシュメニューアイテム（既存メディアから挿入）
  const mediaSlashItems = useMemo(() => getMediaSlashMenuItems(), []);

  // ── URL ペースト検知 ──
  const [pastedUrl, setPastedUrl] = useState<{ url: string; position: { x: number; y: number }; blockId: string } | null>(null);
  const pasteListenerRef = useRef<((e: ClipboardEvent) => void) | null>(null);

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
  }, [onAddUrlBookmark]);

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
      editor.removeBlocks([currentBlock]);
    }
    setUrlSlashPickerOpen(false);
  }, []);

  // ラベル自動設定のコールバック
  const labelAutoRef = useRef<(() => void) | null>(null);

  // エディタ参照を保持
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    // ラベル自動設定をセットアップ
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStore);

    // URL ペースト検知リスナー
    // 前回のリスナーがあればクリーンアップ
    if (pasteListenerRef.current) {
      editor.domElement?.removeEventListener("paste", pasteListenerRef.current);
    }
    const listener = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      // URL のみのペーストかチェック
      try {
        const parsed = new URL(text);
        if (!parsed.protocol.startsWith("http")) return;
      } catch {
        return;
      }
      // ペースト位置のブロック ID を取得
      const currentBlock = editor.getTextCursorPosition()?.block;
      if (!currentBlock) return;
      // ペースト位置の座標を取得
      const sel = window.getSelection();
      let x = 0, y = 0;
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        x = rect.left;
        y = rect.bottom;
      }
      // 少し遅延してメニュー表示（ペーストテキスト挿入後）
      setTimeout(() => {
        setPastedUrl({ url: text, position: { x, y }, blockId: currentBlock.id });
      }, 100);
    };
    pasteListenerRef.current = listener;
    // BlockNote の DOM 要素にリスナーを追加
    const domEl = editor.domElement;
    if (domEl) {
      domEl.addEventListener("paste", listener);
    }
  }, [labelStore]);

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
    let doc: GraphiumDocument = {
      version: 2,
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
        },
      ],
      noteLinks: noteLinksRef.current.length > 0 ? noteLinksRef.current : undefined,
      derivedFromNoteId: initialDoc?.derivedFromNoteId,
      derivedFromBlockId: initialDoc?.derivedFromBlockId,
      documentProvenance: currentProvenance,
      chats: savedChats.length > 0 ? savedChats : undefined,
      createdAt: initialDoc?.createdAt || new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    // ドキュメント来歴: リビジョンを追記（buildDocument を async 化）
    // AI 挿入直後かどうかを判定（lastAiInsertRef が true なら ai_generation）
    let actType: import("./features/document-provenance/types").EditActivityType;
    let actLabel: string | undefined;
    if (lastAiInsertRef.current) {
      actType = "ai_generation";
      actLabel = getSelectedModel?.() ?? "ai";
      lastAiInsertRef.current = false;
    } else {
      const detected = detectActivityType(doc);
      actType = detected.type;
      actLabel = detected.agentLabel;
    }
    const email = await getActiveProvider().getUserEmail() ?? undefined;
    doc = await recordRevision(doc, prevPageRef.current, actType, { agentLabel: actLabel, email });
    // 前回保存状態を更新
    prevPageRef.current = structuredClone(doc.pages[0]);

    return doc;
  }, [title, labelStore, linkStore, indexTableStore, aiAssistant, initialDoc, currentProvenance]);

  const handleSave = useCallback(async () => {
    const doc = await buildDocument();
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
  }, [onSave, buildDocument, fileId]);

  // ── オートセーブ ──
  const { dirty, setDirty, markDirty, saveNow } = useAutoSave(handleSave);

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
  );

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
  const handleExportProvJsonLd = useCallback(() => {
    if (!provDoc || provDoc["@graph"].length === 0) return;
    exportProvJsonLd({ title, provDoc });
  }, [title, provDoc]);

  // ラベル・リンク・インデックステーブル変更時に自動保存トリガー
  const prevLabelsRef = useRef(labelStore.labels);
  const prevLinksRef = useRef(linkStore.links);
  const prevTablesRef = useRef(indexTableStore.tables);
  useEffect(() => {
    if (
      prevLabelsRef.current !== labelStore.labels ||
      prevLinksRef.current !== linkStore.links ||
      prevTablesRef.current !== indexTableStore.tables
    ) {
      prevLabelsRef.current = labelStore.labels;
      prevLinksRef.current = linkStore.links;
      prevTablesRef.current = indexTableStore.tables;
      markDirty();
    }
  }, [labelStore.labels, linkStore.links, indexTableStore.tables, markDirty]);

  // AI チャットパネル用ハンドラー（継続対話）
  const handleAiChatSubmit = useCallback(
    async (question: string) => {
      if (!fileId || !editorRef.current) return;
      if (!isAgentConfigured()) {
        aiAssistant.setError(
          tStatic("settings.aiNotConfigured"),
        );
        return;
      }
      const now = new Date().toISOString();
      aiAssistant.addMessage({ role: "user", content: question, timestamp: now });
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
        const selectedModel = getSelectedModel();
        const disabledTools = getDisabledTools();
        const response = await runAgent({
          message: userMessage,
          session_id: aiAssistant.sessionId ?? undefined,
          profile: getSelectedProfile(),
          ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {}),
          options: { max_turns: 5, ...(selectedModel && { model: selectedModel }) },
        });
        aiAssistant.addMessage({
          role: "assistant",
          content: response.message,
          timestamp: new Date().toISOString(),
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
        version: 2,
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

  // AI 回答をスコープに反映
  const handleInsertToScope = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;
      const targetBlockId = aiAssistant.sourceBlockIds[0];
      if (!targetBlockId) {
        // ページ全体チャット: ドキュメント末尾に挿入
        const blocks = editor.tryParseMarkdownToBlocks(markdown);
        if (blocks.length === 0) return;
        const allBlocks = editor.document;
        const lastBlock = allBlocks[allBlocks.length - 1];
        if (lastBlock) {
          editor.insertBlocks(blocks, lastBlock, "after");
        }
        lastAiInsertRef.current = true;
        markDirty();
        return;
      }
      const targetBlock = editor.getBlock(targetBlockId);
      if (!targetBlock) return;
      if (targetBlock.type === "heading") {
        const blocks = editor.tryParseMarkdownToBlocks(markdown);
        if (blocks.length === 0) return;
        const scope = collectHeadingScope(editor.document, targetBlock);
        const insertAfterBlock = scope[scope.length - 1];
        editor.insertBlocks(blocks, insertAfterBlock, "after");
      } else {
        const existingContent = Array.isArray(targetBlock.content) ? targetBlock.content : [];
        const newContent = [
          ...existingContent,
          { type: "text" as const, text: "\n" + markdown, styles: {} },
        ];
        editor.updateBlock(targetBlockId, { content: newContent });
      }
      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant.sourceBlockIds],
  );

  // AI 回答で対象ブロックを置換
  const handleReplaceBlocks = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;
      const blockIds = aiAssistant.sourceBlockIds;
      if (blockIds.length === 0) return;

      const newBlocks = editor.tryParseMarkdownToBlocks(markdown);
      if (newBlocks.length === 0) return;

      const firstBlock = editor.getBlock(blockIds[0]);
      if (!firstBlock) return;

      if (firstBlock.type === "heading") {
        // 見出しスコープ: 見出し配下のブロックを置換（見出し自体は残す）
        const scope = collectHeadingScope(editor.document, firstBlock);
        // 見出し以外のスコープブロックを削除
        for (let i = scope.length - 1; i >= 1; i--) {
          editor.removeBlocks([scope[i].id]);
        }
        // 見出しの直後に新しいブロックを挿入
        editor.insertBlocks(newBlocks, firstBlock, "after");
      } else if (blockIds.length === 1) {
        // 単一ブロック: 内容を置換
        const parsed = newBlocks[0];
        if (parsed && firstBlock.type === parsed.type) {
          // 同じブロックタイプなら content を直接更新
          editor.updateBlock(blockIds[0], { content: parsed.content });
        } else {
          // ブロックタイプが異なる場合は削除→挿入
          editor.insertBlocks(newBlocks, firstBlock, "after");
          editor.removeBlocks([blockIds[0]]);
        }
      } else {
        // 複数ブロック選択: 最初のブロックの後に挿入し、元のブロックを削除
        editor.insertBlocks(newBlocks, firstBlock, "before");
        editor.removeBlocks(blockIds);
      }

      lastAiInsertRef.current = true;
      markDirty();
    },
    [markDirty, aiAssistant],
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
    const resolveMentionNoteId = (noteName: string): string | null => {
      const found = noteIndex?.notes.find((n) => n.title === noteName);
      if (found) return found.noteId;
      const file = files.find(
        (f) => f.name.replace(/\.(graphium|provnote)\.json$/, "") === noteName
      );
      return file?.id ?? null;
    };
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!isMentionSpan(target)) return;
      const noteName = target.textContent!.trim().slice(1);
      const noteId = resolveMentionNoteId(noteName);
      if (noteId) {
        e.preventDefault();
        e.stopPropagation();
        setSidePeekNoteId(noteId);
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
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      markDirty();
    },
    [markDirty]
  );

  // エディタ内容変更時にも再生成をトリガー + ラベル自動設定
  const handleContentChange = useCallback(() => {
    markDirty();
    labelAutoRef.current?.();
    triggerRegeneration();
  }, [markDirty, triggerRegeneration]);

  // 初期コンテンツ
  const initialContent = useMemo(() => {
    const blocks = initialDoc?.pages?.[0]?.blocks;
    if (!blocks?.length) return undefined;
    return sanitizeBlocks(blocks);
  }, [initialDoc]);

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
      {sidePeekNoteId && (
        <SidePeek
          noteId={sidePeekNoteId}
          cachedDoc={getCachedDoc?.(sidePeekNoteId)}
          onClose={() => setSidePeekNoteId(null)}
          onNavigate={(noteId, savedDoc) => {
            setSidePeekNoteId(null);
            onNavigateNote(noteId, savedDoc);
          }}
        />
      )}
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
      {/* ヘッダー */}
      <div className="px-3 md:px-4 py-2.5 md:py-2 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          className="flex-1 min-w-0 text-sm font-medium bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
          placeholder={t("editor.titlePlaceholder")}
          title={title}
        />
        <span className="text-[10px] text-muted-foreground shrink-0">
          {saving ? t("common.saving") : dirty ? t("common.unsaved") : t("common.saved")}
        </span>
        <NoteHeaderMenu
          onSave={saveNow}
          saveDisabled={saving}
          onExportPdf={handleExportPdf}
          pdfExporting={pdfExporting}
          onExportProvJsonLd={handleExportProvJsonLd}
          provExportDisabled={!provDoc || provDoc["@graph"].length === 0}
          t={t}
        />
      </div>

      <div className="flex h-full w-full overflow-hidden">
        {/* 左: エディタ */}
        <div data-label-wrapper className="flex-1 min-w-0 overflow-auto relative">
          <div style={{ padding: "16px 0", paddingLeft: isDesktop ? 100 : 16, paddingRight: isDesktop ? 100 : 16, paddingBottom: isDesktop ? 16 : 72 }}>
            <SandboxEditor
              key={fileId || "new"}
              blocks={[pdfViewerBlock, bookmarkBlock]}
              initialContent={initialContent}
              sideMenu={NoteSideMenu}
              extraSlashMenuItems={[...buildLabelSlashMenuItems(), indexTableSlashItem, ...mediaSlashItems, bookmarkSlashItem]}
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
          </div>
        </div>

        {/* 右: アイコンレール + オンデマンド展開パネル */}
        {rightTab && (
          <div className={cn(
            "shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden",
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
                <NetworkGraphPanel
                  data={noteGraphData}
                  onNavigate={onNavigateNote}
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
        {/* アイコンレール — デスクトップ: 右端縦レール / モバイル: ボトムバー */}
        <div className={cn(
          "shrink-0 border-border bg-muted/50 flex items-center gap-1",
          isDesktop
            ? "w-10 border-l flex-col py-2"
            : "fixed bottom-0 left-0 right-0 z-[100] h-14 border-t justify-center px-2 bg-background/95 backdrop-blur-sm"
        )}>
          {([
            { tab: "chat" as const, icon: <MessageSquare size={18} />, label: "Chat", show: true },
            { tab: "graph" as const, icon: <Network size={18} />, label: "Graph", show: noteGraphData.nodes.length > 1 },
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

// ── メインアプリ ──
export function NoteApp() {
  const { authenticated, loading: authLoading, signIn, signOut, switchProvider } = useStorage();
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [agentConfigured, setAgentConfigured] = useState(() => isAgentConfigured());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMemos, setShowMemos] = useState(false);
  // メモ挿入リクエスト（メモギャラリー → エディタ）
  const [pendingMemoInsert, setPendingMemoInsert] = useState<{ captureId: string; text: string; deleteAfter: boolean } | null>(null);

  const isDesktop = useIsDesktop();
  const fm = useFileManager(authenticated);
  const capture = useCapture(authenticated);

  const t = useT();

  // 認証読み込み中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  // 未認証
  if (!authenticated) {
    return <LoginScreen onSignIn={() => signIn("google-drive")} onSelectLocal={() => switchProvider(isTauri() ? "filesystem" : "local")} />;
  }

  const sidebarProps = {
    activeFileId: fm.activeFileId,
    onSelect: (fileId: string) => { fm.handleOpenFile(fileId); setSidebarOpen(false); },
    onNewNote: () => { fm.handleNewNote(); setSidebarOpen(false); },
    onRefresh: fm.refreshFiles,
    onSignOut: signOut,
    onShowReleaseNotes: () => setShowReleaseNotes(true),
    onShowSettings: () => { setShowSettings(true); setSidebarOpen(false); },
    agentConfigured,
    recentNotes: fm.recentNotes,
    onShowNoteList: () => { fm.setShowNoteList(true); fm.setActiveAssetType(null); fm.setActiveLabel(null); setShowMemos(false); setSidebarOpen(false); },
    mediaIndex: fm.mediaIndex,
    onShowAssetGallery: (type: import("./features/asset-browser").MediaType) => { fm.setActiveAssetType(type); fm.setShowNoteList(false); fm.setActiveLabel(null); setShowMemos(false); setSidebarOpen(false); },
    noteIndex: fm.noteIndex,
    onShowLabelGallery: (label: string) => { fm.setActiveLabel(label); fm.setActiveAssetType(null); fm.setShowNoteList(false); setShowMemos(false); setSidebarOpen(false); },
    activeAssetType: fm.activeAssetType,
    activeLabel: fm.activeLabel,
    filesLoading: fm.filesLoading,
    memoCount: capture.captureIndex?.captures.length ?? 0,
    onShowMemos: () => { setShowMemos(true); fm.setActiveAssetType(null); fm.setActiveLabel(null); fm.setShowNoteList(false); setSidebarOpen(false); },
    memosActive: showMemos,
  };

  return (
    <div className="flex flex-col h-screen font-sans antialiased bg-background text-foreground">
      <UpdateBanner />
      {/* モバイルヘッダー */}
      <MobileHeader onMenuToggle={() => setSidebarOpen(true)} />
      {/* モバイル: Sheet ドロワー */}
      {!isDesktop && (
        <Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} side="left">
          <FileSidebar {...sidebarProps} />
        </Sheet>
      )}
      <div className="flex flex-1 min-h-0">
      {/* デスクトップ: 通常のサイドバー */}
      {isDesktop && <FileSidebar {...sidebarProps} />}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {fm.activeAssetType ? (
          <AssetGalleryView
            mediaIndex={fm.mediaIndex}
            mediaType={fm.activeAssetType}
            onBack={() => fm.setActiveAssetType(null)}
            onNavigateNote={(noteId) => { fm.setActiveAssetType(null); fm.handleOpenFile(noteId); }}
            onDeleteMedia={fm.handleDeleteMedia}
            onRenameMedia={fm.handleRenameMedia}
            onAddUrlBookmark={fm.handleAddUrlBookmark}
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
            onOpenNote={(noteId) => { fm.setShowNoteList(false); fm.handleOpenFile(noteId); }}
            onBack={() => fm.setShowNoteList(false)}
            onDeleteNotes={async (ids) => {
              for (const id of ids) await fm.handleDelete(id);
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
            insertDisabled={!fm.activeFileId}
          />
        ) : !isDesktop && !fm.activeFileId ? (
          /* モバイル: ノート未選択時はクイックキャプチャビューを表示 */
          <MobileCaptureView
            captureIndex={capture.captureIndex}
            loading={capture.captureLoading}
            onCreateCapture={capture.handleCreateCapture}
            onDeleteCapture={capture.handleDeleteCapture}
            creating={capture.capturing}
          />
        ) : (
          <NoteEditor
            key={fm.editorKey}
            fileId={fm.activeFileId}
            initialDoc={fm.activeDoc}
            onSave={fm.handleSave}
            onDeriveNote={fm.handleDeriveNote}
            onAiDeriveNote={fm.handleAiDeriveNote}
            onNavigateNote={fm.handleOpenFile}
            getCachedDoc={fm.getCachedDoc}
            onRefreshFiles={fm.refreshFiles}
            saving={fm.saving}
            files={fm.files}
            noteGraphData={fm.noteGraphData}
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
          />
        )}
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
      {showReleaseNotes && (
        <ReleaseNotesPanel onClose={() => setShowReleaseNotes(false)} />
      )}
      <SettingsModal isOpen={showSettings} onClose={() => {
        setShowSettings(false);
        setAgentConfigured(isAgentConfigured());
      }} />
      </div>
    </div>
  );
}
