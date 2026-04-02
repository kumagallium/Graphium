// ノートアプリのメイン画面
// Google Drive と連携してノートの作成・保存・読み込みを行う

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SandboxEditor } from "./base/editor";
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
import { SettingsModal, isAgentConfigured, getSelectedModel, getSelectedProfile } from "./features/settings";
import { useGoogleAuth } from "./lib/use-google-auth";
import {
  uploadMediaFile,
  type ProvNoteDocument,
} from "./lib/google-drive";
import type { NoteLink } from "./lib/google-drive";
import { cn } from "./lib/utils";
import { NoteListView, type ProvNoteIndex } from "./features/navigation";
import { useT, t as tStatic } from "./i18n";

// hooks
import { useAutoSave } from "./hooks/use-auto-save";
import { useProvGeneration } from "./hooks/use-prov-generation";
import { useFileManager } from "./hooks/use-file-manager";

// components
import { LoginScreen } from "./components/LoginScreen";
import { FileSidebar } from "./components/FileSidebar";
import { NoteSideMenu, collectHeadingScope, setOpenLinkDropdownFn } from "./components/side-menu";
import { NoteFormattingToolbar } from "./components/formatting-toolbar";
import { SourceDocPanel, extractBlockTitle } from "./components/SourceDocPanel";

import type { ProvNoteFile } from "./lib/google-drive";
import type { NoteGraphData } from "./features/network-graph";

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
  const [rightTab, setRightTab] = useState<"graph" | "prov" | "chat" | "source">(
    sourceDoc ? "source" : "graph"
  );
  const t = useT();
  const [title, setTitle] = useState(initialDoc?.title || tStatic("editor.newNote"));

  // ラベル自動設定のコールバック
  const labelAutoRef = useRef<(() => void) | null>(null);

  // エディタ参照を保持
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    // ラベル自動設定をセットアップ
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStore);
  }, [labelStore]);

  // ── 保存ロジック ──
  const buildDocument = useCallback((): ProvNoteDocument => {
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
    return {
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
      chats: savedChats.length > 0 ? savedChats : undefined,
      createdAt: initialDoc?.createdAt || new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
  }, [title, labelStore, linkStore, indexTableStore, aiAssistant, initialDoc]);

  const handleSave = useCallback(() => {
    onSave(buildDocument());
  }, [onSave, buildDocument]);

  // ── オートセーブ ──
  const { dirty, setDirty, markDirty, saveNow } = useAutoSave(handleSave);

  // ── PROV 生成 ──
  const { provDoc, generateProv, triggerRegeneration } = useProvGeneration(
    editorRef,
    labelStore.labels,
    linkStore.links,
  );

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
        const selectedModel = getSelectedModel();
        const response = await runAgent({
          message: userMessage,
          profile: getSelectedProfile(),
          options: { max_turns: 5, ...(selectedModel && { model: selectedModel }) },
        });
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
      if (!targetBlockId) return;
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
      markDirty();
    },
    [markDirty, aiAssistant.sourceBlockIds],
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
    setOpenLinkDropdownFn((params) => {
      const sourceBlockId = params.sourceBlockId;
      const block = editorRef.current?.getBlock(sourceBlockId);
      const derivedTitle = extractBlockTitle(block) || tStatic("editor.derivedNote");
      onDeriveNote(derivedTitle, sourceBlockId);
    });
    return () => { setOpenLinkDropdownFn(null); };
  }, [onDeriveNote]);

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
      {/* ヘッダー */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
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
        <button
          onClick={saveNow}
          disabled={saving}
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-md border transition-colors shrink-0",
            saving
              ? "border-border text-muted-foreground bg-muted cursor-not-allowed"
              : "border-primary text-primary bg-primary/5 hover:bg-primary/10"
          )}
        >
          {t("common.save")}
        </button>
      </div>

      <div className="flex h-full w-full overflow-hidden">
        {/* 左: エディタ */}
        <div data-label-wrapper className="flex-1 min-w-0 overflow-auto relative">
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
                {tab === "graph" ? "Graph" : tab === "prov" ? t("panel.prov") : tab === "chat" ? "Chat" : "Source"}
              </button>
            ))}
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

  const fm = useFileManager(authenticated);

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
    return <LoginScreen onSignIn={signIn} />;
  }

  return (
    <div className="flex h-screen font-sans antialiased bg-background text-foreground">
      <FileSidebar
        activeFileId={fm.activeFileId}
        onSelect={fm.handleOpenFile}
        onNewNote={fm.handleNewNote}
        onNewFromTemplate={fm.handleNewFromTemplate}
        onRefresh={fm.refreshFiles}
        onSignOut={signOut}
        onShowReleaseNotes={() => setShowReleaseNotes(true)}
        onShowSettings={() => setShowSettings(true)}
        agentConfigured={agentConfigured}
        recentNotes={fm.recentNotes}
        onShowNoteList={() => fm.setShowNoteList(true)}
      />
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {fm.showNoteList ? (
          <NoteListView
            noteIndex={fm.noteIndex}
            onOpenNote={fm.handleOpenFile}
            onBack={() => fm.setShowNoteList(false)}
            onDeleteNotes={async (ids) => {
              for (const id of ids) await fm.handleDelete(id);
            }}
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
  );
}
