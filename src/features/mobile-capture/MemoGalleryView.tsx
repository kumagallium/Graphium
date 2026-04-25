// PC 向けメモギャラリービュー
// サイドバーの「メモ」クリックで表示。カード一覧 + メモ単体の詳細モーダル（ネットワーク図付き）

import { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote, Trash2, ClipboardCopy, Network, History } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";

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
  onNavigateNote,
  onEdit,
}: {
  entry: CaptureEntry;
  onClose: () => void;
  onDelete?: () => void;
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
  insertDisabled,
}: {
  entry: CaptureEntry;
  onOpenDetail: () => void;
  onInsert?: () => void;
  onDelete?: () => void;
  insertDisabled?: boolean;
}) {
  const t = useT();
  const usedCount = entry.usedIn?.length ?? 0;

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
}: {
  captureIndex: CaptureIndex | null;
  loading: boolean;
  onBack: () => void;
  onInsertMemo?: (captureId: string, text: string, deleteAfter: boolean) => void;
  onDeleteMemo?: (captureId: string) => void;
  onEditMemo?: (captureId: string, newText: string) => void;
  onNavigateNote?: (noteId: string) => void;
  insertDisabled?: boolean;
}) {
  const t = useT();
  const captures = captureIndex?.captures ?? [];
  const [pendingInsert, setPendingInsert] = useState<{ id: string; text: string } | null>(null);
  const [detailEntry, setDetailEntry] = useState<CaptureEntry | null>(null);

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
      </div>

      {/* 挿入先のヒント */}
      {insertDisabled && captures.length > 0 && (
        <div className="px-6 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs text-muted-foreground">{t("memo.insertHint")}</p>
        </div>
      )}

      {/* カード一覧 */}
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
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
            {captures.map((entry) => (
              <MemoCard
                key={entry.id}
                entry={entry}
                onOpenDetail={() => setDetailEntry(entry)}
                onInsert={onInsertMemo ? () => setPendingInsert({ id: entry.id, text: entry.text }) : undefined}
                onDelete={onDeleteMemo ? () => onDeleteMemo(entry.id) : undefined}
                insertDisabled={insertDisabled}
              />
            ))}
          </div>
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
          onNavigateNote={onNavigateNote}
          onEdit={onEditMemo ? (id, text) => { onEditMemo(id, text); setDetailEntry({ ...detailEntry, text }); } : undefined}
        />
      )}
    </div>
  );
}
