// ノートアプリのメイン画面
// Google Drive と連携してノートの作成・保存・読み込みを行う

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SandboxEditor } from "./base/editor";
// MultiPageLayout は派生ノートが別ファイルになったため不要
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
  labelSlashMenuItems,
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
  type ReferenceSuggestion,
} from "./features/block-link/mention-menu";
import {
  generateProvDocument,
  ProvGraphPanel,
  type ProvDocument,
} from "./features/prov-generator";
import {
  NetworkGraphPanel,
  buildNoteGraph,
  type NoteGraphData,
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
import { SettingsModal, isAgentConfigured } from "./features/settings";
import { useGoogleAuth } from "./lib/use-google-auth";
import { PROV_TEMPLATE } from "./lib/prov-template";
import {
  listFiles,
  loadFile,
  createFile,
  saveFile,
  deleteFile,
  uploadMediaFile,
  type ProvNoteFile,
  type ProvNoteDocument,
} from "./lib/google-drive";
import type { NoteLink } from "./lib/google-drive";
import { cn } from "./lib/utils";
import {
  RecentNotes,
  NoteListView,
  getRecentNotes,
  addToRecent,
  removeFromRecent,
  ensureIndex,
  updateIndexEntry,
  removeIndexEntry,
  buildIndexEntry,
  saveIndexFile,
  type RecentNote,
  type ProvNoteIndex,
} from "./features/navigation";
import {
  AddBlockButton,
  DragHandleButton,
  RemoveBlockItem,
  BlockColorsItem,
  SideMenu,
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useExtensionState,
  useComponentsContext,
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { Bot } from "lucide-react";
import type { FormattingToolbarProps } from "@blocknote/react";


// ── ログイン画面 ──
function LoginScreen({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center space-y-6 max-w-sm">
        <h1 className="text-3xl font-bold text-foreground">provnote</h1>
        <p className="text-muted-foreground text-sm">
          PROV-DM プロヴェナンス追跡付きブロックエディタ
        </p>
        <button
          onClick={onSignIn}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
        >
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Google でサインイン
        </button>
        <p className="text-xs text-muted-foreground">
          ノートは Google Drive の ProvNote フォルダに保存されます
        </p>
      </div>
    </div>
  );
}

// ── ファイル一覧サイドバー ──
function FileSidebar({
  activeFileId,
  onSelect,
  onNewNote,
  onNewFromTemplate,
  onRefresh,
  onSignOut,
  onShowReleaseNotes,
  onShowSettings,
  agentConfigured,
  recentNotes,
  onShowNoteList,
}: {
  activeFileId: string | null;
  onSelect: (fileId: string) => void;
  onNewNote: () => void;
  onNewFromTemplate: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onShowReleaseNotes: () => void;
  onShowSettings: () => void;
  agentConfigured: boolean;
  recentNotes: RecentNote[];
  onShowNoteList: () => void;
}) {
  return (
    <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-sidebar-foreground/60 tracking-wide">
            provnote
          </h2>
          <button
            onClick={onRefresh}
            title="再読み込み"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &#8635;
          </button>
        </div>
        <button
          onClick={onNewNote}
          className="w-full text-left rounded-md px-3 py-2 mb-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          + 新しいノート
        </button>
        <button
          onClick={onNewFromTemplate}
          className="w-full text-left rounded-md px-3 py-2 text-sm font-medium border border-border text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
        >
          + PROV テンプレート
        </button>
      </div>

      {/* 最近のノート */}
      <div className="flex-1 overflow-y-auto">
        <RecentNotes
          notes={recentNotes}
          activeFileId={activeFileId}
          onSelect={onSelect}
          onShowNoteList={onShowNoteList}
        />
      </div>

      {/* フッター */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={onShowSettings}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          設定
          {agentConfigured ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title="AI 接続済み" />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" title="AI 未設定" />
          )}
        </button>
        <button
          onClick={onShowReleaseNotes}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Release Notes
        </button>
        <button
          onClick={onSignOut}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          サインアウト
        </button>
      </div>
    </aside>
  );
}

// ── リンク付き SideMenu ──
let openLinkDropdownFn: ((params: {
  type: "prevStep" | "general";
  sourceBlockId: string;
  anchorRect: { top: number; left: number };
}) => void) | null = null;

// SideMenu の Floating UI 親は transform: translate(X,Y) で配置されるため、
// その中の position:fixed なドロップダウンは containing block の影響で位置がずれる。
// 親の transform を読み取り、ドロップダウン wrapper に逆オフセットを適用して打ち消す。
function useFixDropdownPosition() {
  useEffect(() => {
    const fix = () => {
      const wrapper = document.querySelector(
        "[data-radix-popper-content-wrapper]"
      ) as HTMLElement;
      if (!wrapper) return;

      // ドロップダウンのトリガー（⠿ ボタン）を探す
      const trigger = document.querySelector(
        ".bn-side-menu .bn-button[draggable]"
      ) as HTMLElement;
      if (!trigger) return;

      // トリガーの viewport 位置
      const triggerRect = trigger.getBoundingClientRect();
      // ドロップダウンの viewport 位置・サイズ
      const wrapperRect = wrapper.getBoundingClientRect();
      const dropdownHeight = wrapperRect.height || 160;

      // 下にスペースがあれば下、なければ上に配置
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const expectedTop =
        spaceBelow >= dropdownHeight + 8
          ? triggerRect.bottom // 下に表示
          : triggerRect.top - dropdownHeight; // 上に表示

      const actualTop = wrapperRect.top;
      const diffY = actualTop - expectedTop;

      // 大きくずれている場合のみ補正
      if (Math.abs(diffY) > 20) {
        const currentMarginTop = parseFloat(wrapper.style.marginTop) || 0;
        wrapper.style.marginTop = `${currentMarginTop - diffY}px`;
      }
    };

    const observer = new MutationObserver(fix);
    const root = document.getElementById("root");
    if (root) {
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    }
    return () => observer.disconnect();
  }, []);
}

function NoteSideMenu() {
  useFixDropdownPosition();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <RemoveBlockItem>削除</RemoveBlockItem>
        <BlockColorsItem>色</BlockColorsItem>
        <DeriveNoteMenuItem />
        <AiAssistantMenuItem />
      </DragHandleButton>
    </SideMenu>
  );
}

// 見出しブロックの配下ブロックを収集する（スコープ選択）
// 同じレベル以上の見出しが出てきたら終了
function collectHeadingScope(doc: any[], headingBlock: any): any[] {
  const level = headingBlock.props?.level ?? 1;
  const blocks = Array.isArray(doc) ? doc : [];
  const idx = blocks.findIndex((b: any) => b.id === headingBlock.id);
  if (idx < 0) return [headingBlock];

  const scope = [blocks[idx]];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && (b.props?.level ?? 1) <= level) break;
    scope.push(b);
  }
  return scope;
}

