// Notion 風サイドピーク
// 画面右側からスライドインし、リンク先ノートを編集可能な BlockNote で表示する
// 背景ページは操作可能（薄暗くならない）
// ラベル機能（ProvIndicatorLayer + LabelDropdownPortal + #オートコンプリート）対応

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AddBlockButton,
  DragHandleButton,
  BlockColorsItem,
  SideMenu,
} from "@blocknote/react";
import { DeleteBlockMenuItem, AlignmentMenuItems } from "../../components/side-menu";
import type { GraphiumDocument } from "../../lib/document-types";
import { getActiveProvider } from "../../lib/storage/registry";
import { SandboxEditor } from "../../base/editor";
import { customBlockEntries, CUSTOM_BLOCK_TYPES } from "../../blocks/registry";
import { bookmarkSlashItem, setBookmarkPickerCallback } from "../../blocks/bookmark";
import { calloutSlashItem } from "../../blocks/callout";
import {
  getMediaSlashMenuItems,
  DEFAULT_MEDIA_SLASH_TITLES,
  MediaPickerModal,
  setMediaPickerCallback,
  extractDomain,
} from "@features/asset-browser";
import type { MediaIndex, MediaIndexEntry, MediaType } from "@features/asset-browser";
import {
  getMemoSlashMenuItem,
  setMemoPickerCallback,
  MemoPickerModal,
  buildMemoInsertBlock,
} from "@features/mobile-capture";
import type { CaptureIndex, CaptureEntry } from "@features/mobile-capture";
import { LabelStoreProvider, useLabelStore } from "@features/context-label/store";
import { LinkStoreProvider, useLinkStore } from "@features/block-link/store";
import { LabelDropdownPortal } from "@features/context-label/ui";
import { ProvIndicatorLayer, BlockHoverHighlight, ProvIndicatorHoverHint } from "@features/context-label/prov-indicator";
import { buildLabelSlashMenuItems } from "@features/context-label/slash-menu-items";
import { setupLabelAutoAssign } from "@features/context-label/label-auto";
import { KnowledgeStatusChip } from "@features/wiki/KnowledgeStatusChip";
import type { GraphiumIndex, NoteIndexEntry } from "@features/navigation";
import {
  CitePickerModal,
  getCiteSlashMenuItems,
  setCitePickerCallback,
  type CitePickerKind,
} from "@features/cite-picker";
import { useT, t as tStatic } from "../../i18n";

type SidePeekProps = {
  noteId: string;
  /** キャッシュ済みドキュメント（あれば API 取得をスキップして即表示） */
  cachedDoc?: GraphiumDocument;
  onClose: () => void;
  onNavigate: (noteId: string, savedDoc?: GraphiumDocument) => void;
  /**
   * このノートを派生元とする wiki エントリ。Knowledge 化状態チップ表示用。
   * 渡されないか空配列 + onAddToKnowledge 未指定の場合はチップは描画されない。
   */
  wikiEntries?: NoteIndexEntry[];
  /** 未化のときに「Add to Knowledge」を押すと呼ばれる */
  onAddToKnowledge?: () => void;
  /** アーカイブ済みドキュメントの場合 true。エディタを read-only にする */
  archived?: boolean;
  /**
   * inline=true: 親レイアウトに flex item として組み込まれる（fixed 配置せず、
   *   右パネルの左に「差し込まれる」形）。エディタ領域が自然に圧縮される。
   * inline=false（デフォルト）: 従来通り画面右端から portal で fixed 表示。
   */
  inline?: boolean;
  /** スラッシュメニューのメディア / メモピッカー用。未指定だと slash 経由の挿入はできない。 */
  mediaIndex?: MediaIndex | null;
  captureIndex?: CaptureIndex | null;
  /** /image, /video 等の新規アップロード経路。未指定だと既存メディアからの挿入のみ。 */
  uploadFile?: (file: File) => Promise<string>;
  /** /bookmark で新規 URL を追加したとき、アセットブラウザに登録する経路。 */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  /** /claims, /Insights の引用ピッカー用ノートインデックス。未指定だと引用挿入は出さない。 */
  noteIndex?: GraphiumIndex | null;
};

export function SidePeek(props: SidePeekProps) {
  return (
    <LabelStoreProvider>
      <LinkStoreProvider>
        <SidePeekInner {...props} />
      </LinkStoreProvider>
    </LabelStoreProvider>
  );
}

