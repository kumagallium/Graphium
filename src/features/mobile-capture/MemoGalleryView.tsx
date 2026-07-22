// PC 向けメモギャラリービュー
// サイドバーの「メモ」クリックで表示。カード一覧 + メモ単体の詳細モーダル（ネットワーク図付き）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Trash2, Archive, Sparkles, ClipboardCopy, Network, History, Plus, LayoutGrid, List as ListIcon } from "lucide-react";
import { CaptureDialog } from "./CaptureDialog";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { getActiveCaptures, type CaptureIndex, type CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";
import { useRangeSelect } from "../../hooks/use-range-select";

/** 作成日を YYYY-MM-DD でフォーマット（リスト表示用） */
function formatCreatedDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ── 一括削除確認ダイアログ（メモ用、AssetGalleryView と同パターン） ──

function BulkDeleteConfirmDialog({
  count,
  refNoteCount,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  refNoteCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("memo.bulkDeleteConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {refNoteCount > 0
            ? t("memo.bulkDeleteConfirmMessage", {
                count: String(count),
                refCount: String(refNoteCount),
              })
            : t("memo.bulkDeleteConfirmMessageNoRef", { count: String(count) })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? t("asset.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// fcose レイアウト登録
ensureCytoscapePlugins();

// ── メモ詳細モーダル（MediaDetailModal と同じパターン） ──

const MEMO_NODE_COLOR = "#c08b3e";
const MEMO_BORDER = "#a67832";
const NOTE_NODE_COLOR = "#5b8fb9";
const NOTE_BORDER = "#4a7da6";
const EDGE_COLOR = "#b8d4bb";
const BG_COLOR = "#fafdf7";

const graphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "100px",
      "font-size": "10px",
      "font-family": "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "background-color": "data(color)",
      width: "data(size)",
      height: "data(size)",
      "border-width": 2,
      "border-color": "data(borderColor)",
      color: "#6b7f6e",
      "transition-property": "background-color, border-color, opacity, width, height" as any,
      "transition-duration": 200,
    },
  },
  {
    selector: "node.memo-node",
    style: {
      shape: "diamond",
      "font-weight": "bold" as any,
      "font-size": "11px",
    },
  },
  {
    selector: "node.note-node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": EDGE_COLOR,
      "target-arrow-color": EDGE_COLOR,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 30,
      "control-point-weights": 0.5,
      opacity: 0.7,
    },
  },
];

function MemoDetailModal({
  entry,
  onClose,
  onDelete,
  onArchive,
  onNavigateNote,
  onEdit,
}: {
  entry: CaptureEntry;
  onClose: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onNavigateNote?: (noteId: string) => void;
  onEdit?: (captureId: string, newText: string) => void;
}) {
  const t = useT();
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const hasUsages = (entry.usedIn?.length ?? 0) > 0;
  const hasHistory = (entry.editHistory?.length ?? 0) > 0;
  const hasRightPanel = hasUsages || hasHistory;
  const [rightTab, setRightTab] = useState<"network" | "history">(hasUsages ? "network" : "history");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(entry.text);

  const handleNavigate = useCallback(
    (noteId: string) => {
      onClose();
      onNavigateNote?.(noteId);
    },
    [onClose, onNavigateNote],
  );

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === entry.text || !onEdit) {
      setEditing(false);
      setEditText(entry.text);
      return;
    }
    onEdit(entry.id, trimmed);
    setEditing(false);
  }, [editText, entry, onEdit]);

  useEffect(() => {
    if (!graphRef.current || !hasUsages) return;

    const elements: cytoscape.ElementDefinition[] = [];
    const memoLabel = entry.text.length > 20 ? entry.text.slice(0, 18) + "…" : entry.text;

    // 中心: メモノード
    elements.push({
      data: {
        id: entry.id,
        label: memoLabel,
        color: MEMO_NODE_COLOR,
        borderColor: MEMO_BORDER,
        size: 44,
      },
      classes: "memo-node",
    });

    // ノートノード
    const seen = new Set<string>();
    for (const usage of entry.usedIn!) {
      if (seen.has(usage.noteId)) continue;
      seen.add(usage.noteId);
      const noteLabel = usage.noteTitle.length > 18 ? usage.noteTitle.slice(0, 16) + "…" : usage.noteTitle;
      elements.push({
        data: {
          id: usage.noteId,
          label: noteLabel,
          color: NOTE_NODE_COLOR,
          borderColor: NOTE_BORDER,
          size: 32,
        },
        classes: "note-node",
      });
      elements.push({
        data: {
          id: `${entry.id}->${usage.noteId}`,
          source: entry.id,
          target: usage.noteId,
        },
      });
    }

    if (cyRef.current) cyRef.current.destroy();

    const cy = cytoscape({
      container: graphRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.3,
      maxZoom: 3,
    });

    const layout = cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 600,
      animationEasing: "ease-out-cubic" as any,
      quality: "default",
      randomize: true,
      nodeRepulsion: 5000,
      idealEdgeLength: 100,
      edgeElasticity: 0.45,
      gravity: 0.3,
      nodeSeparation: 60,
      padding: 30,
    } as any);
    layout.on("layoutstop", () => cy.fit(undefined, 20));
    layout.run();

    cy.on("mouseover", "node.note-node", (evt) => {
      evt.target.addClass("hover");
      graphRef.current!.style.cursor = "pointer";
    });
    cy.on("mouseout", "node.note-node", () => {
      cy.nodes().removeClass("hover");
      graphRef.current!.style.cursor = "default";
    });

    // ノートノードクリックでナビゲーション
    cy.on("tap", "node.note-node", (evt) => {
      handleNavigate(evt.target.id());
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [entry, hasUsages, handleNavigate]);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90vw] max-w-4xl h-[60vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">
              {t("memo.title")}
            </h2>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t("memo.created")}: {formatRelativeTime(entry.createdAt)}
            </span>
            {entry.modifiedAt && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {t("memo.modified")}: {formatRelativeTime(entry.modifiedAt)}
              </span>
            )}
            {hasUsages && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {t("memo.usedCount", { count: String(entry.usedIn!.length) })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onArchive && (
              <button
                onClick={() => { onArchive(); onClose(); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Archive size={13} />
                {t("memo.archive")}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                {t("common.delete")}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* コンテンツ: 左 メモ本文 / 右 グラフ */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左: メモ本文 */}
          <div className={`flex flex-col p-6 bg-muted/30 overflow-auto ${hasRightPanel ? "w-1/2 border-r border-border" : "w-full"}`}>
            {editing ? (
              <div className="flex-1 flex flex-col gap-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  className="flex-1 w-full resize-none bg-background border border-border rounded-md p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setEditing(false); setEditText(entry.text); }}
                    className="px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
            ) : (
              <p
                className={`text-sm text-foreground whitespace-pre-wrap ${onEdit ? "cursor-pointer hover:bg-muted/50 rounded p-2 -m-2 transition-colors" : ""}`}
                onClick={() => { if (onEdit) setEditing(true); }}
                title={onEdit ? t("memo.clickToEdit") : undefined}
              >
                {entry.text}
              </p>
            )}
            {!editing && (entry.knowledgedInto?.length ?? 0) > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">
                  <Sparkles size={12} />
                  {t("memo.knowledgedInto")}
                </div>
                <div className="flex flex-col gap-1">
                  {entry.knowledgedInto!.map((k) => (
                    <button
                      key={k.noteId}
                      onClick={() => handleNavigate(k.noteId)}
                      className="text-left text-xs text-foreground hover:text-primary hover:underline truncate transition-colors"
                      title={k.noteTitle}
                    >
                      → {k.noteTitle}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右: タブ切り替え（ネットワーク / 履歴） */}
          {hasRightPanel && (
            <div className="w-1/2 flex flex-col">
              {/* タブヘッダー */}
              <div className="flex items-center border-b border-border">
                {hasUsages && (
                  <button
                    onClick={() => setRightTab("network")}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                      rightTab === "network"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Network size={13} />
                    {t("memo.tabNetwork")}
                  </button>
                )}
                {hasHistory && (
                  <button
                    onClick={() => setRightTab("history")}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                      rightTab === "history"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <History size={13} />
                    {t("memo.tabHistory")}
                  </button>
                )}
              </div>

              {/* タブコンテンツ: ネットワーク */}
              {rightTab === "network" && hasUsages && (
                <>
                  <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: MEMO_NODE_COLOR, transform: "rotate(45deg)" }}
                      />
                      {t("memo.title")}
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: NOTE_NODE_COLOR }}
                      />
                      {t("nav.noteColumn")}
                    </span>
                    <span className="ml-auto">{t("asset.clickToNavigate")}</span>
                  </div>
                  <div ref={graphRef} className="flex-1" style={{ background: BG_COLOR }} />
                </>
              )}

              {/* タブコンテンツ: 編集履歴 */}
              {rightTab === "history" && hasHistory && (
                <div className="flex-1 overflow-auto p-4">
                  <div className="space-y-3">
                    {[...entry.editHistory!].reverse().map((record, i, arr) => {
                      // 次の（時系列で前の）テキストと比較して差分を表示
                      const nextText = i < arr.length - 1 ? arr[i + 1].previousText : entry.text;
                      return (
                        <div key={i} className="border-l-2 border-border pl-3 py-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {formatRelativeTime(record.editedAt)}
                            </span>
                            <span className="text-[10px] text-blue-600/70 dark:text-blue-400/70">
                              ~{t("history.type.edit")}
                            </span>
                          </div>
                          <div className="text-[11px] space-y-0.5">
                            <div className="text-red-600/70 dark:text-red-400/70 line-through whitespace-pre-wrap line-clamp-3">
                              {record.previousText}
                            </div>
                            <div className="text-foreground/70 whitespace-pre-wrap line-clamp-3">
                              {nextText}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── メモカード ──

function MemoCard({
  entry,
  onOpenDetail,
  onInsert,
  onDelete,
  onArchive,
  insertDisabled,
}: {
  entry: CaptureEntry;
  onOpenDetail: () => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  insertDisabled?: boolean;
}) {
  const t = useT();
  const usedCount = entry.usedIn?.length ?? 0;
  const knowledgedCount = entry.knowledgedInto?.length ?? 0;

  return (
    <div
      className="bg-card border border-border rounded-lg p-4 group hover:border-primary/30 transition-colors cursor-pointer"
      onClick={onOpenDetail}
    >
      <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4 mb-2">
        {entry.text}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(entry.createdAt)}
          </span>
          {usedCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              {t("memo.usedCount", { count: String(usedCount) })}
            </span>
          )}
          {knowledgedCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
              title={t("memo.knowledgedHint")}
            >
              <Sparkles size={10} />
              {t("memo.knowledgedBadge")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onInsert && (
            <button
              onClick={(e) => { e.stopPropagation(); onInsert(); }}
              disabled={insertDisabled}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              title={t("memo.insert")}
            >
              <ClipboardCopy size={14} />
            </button>
          )}
          {onArchive && (
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title={t("memo.archive")}
            >
              <Archive size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 挿入確認ダイアログ ──

function InsertConfirmDialog({
  onInsertAndKeep,
  onInsertAndDelete,
  onCancel,
}: {
  onInsertAndKeep: () => void;
  onInsertAndDelete: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("memo.insertConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("memo.insertConfirmMessage")}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onInsertAndKeep}
            className="w-full px-3 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("memo.insertAndKeep")}
          </button>
          <button
            onClick={onInsertAndDelete}
            className="w-full px-3 py-2 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("memo.insertAndDelete")}
          </button>
          <button
            onClick={onCancel}
            className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインコンポーネント ──

export function MemoGalleryView({
  captureIndex,
  loading,
  onBack,
  onInsertMemo,
  onDeleteMemo,
  onEditMemo,
  onNavigateNote,
  insertDisabled,
  onCreateMemo,
  creating,
  onKnowledgeMemos,
  onArchiveMemo,
}: {
  captureIndex: CaptureIndex | null;
  loading: boolean;
  onBack: () => void;
  onInsertMemo?: (captureId: string, text: string, deleteAfter: boolean) => void;
  onDeleteMemo?: (captureId: string) => void;
  onEditMemo?: (captureId: string, newText: string) => void;
  onNavigateNote?: (noteId: string) => void;
  insertDisabled?: boolean;
  /** 新規メモ作成（PC からの直接入力） */
  onCreateMemo?: (text: string) => Promise<void>;
  creating?: boolean;
  /**
   * 選択メモを Knowledge 化する（list モードの一括バーから呼ぶ）。
   * 各メモを 1 ノートに変換して ingest パイプラインに流す（呼び出し側で配線）。
   * AI 未接続時は undefined を渡してボタンを隠す。
   */
  onKnowledgeMemos?: (captureIds: string[]) => void;
  /** メモをアーカイブする（gallery / list / 詳細 / 一括バーから呼ぶ） */
  onArchiveMemo?: (captureId: string) => void;
}) {
  const t = useT();
  // アーカイブ・ゴミ箱を除いた active なメモのみ一覧に表示する
  const captures = useMemo(() => (captureIndex ? getActiveCaptures(captureIndex) : []), [captureIndex]);
  const [pendingInsert, setPendingInsert] = useState<{ id: string; text: string } | null>(null);
  const [detailEntry, setDetailEntry] = useState<CaptureEntry | null>(null);
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);

  // ビュー切替（gallery / list）— localStorage に永続化（AssetGalleryView と同パターン）
  const [viewMode, setViewMode] = useState<"gallery" | "list">(() => {
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem("graphium:memoViewMode") : null;
      return v === "list" ? "list" : "gallery";
    } catch {
      return "gallery";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("graphium:memoViewMode", viewMode);
    } catch {
      // no-op
    }
  }, [viewMode]);

  // 複数選択（list モードのみで利用）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ビューモード切替時に選択をクリア
  useEffect(() => {
    setSelectedIds(new Set());
  }, [viewMode]);

  // captures が変わったら、もう存在しない id を選択から除外（個別削除との整合）
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set<string>();
      const liveIds = new Set(captures.map((c) => c.id));
      for (const id of prev) if (liveIds.has(id)) valid.add(id);
      return valid.size === prev.size ? prev : valid;
    });
  }, [captures]);

  // captures の順序付き ID（範囲選択用）
  const orderedIds = useMemo(() => captures.map((e) => e.id), [captures]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);
  const allSelected = captures.length > 0 && captures.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;
  const toggleSelectAll = useCallback(() => {
    const ids = captures.map((e) => e.id);
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  }, [captures, selectedIds]);

  // 選択中のメモが挿入されているノート数（重複除外）
  const selectedRefNoteCount = useMemo(() => {
    const noteIds = new Set<string>();
    for (const e of captures) {
      if (!selectedIds.has(e.id)) continue;
      for (const u of e.usedIn ?? []) noteIds.add(u.noteId);
    }
    return noteIds.size;
  }, [captures, selectedIds]);

  const handleCreateSubmit = useCallback(
    async (text: string) => {
      if (!onCreateMemo) return;
      await onCreateMemo(text);
      setShowCaptureDialog(false);
    },
    [onCreateMemo]
  );

  const handleInsertAndKeep = useCallback(() => {
    if (!pendingInsert || !onInsertMemo) return;
    onInsertMemo(pendingInsert.id, pendingInsert.text, false);
    setPendingInsert(null);
  }, [pendingInsert, onInsertMemo]);

  const handleInsertAndDelete = useCallback(() => {
    if (!pendingInsert || !onInsertMemo) return;
    onInsertMemo(pendingInsert.id, pendingInsert.text, true);
    setPendingInsert(null);
  }, [pendingInsert, onInsertMemo]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (!onDeleteMemo || selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      // 順次削除（並列だと captureIndex の race が起きうる）
      for (const id of selectedIds) {
        await onDeleteMemo(id);
      }
      setSelectedIds(new Set());
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  }, [selectedIds, onDeleteMemo]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.back")}
        </button>
        <h1 className="text-base font-semibold text-foreground">{t("memo.title")}</h1>
        <span className="text-xs text-muted-foreground">
          {loading ? t("common.loading") : t("memo.count", { count: String(captures.length) })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* ビュー切替 */}
          <div className="inline-flex rounded border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("gallery")}
              title={t("memo.viewGallery")}
              aria-pressed={viewMode === "gallery"}
              className={`px-2 py-1 transition-colors ${
                viewMode === "gallery"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid size={12} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              title={t("memo.viewList")}
              aria-pressed={viewMode === "list"}
              className={`px-2 py-1 transition-colors border-l border-border ${
                viewMode === "list"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListIcon size={12} />
            </button>
          </div>
          {onCreateMemo && (
            <button
              onClick={() => setShowCaptureDialog(true)}
              disabled={creating}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <Plus size={12} />
              {t("memo.new")}
            </button>
          )}
        </div>
      </div>

      {/* 挿入先のヒント */}
      {insertDisabled && captures.length > 0 && (
        <div className="px-6 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs text-muted-foreground">{t("memo.insertHint")}</p>
        </div>
      )}

      {/* 一括アクションバー（list モードで選択時のみ） */}
      {viewMode === "list" && someSelected && (
        <div className="px-6 py-2 border-b border-border bg-primary/5 flex items-center gap-3">
          <span className="text-xs text-foreground font-medium">
            {selectedIds.size} / {captures.length}
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("memo.deselectAll")}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {onKnowledgeMemos && (
              <button
                onClick={() => {
                  onKnowledgeMemos([...selectedIds]);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                title={t("memo.knowledgeHint")}
              >
                {t("memo.knowledgeSelected", { count: String(selectedIds.size) })}
              </button>
            )}
            {onArchiveMemo && (
              <button
                onClick={() => {
                  for (const id of selectedIds) onArchiveMemo(id);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded border border-border text-foreground hover:bg-muted transition-colors"
              >
                {t("memo.archiveSelected", { count: String(selectedIds.size) })}
              </button>
            )}
            {onDeleteMemo && (
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                {t("memo.deleteSelected", { count: String(selectedIds.size) })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 一覧（gallery or list） */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : captures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("memo.emptyDesktop")}</p>
          </div>
        ) : viewMode === "gallery" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {captures.map((entry) => (
              <MemoCard
                key={entry.id}
                entry={entry}
                onOpenDetail={() => setDetailEntry(entry)}
                onInsert={onInsertMemo ? () => setPendingInsert({ id: entry.id, text: entry.text }) : undefined}
                onDelete={onDeleteMemo ? () => onDeleteMemo(entry.id) : undefined}
                onArchive={onArchiveMemo ? () => onArchiveMemo(entry.id) : undefined}
                insertDisabled={insertDisabled}
              />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-2 w-[36px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    title={allSelected ? t("memo.deselectAll") : t("memo.selectAll")}
                  />
                </th>
                <th className="py-2 px-3">{t("memo.colText")}</th>
                <th className="py-2 px-2 w-[60px] text-center" title={t("memo.colUsedIn")}>
                  {t("memo.colUsedIn")}
                </th>
                <th className="py-2 pl-3 w-[110px]">{t("memo.colDate")}</th>
                <th className="py-2 px-2 w-[72px]" />
              </tr>
            </thead>
            <tbody>
              {captures.map((entry, index) => {
                const isSelected = selectedIds.has(entry.id);
                const usedCount = entry.usedIn?.length ?? 0;
                return (
                  <tr
                    key={entry.id}
                    className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                    onMouseDown={(e) => range.onRowMouseDown(e, index)}
                    onMouseEnter={() => range.onRowMouseEnter(index)}
                    onClick={() => {
                      if (range.shouldSuppressClick()) return;
                      setDetailEntry(entry);
                    }}
                  >
                    <td
                      className="py-2 px-2 cursor-pointer"
                      title={t("memo.dragToRangeSelect")}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => range.onCheckboxMouseDown(e, index)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                        className="w-3.5 h-3.5 rounded border-border accent-primary pointer-events-none"
                      />
                    </td>
                    <td className="py-2 px-3 min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {(entry.knowledgedInto?.length ?? 0) > 0 && (
                          <Sparkles
                            size={12}
                            className="shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-label={t("memo.knowledgedBadge")}
                          />
                        )}
                        <span className="text-foreground line-clamp-1 whitespace-pre-wrap break-all" title={entry.text}>
                          {entry.text}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-xs text-muted-foreground tabular-nums">
                      {usedCount > 0 ? usedCount : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                      {formatCreatedDate(entry.createdAt)}
                    </td>
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onArchiveMemo && (
                          <button
                            onClick={() => onArchiveMemo(entry.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-1"
                            title={t("memo.archive")}
                          >
                            <Archive size={13} />
                          </button>
                        )}
                        {onDeleteMemo && (
                          <button
                            onClick={() => onDeleteMemo(entry.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs p-1"
                            title={t("common.delete")}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 挿入確認ダイアログ */}
      {pendingInsert && (
        <InsertConfirmDialog
          onInsertAndKeep={handleInsertAndKeep}
          onInsertAndDelete={handleInsertAndDelete}
          onCancel={() => setPendingInsert(null)}
        />
      )}

      {/* メモ詳細モーダル */}
      {detailEntry && (
        <MemoDetailModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onDelete={onDeleteMemo ? () => { onDeleteMemo(detailEntry.id); setDetailEntry(null); } : undefined}
          onArchive={onArchiveMemo ? () => { onArchiveMemo(detailEntry.id); setDetailEntry(null); } : undefined}
          onNavigateNote={onNavigateNote}
          onEdit={onEditMemo ? (id, text) => { onEditMemo(id, text); setDetailEntry({ ...detailEntry, text }); } : undefined}
        />
      )}

      {/* 新規作成ダイアログ（デスクトップギャラリーは中央寄せの軽量モーダル） */}
      {showCaptureDialog && onCreateMemo && (
        <CaptureDialog
          variant="centered"
          onSubmit={handleCreateSubmit}
          onClose={() => setShowCaptureDialog(false)}
          submitting={creating ?? false}
        />
      )}

      {/* 一括削除確認ダイアログ */}
      {bulkDeleteOpen && (
        <BulkDeleteConfirmDialog
          count={selectedIds.size}
          refNoteCount={selectedRefNoteCount}
          onConfirm={handleBulkDeleteConfirm}
          onCancel={() => setBulkDeleteOpen(false)}
          deleting={bulkDeleting}
        />
      )}
    </div>
  );
}