// DragHandle メニュー内: 派生ノート作成
function DeriveNoteMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        openLinkDropdownFn?.({
          type: "general",
          sourceBlockId: block.id,
          anchorRect: { top: 0, left: 0 },
        });
      }}
    >
      🔗 新ページを派生
    </Components.Generic.Menu.Item>
  );
}

// DragHandle メニュー内: AI アシスタント（スコープ選択対応）
function AiAssistantMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  const aiAssistant = useAiAssistant();

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={async () => {
        let targetBlocks: any[];
        if (block.type === "heading") {
          targetBlocks = collectHeadingScope(editor.document, block);
        } else {
          targetBlocks = [block];
        }
        const markdown = await editor.blocksToMarkdownLossy(targetBlocks);
        aiAssistant.openChat({
          sourceBlockIds: targetBlocks.map((b: any) => b.id),
          quotedMarkdown: markdown,
        });
      }}
    >
      🤖 AI アシスタント
    </Components.Generic.Menu.Item>
  );
}

// テキスト選択時の FormattingToolbar に AI ボタンを追加
function NoteFormattingToolbar(props: FormattingToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const aiAssistant = useAiAssistant();

  const handleAiClick = async () => {
    const selectedText = window.getSelection()?.toString()?.trim();
    if (!selectedText) return;

    const selection = editor.getSelection();
    const blockIds = selection?.blocks?.map((b: any) => b.id) ?? [];

    aiAssistant.openChat({
      sourceBlockIds: blockIds,
      quotedMarkdown: selectedText,
    });
  };

  return (
    <FormattingToolbar {...props}>
      {getFormattingToolbarItems(props.blockTypeSelectItems)}
      <button
        onClick={handleAiClick}
        title="選択範囲を AI に聞く"
        className="bn-button inline-flex items-center justify-center rounded hover:bg-violet-100 text-violet-500 transition-colors"
        data-test="aiButton"
      >
        <Bot size={18} />
      </button>
    </FormattingToolbar>
  );
}