// サイドピーク用の簡易 SideMenu（ラベルは # オートコンプリートで付与）
function SidePeekSideMenu() {
  const t = useT();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <DeleteBlockMenuItem />
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
        <AlignmentMenuItems />
      </DragHandleButton>
    </SideMenu>
  );
}

// 既知のブロック型（未登録ブロック除去用）
// メインエディタ（note-app.tsx）と揃える。カスタムブロックは
// src/blocks/registry.ts の CUSTOM_BLOCK_TYPES から自動で取り込む。
// 取りこぼすと、Peek を開いた瞬間に保存済みカスタムブロックが除去された
// まま auto-save されてデータが壊れる。
const KNOWN_BLOCK_TYPES = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "table", "image", "video", "audio", "file",
  "codeBlock", "quote",
  ...CUSTOM_BLOCK_TYPES,
]);

function sanitizeBlocks(blocks: any[]): any[] {
  return blocks
    .filter((b) => KNOWN_BLOCK_TYPES.has(b.type))
    .map((b) => ({
      ...b,
      children: b.children?.length ? sanitizeBlocks(b.children) : b.children,
    }));
}

function SidePeekInner({
  noteId, cachedDoc, onClose, onNavigate, wikiEntries, onAddToKnowledge,
  archived = false, inline = false,
  mediaIndex, captureIndex, uploadFile, onAddUrlBookmark, noteIndex,
}: SidePeekProps) {
  const t = useT();
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  // labelStore/linkStore は毎レンダリング新しいオブジェクトになるため、
  // ref 経由で最新を参照し、useCallback の依存を安定化する
  const labelStoreRef = useRef(labelStore);
  labelStoreRef.current = labelStore;
  const linkStoreRef = useRef(linkStore);
  linkStoreRef.current = linkStore;
  const editorRef = useRef<any>(null);
  // picker callbacks をエディタ単位で登録するため、editor 実体を state にも持つ
  const [sidePeekEditor, setSidePeekEditor] = useState<any>(null);
  // スラッシュメニューのピッカー状態（main editor とは独立に SidePeek 側で持つ）
  const [pickerMediaType, setPickerMediaType] = useState<MediaType | null>(null);
  const [memoPickerOpen, setMemoPickerOpen] = useState(false);
  const [urlSlashPickerOpen, setUrlSlashPickerOpen] = useState(false);
  const [citePickerKind, setCitePickerKind] = useState<CitePickerKind | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<GraphiumDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "dirty">("saved");
  const docRef = useRef<GraphiumDocument | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidePeekRef = useRef<HTMLDivElement>(null);
  const labelAutoRef = useRef<(() => void) | null>(null);

  // ノート読み込み（cachedDoc がなければ API 取得）
  useEffect(() => {
    if (cachedDoc) {
      // cachedDoc がある場合は API 不要
      setDoc(cachedDoc);
      docRef.current = cachedDoc;
      setLoading(false);
      setError(null);
      setSaveStatus("saved");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    setSaveStatus("saved");
    docRef.current = null;

    // wiki:xxxx 形式のIDの場合は loadWikiFile を使用
    const isWiki = noteId.startsWith("wiki:");
    const loadFn = isWiki
      ? getActiveProvider().loadWikiFile?.(noteId.replace(/^wiki:/, ""))
      : getActiveProvider().loadFile(noteId);

    (loadFn ?? Promise.reject(new Error("Wiki not supported")))
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          docRef.current = d;
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : tStatic("sidePeek.loadError")
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [noteId, cachedDoc]);

  // ドキュメント読み込み後にラベル・リンクを復元
  // setLabel / restoreLinks は useCallback で安定な参照
  const { setLabel } = labelStore;
  const { restoreLinks } = linkStore;
  useEffect(() => {
    if (!doc) return;
    const page = doc.pages?.[0];
    if (!page) return;

    // ラベル復元
    if (page.labels) {
      for (const [blockId, label] of Object.entries(page.labels)) {
        setLabel(blockId, label);
      }
    }
    // リンク復元（provLinks + knowledgeLinks、v1 互換: links）
    const allLinks = [
      ...(page.provLinks ?? []),
      ...(page.knowledgeLinks ?? []),
      ...((page as any).links ?? []),
    ];
    if (allLinks.length > 0) {
      restoreLinks(allLinks);
    }
  }, [doc, setLabel, restoreLinks]);

  // エディタ準備完了時（依存を安定化し、SandboxEditor の不要な再実行を防ぐ）
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    setSidePeekEditor(editor);
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStoreRef.current, linkStore);
  }, []);

  // SidePeek エディタごとに picker callback を登録する。
  // 同じスラッシュアイテムを main editor / SidePeek 双方で使うため、
  // どちらのエディタからクリックされたかを WeakMap で識別する。
  useEffect(() => {
    if (!sidePeekEditor) return;
    setMediaPickerCallback(sidePeekEditor, setPickerMediaType);
    setMemoPickerCallback(sidePeekEditor, () => setMemoPickerOpen(true));
    setBookmarkPickerCallback(sidePeekEditor, () => setUrlSlashPickerOpen(true));
    setCitePickerCallback(sidePeekEditor, setCitePickerKind);
    return () => {
      setMediaPickerCallback(sidePeekEditor, null);
      setMemoPickerCallback(sidePeekEditor, null);
      setBookmarkPickerCallback(sidePeekEditor, null);
      setCitePickerCallback(sidePeekEditor, null);
    };
  }, [sidePeekEditor]);

  // スラッシュ用に「直前のスラッシュブロック」を退避する。
  // BlockNote はスラッシュアイテム選択時点で `/` を含む空ブロックの中身を消すが、
  // 完全に空のパラグラフが残るため、挿入後に削除して見た目をすっきりさせる。
  // currentBlock を都度取り直すと、ピッカーモーダル表示中にフォーカスが移って
  // cursor position が変わる可能性があるので、useState で記憶する。

  // 既存メディアから image/video/audio/pdf 挿入
  const handlePickerSelect = useCallback((entry: MediaIndexEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
      setPickerMediaType(null);
      return;
    }
    const newBlock = entry.type === "pdf"
      ? { type: "pdf", props: { url: entry.url, name: entry.name } }
      : {
          type: entry.type === "video" ? "video" : entry.type === "audio" ? "audio" : "image",
          props: { url: entry.url, name: entry.name },
        };
    editor.insertBlocks([newBlock], currentBlock, "after");
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
    setPickerMediaType(null);
  }, []);

  // /claims, /Insights で選んだ claim / atom ノートを引用挿入。
  // main editor (note-app.tsx handleCitePickerConfirm) と同じ流儀:
  // 青色 `@title` paragraph + knowledge レイヤの reference リンク。
  const handleCiteConfirm = useCallback((entries: NoteIndexEntry[]) => {
    const editor = editorRef.current;
    if (!editor || entries.length === 0) {
      setCitePickerKind(null);
      return;
    }
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
      setCitePickerKind(null);
      return;
    }
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
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
    setCitePickerKind(null);
  }, [linkStore]);

  // 既存 URL ピッカーから bookmark 挿入
  const handleUrlSlashPickerSelect = useCallback((entry: MediaIndexEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
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

  // メモピッカーから挿入
  const handleMemoSelect = useCallback((entry: CaptureEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    const block = buildMemoInsertBlock(entry);
    if (!block) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (currentBlock) {
      editor.insertBlocks([block], currentBlock, "after");
      const content = currentBlock.content;
      if (Array.isArray(content) && content.length <= 1) {
        const text = content[0]?.text?.trim() ?? "";
        if (text === "" || text === "/memo") {
          editor.removeBlocks([currentBlock]);
        }
      }
    }
    setMemoPickerOpen(false);
  }, []);

  // 初期コンテンツ（cachedDoc を優先し、レンダリング時に即利用可能にする）
  const effectiveDoc = cachedDoc ?? doc;
  const initialContent = effectiveDoc?.pages?.[0]?.blocks?.length
    ? sanitizeBlocks(effectiveDoc.pages[0].blocks)
    : undefined;

  // docRef も cachedDoc から即時設定（保存時に必要）
  if (cachedDoc && !docRef.current) {
    docRef.current = cachedDoc;
  }

  // 保存処理（ref 経由で最新の store を参照し、依存を noteId のみに安定化）
  const doSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !docRef.current) return;

    const currentBlocks = editor.document;
    const labelSnapshot = labelStoreRef.current.getSnapshot();
    const labelsObj: Record<string, string> = {};
    for (const [k, v] of labelSnapshot.labels) {
      labelsObj[k] = v;
    }

    // リンクを linkStore から書き戻す（main editor の buildDocument と同じ方式）。
    // 従来は元の page.provLinks/knowledgeLinks をそのまま温存していたが、
    // /claims /Insights の引用で追加した reference リンクを永続化するため、
    // 開いたときに restoreLinks 済みの linkStore を真実として layer 別に書き出す。
    const allLinks = linkStoreRef.current.getAllLinks();
    const provLinks = allLinks.filter((l) => l.layer === "prov");
    const knowledgeLinks = allLinks.filter((l) => l.layer === "knowledge");

    const updatedDoc: GraphiumDocument = {
      ...docRef.current,
      pages: [
        {
          ...docRef.current.pages[0],
          blocks: currentBlocks,
          labels: labelsObj,
          provLinks,
          knowledgeLinks,
        },
      ],
      modifiedAt: new Date().toISOString(),
    };

    setSaveStatus("saving");
    try {
      const isWiki = noteId.startsWith("wiki:");
      if (isWiki) {
        await getActiveProvider().saveWikiFile?.(noteId.replace(/^wiki:/, ""), updatedDoc);
      } else {
        await getActiveProvider().saveFile(noteId, updatedDoc);
      }
      docRef.current = updatedDoc;
      setSaveStatus("saved");
    } catch (err) {
      console.error("サイドピーク保存に失敗:", err);
      setSaveStatus("dirty");
    }
  }, [noteId]);

  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // 変更検知 → 3秒後に自動保存
  const handleChange = useCallback(() => {
    setSaveStatus("dirty");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSaveRef.current();
    }, 3000);
  }, []);

  // Cmd+S / Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        const peekEl = sidePeekRef.current;
        if (peekEl && peekEl.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          doSaveRef.current();
        }
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, []);

  // 閉じるときに未保存を保存
  const handleClose = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    try {
      if (saveStatus === "dirty") {
        await doSaveRef.current();
      }
    } catch (err) {
      console.error("閉じる前の保存に失敗:", err);
    }
    onClose();
  }, [saveStatus, onClose]);

  // フルで開くときも保存
  const handleNavigate = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    try {
      if (saveStatus === "dirty") {
        await doSaveRef.current();
      }
    } catch (err) {
      console.error("遷移前の保存に失敗:", err);
    }
    // 保存済みドキュメントを渡してキャッシュ即時更新（API再取得の遅延を回避）
    onNavigate(noteId, docRef.current ?? undefined);
  }, [saveStatus, noteId, onNavigate]);

  const statusText = saveStatus === "saving" ? t("common.saving")
    : saveStatus === "dirty" ? t("common.unsaved")
    : t("common.saved");

  const statusColor = saveStatus === "dirty" ? "var(--color-warning)"
    : "var(--color-text-tertiary)";

  const containerStyle: React.CSSProperties = inline
    ? {
        // inline: 親 flex レイアウトに組み込まれる。エディタ領域がその分圧縮される。
        // 狭いデスクトップ（768〜1100px）で固定 480px だとエディタが極端に細るため、
        // ビューポート幅に応じて 320〜480px の範囲で伸縮させる。
        position: "relative",
        height: "100%",
        flexShrink: 0,
        width: "clamp(320px, 38vw, 480px)",
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      }
    : {
        // overlay（従来）: 画面右端から fixed で被せる
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "55%",
        // 小型スマホ（〜420px）で固定 400px だと画面外にはみ出すため、ビューポート幅で頭打ちにする
        minWidth: "min(400px, 90vw)",
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
    <div
      ref={sidePeekRef}
      data-side-peek
      style={containerStyle}
    >
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleClose}
          title={t("sidePeek.close")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>

        <button
          onClick={handleNavigate}
          title={t("sidePeek.fullscreen")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="10" y1="14" x2="3" y2="21" />
          </svg>
        </button>

        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: 4,
          }}
        >
          {effectiveDoc?.title ?? ""}
        </span>

        {!noteId.startsWith("wiki:") && (
          <KnowledgeStatusChip
            wikiEntries={wikiEntries ?? []}
            onAdd={onAddToKnowledge}
            onOpen={(wikiNoteId) => onNavigate(wikiNoteId)}
          />
        )}

        <span
          style={{
            fontSize: 10,
            color: statusColor,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {statusText}
        </span>
      </div>

      {/* コンテンツ */}
      <div ref={setWrapperEl} data-label-wrapper style={{ flex: 1, overflow: "auto", background: "var(--color-background)", position: "relative" }}>
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "var(--color-text-tertiary)",
              fontSize: 13,
            }}
          >
            {t("common.loading")}
          </div>
        )}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "var(--color-destructive)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && initialContent && (
          <>
            <ProvIndicatorLayer wrapperEl={wrapperEl} />
            <BlockHoverHighlight wrapperEl={wrapperEl} zIndex={101} />
            <ProvIndicatorHoverHint wrapperEl={wrapperEl} zIndex={101} />
            <LabelDropdownPortal />
            {/* 右ガター（80px）はラベル/リンクのインジケータを置く場所。
                何も付いていないノートでは左右非対称な余白が「歪み」に見えるため、
                ラベルもリンクも無いときは左右対称（24px）にする。 */}
            <div
              style={{
                padding: "16px 24px",
                paddingRight:
                  labelStore.labels.size > 0 || linkStore.links.length > 0 ? 80 : 24,
              }}
            >
              <textarea
                value={effectiveDoc?.title ?? ""}
                onChange={(e) => {
                  const newTitle = e.target.value.replace(/\r?\n/g, "");
                  if (docRef.current) {
                    docRef.current = { ...docRef.current, title: newTitle };
                  }
                  setDoc((d) => (d ? { ...d, title: newTitle } : d));
                  handleChange();
                }}
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
                  if (e.key === "Enter") {
                    e.preventDefault();
                    editorRef.current?.focus();
                  }
                }}
                rows={1}
                placeholder={tStatic("editor.titlePlaceholder")}
                aria-label={tStatic("editor.titlePlaceholder")}
                className="block w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 text-3xl font-bold leading-tight mt-1 mb-4 px-[54px] resize-none overflow-hidden break-words"
              />
              <SandboxEditor
                key={noteId}
                editable={!archived}
                blocks={customBlockEntries}
                initialContent={initialContent}
                sideMenu={SidePeekSideMenu}
                // メインエディタと同じ slash items を出す。
                // 各 slash item の onItemClick はクリック時のエディタを
                // ピッカーに渡すよう改修済みなので、SidePeek で開いた場合は
                // SidePeek のエディタに挿入される。
                extraSlashMenuItems={[
                  ...buildLabelSlashMenuItems(),
                  ...getMediaSlashMenuItems(),
                  bookmarkSlashItem,
                  calloutSlashItem,
                  getMemoSlashMenuItem(),
                  ...(noteIndex ? getCiteSlashMenuItems() : []),
                ]}
                excludeDefaultSlashTitles={DEFAULT_MEDIA_SLASH_TITLES}
                onEditorReady={handleEditorReady}
                onChange={handleChange}
                onHashtagSelect={(blockId, label) => labelStoreRef.current.setLabel(blockId, label)}
                // メインエディタと同様にメディア URL を解決する。
                // これがないと image / video / audio のブロックが
                // local-media:// 等の生 URL のままになり、BlockNote
                // デフォルトの「ファイル読み込み中」状態で止まって見える。
                resolveFileUrl={async (url: string) => {
                  const p = getActiveProvider();
                  const fid = p.extractFileId(url);
                  if (fid) return p.getMediaBlobUrl(fid);
                  return url;
                }}
              />
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes sidePeekSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* スラッシュメニューのピッカーモーダル。
          SidePeek overlay (z-index:100) より前面に出すため、
          z-index:200 の wrapper で stacking context を切る。
          (MediaPickerModal の内部 z-50 は wrapper 内で相対化される。) */}
      <div style={{ position: "fixed", inset: 0, zIndex: 200, pointerEvents: pickerMediaType || urlSlashPickerOpen || memoPickerOpen || citePickerKind ? "auto" : "none" }}>
        {pickerMediaType && (
          <MediaPickerModal
            mediaIndex={mediaIndex ?? null}
            mediaType={pickerMediaType}
            onSelect={handlePickerSelect}
            onClose={() => setPickerMediaType(null)}
            onUpload={uploadFile}
          />
        )}
        {citePickerKind && (
          <CitePickerModal
            noteIndex={noteIndex ?? null}
            kind={citePickerKind}
            onConfirm={handleCiteConfirm}
            onClose={() => setCitePickerKind(null)}
          />
        )}
        {urlSlashPickerOpen && (
          <MediaPickerModal
            mediaIndex={mediaIndex ?? null}
            mediaType="url"
            onSelect={handleUrlSlashPickerSelect}
            onClose={() => setUrlSlashPickerOpen(false)}
            onAddUrlBookmark={onAddUrlBookmark}
          />
        )}
        <MemoPickerModal
          open={memoPickerOpen}
          onClose={() => setMemoPickerOpen(false)}
          captureIndex={captureIndex ?? null}
          onSelect={handleMemoSelect}
        />
      </div>
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}
