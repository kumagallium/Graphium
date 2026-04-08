// Notion 風サイドピーク
// 画面右側からスライドインし、リンク先ノートを編集可能な BlockNote で表示する
// 背景ページは操作可能（薄暗くならない）
// ラベル機能（ProvIndicatorLayer + LabelDropdownPortal + #オートコンプリート）対応

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AddBlockButton,
  DragHandleButton,
  RemoveBlockItem,
  BlockColorsItem,
  SideMenu,
} from "@blocknote/react";
import {
  loadFile,
  saveFile,
  type ProvNoteDocument,
} from "../../lib/google-drive";
import { SandboxEditor } from "../../base/editor";
import { LabelStoreProvider, useLabelStore } from "@features/context-label/store";
import { LinkStoreProvider, useLinkStore } from "@features/block-link/store";
import { LabelDropdownPortal } from "@features/context-label/ui";
import { ProvIndicatorLayer, BlockHoverHighlight, ProvIndicatorHoverHint } from "@features/context-label/prov-indicator";
import { buildLabelSlashMenuItems } from "@features/context-label/slash-menu-items";
import { setupLabelAutoAssign } from "@features/context-label/label-auto";
import { useT, t as tStatic } from "../../i18n";

type SidePeekProps = {
  noteId: string;
  /** キャッシュ済みドキュメント（あれば API 取得をスキップして即表示） */
  cachedDoc?: ProvNoteDocument;
  onClose: () => void;
  onNavigate: (noteId: string, savedDoc?: ProvNoteDocument) => void;
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
        <RemoveBlockItem>{t("common.delete")}</RemoveBlockItem>
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
      </DragHandleButton>
    </SideMenu>
  );
}

// 既知のブロック型（未登録ブロック除去用）
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

function SidePeekInner({ noteId, cachedDoc, onClose, onNavigate }: SidePeekProps) {
  const t = useT();
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  // labelStore/linkStore は毎レンダリング新しいオブジェクトになるため、
  // ref 経由で最新を参照し、useCallback の依存を安定化する
  const labelStoreRef = useRef(labelStore);
  labelStoreRef.current = labelStore;
  const editorRef = useRef<any>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<ProvNoteDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "dirty">("saved");
  const docRef = useRef<ProvNoteDocument | null>(null);
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

    loadFile(noteId)
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
    labelAutoRef.current = setupLabelAutoAssign(editor, labelStoreRef.current);
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

    const updatedDoc: ProvNoteDocument = {
      ...docRef.current,
      pages: [
        {
          ...docRef.current.pages[0],
          blocks: currentBlocks,
          labels: labelsObj,
        },
      ],
      modifiedAt: new Date().toISOString(),
    };

    setSaveStatus("saving");
    try {
      await saveFile(noteId, updatedDoc);
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

  return createPortal(
    <div
      ref={sidePeekRef}
      data-side-peek
      style={{
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
      }}
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
            <ProvIndicatorLayer />
            <BlockHoverHighlight wrapperEl={wrapperEl} zIndex={101} />
            <ProvIndicatorHoverHint wrapperEl={wrapperEl} zIndex={101} />
            <LabelDropdownPortal />
            <div style={{ padding: "16px 24px", paddingRight: 80 }}>
              <SandboxEditor
                key={noteId}
                initialContent={initialContent}
                sideMenu={SidePeekSideMenu}
                extraSlashMenuItems={[...buildLabelSlashMenuItems()]}
                onEditorReady={handleEditorReady}
                onChange={handleChange}
                onHashtagSelect={(blockId, label) => labelStoreRef.current.setLabel(blockId, label)}
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
    </div>,
    document.body
  );
}