// ブロック内容からタイトル文字列を抽出する
// テキスト系ブロック → テキスト内容、画像/動画/ファイル → ファイル名
function extractBlockTitle(block: any): string {
  if (!block) return "";
  const MAX_LEN = 50;

  // テキスト系ブロック（heading, paragraph, bulletListItem, numberedListItem など）
  if (Array.isArray(block.content)) {
    const text = block.content
      .map((c: any) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
  }

  // 画像・動画・音声・ファイルブロック → ファイル名を取得
  if (block.props) {
    // name プロパティ（ファイルブロック）またはURL からファイル名を抽出
    const name = block.props.name;
    if (name) return name;

    const url = block.props.url;
    if (url) {
      try {
        const pathname = new URL(url).pathname;
        const filename = pathname.split("/").pop();
        if (filename) return decodeURIComponent(filename);
      } catch {
        // URL パース失敗時はそのまま
      }
    }

    // caption があればそれを使う
    const caption = block.props.caption;
    if (caption) return caption.length > MAX_LEN ? caption.slice(0, MAX_LEN) + "…" : caption;
  }

  // テーブルブロック → 最初のセルのテキスト
  if (block.type === "table" && block.content?.rows?.[0]?.cells?.[0]) {
    const cell = block.content.rows[0].cells[0];
    const cellContent = cell.content ?? cell;
    if (Array.isArray(cellContent)) {
      const text = cellContent
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
    }
  }

  return "";
}

// ── 派生元ノート読み取り専用パネル ──
function SourceDocPanel({ doc }: { doc: ProvNoteDocument }) {
  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">派生元ノート</div>
      <h3 className="text-sm font-bold text-foreground">{doc.title}</h3>
      <div className="space-y-2">
        {doc.pages[0]?.blocks?.map((block: any, i: number) => (
          <div
            key={block.id || i}
            className="text-xs text-foreground/80 bg-background rounded p-2 border border-border"
          >
            {renderBlockText(block)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ブロックからテキストを抽出する簡易レンダラー
function renderBlockText(block: any): string {
  if (!block) return "";
  // content が InlineContent の配列の場合
  if (Array.isArray(block.content)) {
    return block.content
      .map((c: any) => (c.type === "text" ? c.text : c.type === "mention" ? `@${c.props?.id || ""}` : ""))
      .join("");
  }
  // テーブルの場合
  if (block.type === "table" && block.content?.rows) {
    return "[テーブル]";
  }
  return "";
}

// ── エディタ本体 ──
type NoteEditorProps = {
  fileId: string | null;
  initialDoc: ProvNoteDocument | null;
  onSave: (doc: ProvNoteDocument) => void;
  onDeriveNote: (title: string, sourceBlockId: string) => void;
  onAiDeriveNote: (doc: ProvNoteDocument) => Promise<void>;
  onNavigateNote: (noteId: string, cachedDoc?: ProvNoteDocument) => void;
  /** ドキュメントキャッシュ検索（サイドピーク即表示用） */
  getCachedDoc?: (noteId: string) => ProvNoteDocument | undefined;
  onRefreshFiles: () => void;
  saving: boolean;
  files: ProvNoteFile[];
  noteGraphData: NoteGraphData;
  /** 派生元ノート（Split View 用、NoteApp が管理） */
  sourceDoc: ProvNoteDocument | null;
  onSourceDocChange: (doc: ProvNoteDocument | null) => void;
  /** ノートインデックス（@ オートコンプリート用） */
  noteIndex?: ProvNoteIndex | null;
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
  "codeBlock",
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
}: NoteEditorProps) {
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const indexTableStore = useIndexTableStore();
  const aiAssistant = useAiAssistant();
  const editorRef = useRef<any>(null);
  const [sidePeekNoteId, setSidePeekNoteId] = useState<string | null>(null);
  const noteLinksRef = useRef<NoteLink[]>(initialDoc?.noteLinks ?? []);
  // @ トリガー時のカーソル位置を保存（ドロップダウン表示後は DOM から取れなくなるため）
  const mentionContextRef = useRef<{ tableBlockId: string | null; rowIndex: number }>({ tableBlockId: null, rowIndex: -1 });
  const [provDoc, setProvDoc] = useState<ProvDocument | null>(null);
  const [rightTab, setRightTab] = useState<"graph" | "prov" | "chat" | "source">(
    sourceDoc ? "source" : "graph"
  );
  const [title, setTitle] = useState(initialDoc?.title || "新しいノート");
  const [dirty, setDirty] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});

  // ラベル自動設定のコールバック
  const labelAutoRef = useRef<(() => void) | null>(null);

  // エディタ参照を保持
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    // ラベル自動設定をセットアップ
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStore);
  }, [labelStore]);


  // AI チャットパネル用ハンドラー（継続対話）
  const handleAiChatSubmit = useCallback(
    async (question: string) => {
      if (!fileId || !editorRef.current) return;

      if (!isAgentConfigured()) {
        aiAssistant.setError(
          "AI エージェントの接続先が設定されていません。サイドバーの「設定」から URL を入力してください。",
        );
        return;
      }

      // ユーザーメッセージを追加
      const now = new Date().toISOString();
      aiAssistant.addMessage({ role: "user", content: question, timestamp: now });
      aiAssistant.setLoading(true);

      try {
        // 引用コンテキストがあれば初回メッセージに含める
        const isFirstMessage = aiAssistant.messages.length === 0;
        const userMessage = isFirstMessage && aiAssistant.quotedMarkdown
          ? [
              "以下の内容について質問があります。",
              "",
              "---",
              aiAssistant.quotedMarkdown,
              "---",
              "",
              question,
            ].join("\n")
          : question;

        const response = await runAgent({
          message: userMessage,
          profile: "science",
          options: { max_turns: 5 },
        });

        // アシスタント回答を追加
        aiAssistant.addMessage({
          role: "assistant",
          content: response.message,
          timestamp: new Date().toISOString(),
        });
        aiAssistant.setLoading(false);
      } catch (err) {
        aiAssistant.setError(
          err instanceof Error ? err.message : "AI 実行に失敗しました",
        );
      }
    },
    [fileId, aiAssistant],
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

      // Split View: 現在のドキュメントを派生元として保存（NoteApp レベル）
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

  // 初期データの復元
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !initialDoc) return;
    initializedRef.current = true;

    // ラベルとリンクを復元
    if (initialDoc.pages.length > 0) {
      const page = initialDoc.pages[0];
      if (page.labels) {
        for (const [blockId, label] of Object.entries(page.labels)) {
          labelStore.setLabel(blockId, label);
        }
      }
      // v2: provLinks + knowledgeLinks、v1 互換: links
      const allLinks = [
        ...(page.provLinks ?? []),
        ...(page.knowledgeLinks ?? []),
        ...(page.links ?? []),
      ];
      if (allLinks.length > 0) {
        linkStore.restoreLinks(allLinks);
      }
      // インデックステーブルを復元 + noteLinks を自動補完
      if (page.indexTables) {
        indexTableStore.restore(page.indexTables);
        // indexTables 内のリンク済みノートで noteLinks に未登録のものを追加
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
    // チャット履歴を復元
    if (initialDoc.chats && initialDoc.chats.length > 0) {
      aiAssistant.restoreChats(initialDoc.chats);
    }
  }, [initialDoc, labelStore, linkStore, indexTableStore, aiAssistant]);

  // 保存
  const handleSave = useCallback(() => {
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

    const doc: ProvNoteDocument = {
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
      // ノート間リンクを保持（インデックステーブルからの追加分も含む）
      noteLinks: noteLinksRef.current.length > 0 ? noteLinksRef.current : undefined,
      derivedFromNoteId: initialDoc?.derivedFromNoteId,
      derivedFromBlockId: initialDoc?.derivedFromBlockId,
      chats: savedChats.length > 0 ? savedChats : undefined,
      createdAt: initialDoc?.createdAt || new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    onSave(doc);
    setDirty(false);
  }, [title, labelStore, linkStore, indexTableStore, aiAssistant, initialDoc, onSave]);

  // 常に最新の handleSave を ref に保持
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  // 変更をマーク → 3秒後に自動保存（ref 経由で常に最新の状態で保存）
  const markDirty = useCallback(() => {
    setDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveRef.current();
    }, 3000);
  }, []);

  // タイマーのクリーンアップ
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

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

  // AI 回答をスコープに反映
  // 見出しスコープ: スコープ末尾に新ブロックとして挿入
  // ブロック単体: 既存ブロックの content 末尾に追記
  const handleInsertToScope = useCallback(
    (markdown: string) => {
      if (!editorRef.current) return;
      const editor = editorRef.current;

      const targetBlockId = aiAssistant.sourceBlockIds[0];
      if (!targetBlockId) return;

      const targetBlock = editor.getBlock(targetBlockId);
      if (!targetBlock) return;

      if (targetBlock.type === "heading") {
        // 見出しスコープ: 末尾に新ブロックとして挿入
        const blocks = editor.tryParseMarkdownToBlocks(markdown);
        if (blocks.length === 0) return;
        const scope = collectHeadingScope(editor.document, targetBlock);
        const insertAfterBlock = scope[scope.length - 1];
        editor.insertBlocks(blocks, insertAfterBlock, "after");
      } else {
        // ブロック単体: content 末尾に改行+テキストを追記
        const existingContent = Array.isArray(targetBlock.content) ? targetBlock.content : [];
        const newContent = [
          ...existingContent,
          { type: "text" as const, text: "\n" + markdown, styles: {} },
        ];
        editor.updateBlock(targetBlockId, { content: newContent });
      }
      markDirty();
    },
    [markDirty, aiAssistant.sourceBlockIds],
  );

  // タイトル変更時に自動保存トリガー
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      markDirty();
    },
    [markDirty]
  );

  // Ctrl+S / Cmd+S で保存（複数レベルでキャプチャ）
  // サイドピーク内にフォーカスがある場合はサイドピーク側に任せる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        const sidePeekEl = document.querySelector("[data-side-peek]");
        if (sidePeekEl && sidePeekEl.contains(document.activeElement)) {
          return; // サイドピーク側のハンドラに委譲
        }
        e.preventDefault();
        e.stopPropagation();
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        handleSaveRef.current();
      }
    };
    // document と window 両方でキャプチャフェーズに登録
    document.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("keydown", handler, { capture: true });
    };
  }, []);

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
        // 重複チェック
        const exists = noteLinksRef.current.some(
          (l) => l.targetNoteId === targetNoteId && l.sourceBlockId === sourceBlockId
        );
        if (!exists) {
          noteLinksRef.current = [
            ...noteLinksRef.current,
            { targetNoteId, sourceBlockId, type: "derived_from" },
          ];
          // noteLink 追加後に保存をトリガー
          markDirty();
        }
      },
    });
    return () => { setIndexTableCallbacks(null); };
  }, [files, fileId, onNavigateNote, onRefreshFiles, markDirty]);

  // エディタ内の @ノート名（青色テキスト）クリックでサイドピークを開く
  // BlockNote は textColor: "blue" を style.color で描画するため、
  // style.color の有無とテキスト内容で判定する
  useEffect(() => {
    const isMentionSpan = (el: HTMLElement): boolean => {
      // BlockNote は textColor: "blue" を data-style-type="textColor" data-value="blue" で描画する
      if (el.getAttribute("data-style-type") !== "textColor" || el.getAttribute("data-value") !== "blue") return false;
      if (!el.closest(".bn-editor")) return false;
      if (el.closest("table")) return false; // インデックステーブルは icon-layer が処理
      const text = el.textContent?.trim();
      return !!text && text.startsWith("@") && !text.startsWith("@#");
    };

    const resolveMentionNoteId = (noteName: string): string | null => {
      const found = noteIndex?.notes.find((n) => n.title === noteName);
      if (found) return found.noteId;
      const file = files.find(
        (f) => f.name.replace(/\.provnote\.json$/, "") === noteName
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
    openLinkDropdownFn = (params) => {
      const sourceBlockId = params.sourceBlockId;
      // エディタ API でブロック内容からタイトルを生成
      const block = editorRef.current?.getBlock(sourceBlockId);
      const derivedTitle = extractBlockTitle(block) || "派生ノート";
      onDeriveNote(derivedTitle, sourceBlockId);
    };
    return () => { openLinkDropdownFn = null; };
  }, [onDeriveNote]);

  // PROV リアルタイム生成（デバウンス 500ms）
  const provTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateProv = useCallback(() => {
    if (!editorRef.current) return;
    const blocks = editorRef.current.document;
    const doc = generateProvDocument({
      blocks,
      labels: labelStore.labels,
      links: linkStore.links,
    });
    setProvDoc(doc);
  }, [labelStore.labels, linkStore.links]);

  // ラベル・リンク変更時に自動再生成
  useEffect(() => {
    if (provTimerRef.current) clearTimeout(provTimerRef.current);
    provTimerRef.current = setTimeout(generateProv, 500);
    return () => {
      if (provTimerRef.current) clearTimeout(provTimerRef.current);
    };
  }, [generateProv]);

  // エディタ内容変更時にも再生成をトリガー + ラベル自動設定
  const handleContentChange = useCallback(() => {
    markDirty();
    // ラベル自動設定（継承・インデント→属性）
    labelAutoRef.current?.();
    if (provTimerRef.current) clearTimeout(provTimerRef.current);
    provTimerRef.current = setTimeout(generateProv, 500);
  }, [markDirty, generateProv]);

  // 初期コンテンツ（既存ファイルの場合はブロックを復元）
  // スキーマに存在しないブロック型を除去（sampleScope 等の未登録ブロック対策）
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
  // dirty を依存に含めることで、ブロック挿入後にハイライトが再計算される
  const chatScopeBlockIds = useMemo(() => {
    if (rightTab !== "chat" || aiAssistant.sourceBlockIds.length === 0 || !editorRef.current) {
      return [];
    }
    const blockId = aiAssistant.sourceBlockIds[0];
    const block = editorRef.current.getBlock(blockId);
    if (!block) return [blockId];

    if (block.type === "heading") {
      // 見出し: 配下ブロック群をスコープとする
      const scope = collectHeadingScope(editorRef.current.document, block);
      return scope.map((b: any) => b.id);
    }

    // ブロック単体: そのブロックのみをハイライト
    return [blockId];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab, aiAssistant.sourceBlockIds, dirty]);

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
      {/* ヘッダー */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          className="flex-1 min-w-0 text-sm font-medium bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
          placeholder="ノートのタイトル"
          title={title}
        />
        <span className="text-[10px] text-muted-foreground shrink-0">
          {saving ? "保存中..." : dirty ? "未保存" : "保存済み"}
        </span>
        <button
          onClick={() => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            handleSave();
          }}
          disabled={saving}
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-md border transition-colors shrink-0",
            saving
              ? "border-border text-muted-foreground bg-muted cursor-not-allowed"
              : "border-primary text-primary bg-primary/5 hover:bg-primary/10"
          )}
        >
          保存
        </button>
      </div>

      <div className="flex h-full w-full overflow-hidden">
        {/* 左: エディタ */}
        <div data-label-wrapper className="flex-1 min-w-0 overflow-auto relative">
          {/* ProvIndicatorLayer は body ポータルで表示 */}
          <div style={{ padding: "16px 0", paddingLeft: 100, paddingRight: 100 }}>
            <SandboxEditor
              key={fileId || "new"}
              blocks={[]}
              initialContent={initialContent}
              sideMenu={NoteSideMenu}
              extraSlashMenuItems={[...labelSlashMenuItems, indexTableSlashItem]}
              formattingToolbar={NoteFormattingToolbar}
              onEditorReady={handleEditorReady}
              onChange={handleContentChange}
              uploadFile={uploadMediaFile}
              onHashtagSelect={(blockId, label) => labelStore.setLabel(blockId, label)}
              getMentionSuggestions={() => {
                // @ 入力時点でカーソル位置を保存（この時点ではまだセル内にいる）
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
                    // テーブルブロック ID を取得
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
                  // 同ノート内見出しへの知識層リンク
                  linkStore.addLink({
                    sourceBlockId,
                    targetBlockId: suggestion.id,
                    type: "reference",
                    createdBy: "human",
                  });
                  // カーソル位置に @見出し名 を青色で挿入
                  setTimeout(() => {
                    editorRef.current?.insertInlineContent([
                      { type: "text", text: `@${suggestion.label}`, styles: { textColor: "blue" } },
                      { type: "text", text: " ", styles: {} },
                    ]);
                  }, 100);
                  markDirty();
                } else if (suggestion.type === "note") {
                  // 他ノートへの知識層リンク
                  linkStore.addLink({
                    sourceBlockId,
                    targetBlockId: "",
                    targetNoteId: suggestion.id,
                    type: "reference",
                    createdBy: "human",
                  });

                  // インデックステーブル内の @ 選択なら linkedNotes を更新
                  // getMentionSuggestions で保存したコンテキストを使う
                  const ctx = mentionContextRef.current;
                  if (ctx.tableBlockId && ctx.rowIndex > 0 && editorRef.current) {
                    const noteName = suggestion.label;
                    const tableBlockId = ctx.tableBlockId;
                    const rowIndex = ctx.rowIndex;

                    // linkedNotes を更新（セルテキストは @noteName になる）
                    indexTableStore.setLinkedNote(tableBlockId, `@${noteName}`, suggestion.id);

                    // セルにノート名を挿入（BlockNote が @テキスト を削除するため）
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

                    // noteLink も追加
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
                    // 通常ブロック: カーソル位置に @ノート名 を青色で挿入
                    setTimeout(() => {
                      editorRef.current?.insertInlineContent([
                        { type: "text", text: `@${suggestion.label}`, styles: { textColor: "blue" } },
                        { type: "text", text: " ", styles: {} },
                      ]);
                    }, 100);

                    // noteLink を追加
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

                  // コンテキストをリセット
                  mentionContextRef.current = { tableBlockId: null, rowIndex: -1 };
                }
              }}
            />
          </div>
        </div>

        {/* 右: Graph / PROV / Chat / Source パネル */}
        <div className="w-[480px] shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            {(["graph", "prov", "chat", ...(sourceDoc ? ["source" as const] : [])] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={cn(
                  "text-xs font-bold tracking-wide px-1.5 py-0.5 rounded transition-colors",
                  rightTab === tab
                    ? "text-foreground bg-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "graph" ? "Graph" : tab === "prov" ? "手順" : tab === "chat" ? "Chat" : "Source"}
              </button>
            ))}
            {rightTab === "prov" && (
              <button
                onClick={generateProv}
                title="手動で再生成"
                className="px-2.5 py-0.5 text-xs font-semibold rounded border border-primary bg-primary/5 text-primary cursor-pointer hover:bg-primary/10 transition-colors ml-auto"
              >
                生成
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
                onDeriveNote={handleAiDeriveFromChat}
              />
            )}
            {rightTab === "source" && sourceDoc && (
              <SourceDocPanel doc={sourceDoc} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── メインアプリ ──
export function NoteApp() {
  const { authenticated, loading: authLoading, signIn, signOut } = useGoogleAuth();
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [agentConfigured, setAgentConfigured] = useState(() => isAgentConfigured());
  const [files, setFiles] = useState<ProvNoteFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeFileId, _setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  const setActiveFileId = useCallback((id: string | null) => {
    activeFileIdRef.current = id;
    _setActiveFileId(id);
    // 最後に開いたファイルを記録
    if (id) {
      localStorage.setItem("provnote_last_file", id);
    }
  }, []);
  const [activeDoc, setActiveDoc] = useState<ProvNoteDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // エディタを強制的にリマウントするためのキー
  const [editorKey, setEditorKey] = useState(0);
  // ノートキャッシュ（Drive API 呼び出しを削減）
  const docCacheRef = useRef<Map<string, ProvNoteDocument>>(new Map());
  // ネットワークグラフデータ
  const [noteGraphData, setNoteGraphData] = useState<NoteGraphData>({ nodes: [], edges: [] });
  // Split View 用の派生元ノート（NoteApp レベルで管理し、ファイル切り替えでも保持）
  const [sourceDoc, setSourceDoc] = useState<ProvNoteDocument | null>(null);
  // ノート一覧ビューの表示状態
  const [showNoteList, setShowNoteList] = useState(false);
  // 最近のノート履歴
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecentNotes());
  // ノートインデックス（.provnote-index.json）
  const [noteIndex, setNoteIndex] = useState<ProvNoteIndex | null>(null);
  const noteIndexRef = useRef<ProvNoteIndex | null>(null);

  // ファイル一覧を取得
  const refreshFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const result = await listFiles();
      setFiles(result);
    } catch (err) {
      console.error("ファイル一覧の取得に失敗:", err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // ネットワークグラフを構築（全ノートの派生関係を取得）
  const rebuildGraph = useCallback(
    async (currentId: string | null, fileList: ProvNoteFile[]) => {
      if (!currentId || fileList.length === 0) {
        setNoteGraphData({ nodes: [], edges: [] });
        return;
      }
      // 未取得のノートをバックグラウンドで読み込み
      const missing = fileList.filter((f) => !docCacheRef.current.has(f.id));
      if (missing.length > 0) {
        const results = await Promise.allSettled(
          missing.map(async (f) => {
            const doc = await loadFile(f.id);
            docCacheRef.current.set(f.id, doc);
          })
        );
        // エラーは無視（削除済みファイルなど）
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(`ノート読み込みスキップ: ${missing[i].name}`);
          }
        });
      }
      setNoteGraphData(buildNoteGraph(currentId, fileList, docCacheRef.current));
    },
    []
  );

  // ファイルを開く（キャッシュ優先、cachedDoc が渡された場合はキャッシュを即時更新）
  const handleOpenFile = useCallback(async (fileId: string, cachedDoc?: ProvNoteDocument) => {
    try {
      // ノート一覧ビューを閉じる
      setShowNoteList(false);
      // サイドピーク等から保存済みドキュメントが渡された場合、キャッシュを即時更新
      if (cachedDoc) {
        docCacheRef.current.set(fileId, cachedDoc);
      }
      // キャッシュにあれば即座に表示
      const cached = docCacheRef.current.get(fileId);
      if (cached) {
        setActiveFileId(fileId);
        setActiveDoc(cached);
        setEditorKey((k) => k + 1);
        // 最近のノートに追加
        setRecentNotes(addToRecent(fileId, cached.title));
        // バックグラウンドで最新を取得してキャッシュ更新
        loadFile(fileId).then((doc) => docCacheRef.current.set(fileId, doc)).catch(() => {});
        return;
      }
      const doc = await loadFile(fileId);
      docCacheRef.current.set(fileId, doc);
      setActiveFileId(fileId);
      setActiveDoc(doc);
      setEditorKey((k) => k + 1);
      // 最近のノートに追加
      setRecentNotes(addToRecent(fileId, doc.title));
    } catch (err) {
      console.error("ファイルの読み込みに失敗:", err);
    }
  }, [setActiveFileId]);

  // 認証完了後にファイル一覧を取得し、インデックスを構築、最後に開いたファイルを復元
  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      await refreshFiles();
      const lastFileId = localStorage.getItem("provnote_last_file");
      if (lastFileId && !activeFileIdRef.current) {
        handleOpenFile(lastFileId);
      }
    })();
  }, [authenticated, refreshFiles, handleOpenFile]);

  // ファイル一覧が取得されたらインデックスを構築
  useEffect(() => {
    if (!authenticated || files.length === 0) return;
    let cancelled = false;
    (async () => {
      const index = await ensureIndex(files, docCacheRef.current);
      if (!cancelled) {
        noteIndexRef.current = index;
        setNoteIndex(index);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, files]);

  // activeFileId や files が変わったらグラフを再構築
  useEffect(() => {
    if (activeFileId && files.length > 0) {
      rebuildGraph(activeFileId, files);
    }
  }, [activeFileId, files, rebuildGraph]);

  // 新しいノートを作成
  const handleNewNote = useCallback(() => {
    setActiveFileId(null);
    setActiveDoc(null);
    setEditorKey((k) => k + 1);
  }, []);

  // PROV テンプレートから作成
  const handleNewFromTemplate = useCallback(() => {
    setActiveFileId(null);
    setActiveDoc({
      ...PROV_TEMPLATE,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    });
    setEditorKey((k) => k + 1);
  }, []);

  // 保存（ref 経由で常に最新の activeFileId を使用）
  const handleSave = useCallback(
    async (doc: ProvNoteDocument) => {
      // 保存中なら二重実行しない
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        // 孤児リンクをクリーンアップ（存在しないノートへの参照を除去）
        const fileIds = new Set(files.map((f) => f.id));
        if (doc.noteLinks) {
          doc = { ...doc, noteLinks: doc.noteLinks.filter((l) => fileIds.has(l.targetNoteId)) };
          if (doc.noteLinks!.length === 0) doc = { ...doc, noteLinks: undefined };
        }
        if (doc.derivedFromNoteId && !fileIds.has(doc.derivedFromNoteId)) {
          doc = { ...doc, derivedFromNoteId: undefined, derivedFromBlockId: undefined };
        }

        const currentFileId = activeFileIdRef.current;
        if (currentFileId) {
          // 既存ファイルを上書き
          await saveFile(currentFileId, doc);
          // キャッシュも更新
          docCacheRef.current.set(currentFileId, doc);
          // ローカルのファイル一覧を即座に更新
          setFiles((prev) =>
            prev.map((f) =>
              f.id === currentFileId
                ? { ...f, name: `${doc.title}.provnote.json`, modifiedTime: new Date().toISOString() }
                : f
            )
          );
          // 最近のノートを更新
          setRecentNotes(addToRecent(currentFileId, doc.title));
        } else {
          // 新規作成
          const newId = await createFile(doc.title, doc);
          docCacheRef.current.set(newId, doc);
          setActiveDoc(doc);
          setActiveFileId(newId);
          // 最近のノートに追加
          setRecentNotes(addToRecent(newId, doc.title));
          // 新規ファイルを一覧に追加
          const newFile: ProvNoteFile = {
            id: newId,
            name: `${doc.title}.provnote.json`,
            modifiedTime: new Date().toISOString(),
            createdTime: new Date().toISOString(),
          };
          setFiles((prev) => [newFile, ...prev]);
        }

        // インデックスを差分更新
        if (noteIndexRef.current) {
          const savedFileId = currentFileId ?? activeFileIdRef.current;
          if (savedFileId) {
            const updated = updateIndexEntry(noteIndexRef.current, savedFileId, doc);
            noteIndexRef.current = updated;
            setNoteIndex(updated);
            saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
          }
        }
      } catch (err) {
        console.error("保存に失敗:", err);
        alert("保存に失敗しました。再度お試しください。");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [setActiveFileId, files]
  );

  // 派生ノートを別ファイルとして作成
  const [deriving, setDeriving] = useState(false);
  const handleDeriveNote = useCallback(
    async (derivedTitle: string, sourceBlockId: string) => {
      setDeriving(true);
      try {
        // 派生先ノートを作成
        const now = new Date().toISOString();
        const newDoc: ProvNoteDocument = {
          version: 2,
          title: `↳ ${derivedTitle}`,
          pages: [{ id: "main", title: `↳ ${derivedTitle}`, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
          derivedFromNoteId: activeFileIdRef.current ?? undefined,
          derivedFromBlockId: sourceBlockId,
          createdAt: now,
          modifiedAt: now,
        };
        const newFileId = await createFile(newDoc.title, newDoc);

        // 元ノートに noteLinks を追加して保存
        if (activeFileIdRef.current && activeDoc) {
          const noteLinks = activeDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId,
            type: "derived_from",
          });
          const updatedDoc = { ...activeDoc, noteLinks, modifiedAt: now };
          await saveFile(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `↳ ${derivedTitle}.provnote.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        // インデックスを更新（派生先ノート + 元ノート両方）
        if (noteIndexRef.current) {
          let updated = updateIndexEntry(noteIndexRef.current, newFileId, newDoc);
          if (activeFileIdRef.current && activeDoc) {
            updated = updateIndexEntry(updated, activeFileIdRef.current, activeDoc);
          }
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }

        // 派生先ノートを開く
        handleOpenFile(newFileId);
      } catch (err) {
        console.error("派生ノートの作成に失敗:", err);
      } finally {
        setDeriving(false);
      }
    },
    [activeDoc, handleOpenFile, setActiveFileId]
  );

  // AI 派生ノートを作成（構築済みの ProvNoteDocument を受け取って保存）
  const handleAiDeriveNote = useCallback(
    async (doc: ProvNoteDocument) => {
      setDeriving(true);
      try {
        const newFileId = await createFile(doc.title, doc);
        const now = new Date().toISOString();

        // 元ノートに noteLinks を追加して保存
        if (activeFileIdRef.current && activeDoc && doc.derivedFromBlockId) {
          const noteLinks = activeDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId: doc.derivedFromBlockId,
            type: "derived_from",
          });
          const updatedDoc = { ...activeDoc, noteLinks, modifiedAt: now };
          await saveFile(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `${doc.title}.provnote.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        // インデックスを更新
        if (noteIndexRef.current) {
          let updated = updateIndexEntry(noteIndexRef.current, newFileId, doc);
          if (activeFileIdRef.current && activeDoc) {
            updated = updateIndexEntry(updated, activeFileIdRef.current, activeDoc);
          }
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }

        // 派生先ノートを開く
        handleOpenFile(newFileId);
      } catch (err) {
        console.error("AI 派生ノートの作成に失敗:", err);
        throw err; // モーダル側でエラー表示
      } finally {
        setDeriving(false);
      }
    },
    [activeDoc, handleOpenFile, setActiveFileId],
  );

  // 削除（関連ノートのリンク情報もクリーンアップ）
  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        // 削除対象のドキュメントを取得
        const targetDoc = docCacheRef.current.get(fileId);

        if (targetDoc) {
          // 1. 派生元ノートの noteLinks から削除対象への参照を除去
          if (targetDoc.derivedFromNoteId) {
            const parentDoc = docCacheRef.current.get(targetDoc.derivedFromNoteId);
            if (parentDoc?.noteLinks) {
              const filtered = parentDoc.noteLinks.filter(
                (link) => link.targetNoteId !== fileId
              );
              const updatedParent = {
                ...parentDoc,
                noteLinks: filtered.length > 0 ? filtered : undefined,
                modifiedAt: new Date().toISOString(),
              };
              await saveFile(targetDoc.derivedFromNoteId, updatedParent);
              docCacheRef.current.set(targetDoc.derivedFromNoteId, updatedParent);
            }
          }

          // 2. 派生先ノートの derivedFromNoteId を除去
          if (targetDoc.noteLinks) {
            for (const link of targetDoc.noteLinks) {
              const childDoc = docCacheRef.current.get(link.targetNoteId);
              if (childDoc?.derivedFromNoteId === fileId) {
                const updatedChild = {
                  ...childDoc,
                  derivedFromNoteId: undefined,
                  derivedFromBlockId: undefined,
                  modifiedAt: new Date().toISOString(),
                };
                await saveFile(link.targetNoteId, updatedChild);
                docCacheRef.current.set(link.targetNoteId, updatedChild);
              }
            }
          }
        }

        // キャッシュから削除
        docCacheRef.current.delete(fileId);

        await deleteFile(fileId);
        // 最近のノートからも除去
        setRecentNotes(removeFromRecent(fileId));
        // インデックスから除去
        if (noteIndexRef.current) {
          const updated = removeIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        if (activeFileId === fileId) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
        await refreshFiles();
      } catch (err) {
        console.error("削除に失敗:", err);
      }
    },
    [activeFileId, refreshFiles]
  );

  // 認証読み込み中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  // 未認証
  if (!authenticated) {
    return <LoginScreen onSignIn={signIn} />;
  }

  return (
    <div className="flex h-screen font-sans antialiased bg-background text-foreground">
      <FileSidebar
        activeFileId={activeFileId}
        onSelect={handleOpenFile}
        onNewNote={handleNewNote}
        onNewFromTemplate={handleNewFromTemplate}
        onRefresh={refreshFiles}
        onSignOut={signOut}
        onShowReleaseNotes={() => setShowReleaseNotes(true)}
        onShowSettings={() => setShowSettings(true)}
        agentConfigured={agentConfigured}
        recentNotes={recentNotes}
        onShowNoteList={() => setShowNoteList(true)}
      />
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {showNoteList ? (
          <NoteListView
            noteIndex={noteIndex}
            onOpenNote={handleOpenFile}
            onBack={() => setShowNoteList(false)}
          />
        ) : (
          <NoteEditor
            key={editorKey}
            fileId={activeFileId}
            initialDoc={activeDoc}
            onSave={handleSave}
            onDeriveNote={handleDeriveNote}
            onAiDeriveNote={handleAiDeriveNote}
            onNavigateNote={handleOpenFile}
            getCachedDoc={(noteId) => docCacheRef.current.get(noteId)}
            onRefreshFiles={refreshFiles}
            saving={saving}
            files={files}
            noteGraphData={noteGraphData}
            sourceDoc={sourceDoc}
            onSourceDocChange={setSourceDoc}
            noteIndex={noteIndex}
          />
        )}
        {/* 派生ノート作成中のオーバーレイ */}
        {deriving && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
            <div className="text-center space-y-2">
              <div className="text-sm font-medium text-foreground">派生ノートを作成中...</div>
              <div className="text-xs text-muted-foreground">Google Drive に保存しています</div>
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
  );
}
