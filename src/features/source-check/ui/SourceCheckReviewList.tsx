// 出典照合（Source check, v1.1）の「要確認」一覧。
//
// AI の判定で知見を一覧から自動的に隠さない方針（FAQ「隠れフィルターは無い」の約束）の裏返しとして、
// 「要確認」は一覧を隠すのではなく、手入れ画面の「出典照合」タブに常設の別リストとして目立たせる。
// 対象・並びの判定は needs-review.ts（純関数）に集約し、この部品は表示と操作だけを持つ。
//
// 見た目は WikiLintView の「点検」タブの issue リスト（divide-y の行 + チェックボックス一括
// アーカイブ）と揃える。stale（本文変更）は一覧向けミラーだけでは判定できないため出さない
// （仕様の明示的な決定: 一覧で本文を読まずに判定できないなら出さない）。

import { useMemo, useState } from "react";
import { useRangeSelect } from "../../../hooks/use-range-select";
import { Archive as ArchiveIcon, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { SourceCheckVerdict } from "../../../lib/document-types";
import { sourceCheckVerdictPalette } from "./SourceCheckBadge";
import { useT } from "../../../i18n";
import type { NeedsReviewEntry } from "../needs-review";

export type SourceCheckReviewListProps = {
  items: NeedsReviewEntry[];
  /** 開く（既存の wiki を開く導線） */
  onOpen: (id: string) => void;
  /** 確認した（useSourceCheck.dismiss）。成功すると一覧から消える */
  onDismiss: (id: string) => Promise<void> | void;
  /** アーカイブ（既存の可逆アーカイブ導線）。成功すると一覧から消える */
  onArchive: (id: string) => Promise<void> | void;
  /** まとめてアーカイブ */
  onBulkArchive: (ids: string[]) => Promise<void> | void;
  /** もう一度照合（useSourceCheck.runOne） */
  onRecheck: (id: string) => Promise<void> | void;
  /** 実行中の docId（useSourceCheck.runningDocId）。もう一度照合ボタンの無効化に使う */
  runningId?: string | null;
  /**
   * 一括実行が進行中か（useSourceCheck.batchRunning）。runOne / runLintPlan は同じ
   * runningRef を共有し、実行中に個別の「もう一度照合」を押しても黙って無視されるため、
   * バッチ実行中は全行の「もう一度照合」を無効化する。
   */
  batchRunning?: boolean;
};

function verdictBadge(t: ReturnType<typeof useT>, verdict: SourceCheckVerdict) {
  const p = sourceCheckVerdictPalette[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border shrink-0"
      style={{ color: p.color, background: p.bg, borderColor: p.border }}
    >
      {t(`sourceCheck.verdict.${verdict}` as never)}
    </span>
  );
}

export function SourceCheckReviewList({
  items,
  onOpen,
  onDismiss,
  onArchive,
  onBulkArchive,
  onRecheck,
  runningId,
  batchRunning = false,
}: SourceCheckReviewListProps) {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiving, setBulkArchiving] = useState(false);
  // 行ごとの実行中アクション（同じ行に別アクションが同時に走らないように）
  const [pendingById, setPendingById] = useState<Record<string, "dismiss" | "archive" | "recheck" | null>>({});
  // ドラッグ / Shift+クリックの範囲選択（ノート一覧・ナレッジ一覧と同じ共通フック）。
  // フックは早期 return より前に呼ぶ（Hooks の呼び出し順を変えない）。
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);

  if (items.length === 0) return null;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0 || bulkArchiving) return;
    if (!window.confirm(t("wikiLint.sourceCheck.review.confirmBulkArchive", { count: String(selectedIds.size) }))) {
      return;
    }
    setBulkArchiving(true);
    try {
      await onBulkArchive([...selectedIds]);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Bulk archive (source check review) failed:", err);
    } finally {
      setBulkArchiving(false);
    }
  };

  const runRowAction = async (id: string, action: "dismiss" | "archive" | "recheck") => {
    if (pendingById[id]) return;
    if (action === "archive") {
      const titleHint = items.find((i) => i.id === id)?.title ?? id.slice(0, 12);
      if (!window.confirm(t("wikiLint.action.confirmArchive", { title: titleHint }))) return;
    }
    setPendingById((p) => ({ ...p, [id]: action }));
    try {
      if (action === "dismiss") await onDismiss(id);
      else if (action === "archive") await onArchive(id);
      else await onRecheck(id);
    } catch (err) {
      console.error("Source check review row action failed:", err);
    } finally {
      setPendingById((p) => ({ ...p, [id]: null }));
    }
  };

  return (
    <div className="w-full text-left">
      <div className="px-4 py-3 border-b border-t border-border flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          {t("wikiLint.sourceCheck.review.header", { count: String(items.length) })}
        </span>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-muted-foreground">
              {t("wikiLint.bulk.selected", { count: String(selectedIds.size) })}
            </span>
            <button
              onClick={handleBulkArchive}
              disabled={bulkArchiving}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-muted text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50"
            >
              {bulkArchiving ? <Loader2 size={12} className="animate-spin" /> : <ArchiveIcon size={12} />}
              {t("wikiLint.sourceCheck.review.bulkArchiveButton", { count: String(selectedIds.size) })}
            </button>
          </div>
        )}
      </div>
      <div className="divide-y divide-border">
        {items.map((item, idx) => {
          const pending = pendingById[item.id];
          const recheckDisabled = Boolean(pending) || batchRunning || runningId === item.id;
          return (
            <div
              key={item.id}
              className={`px-4 py-3 flex items-center gap-2 flex-wrap ${selectedIds.has(item.id) ? "bg-primary/5" : ""}`}
              onMouseDown={(e) => range.onRowMouseDown(e, idx)}
              onMouseEnter={() => range.onRowMouseEnter(idx)}
            >
              <span
                className="shrink-0 cursor-pointer"
                title={t("wikiList.dragToRangeSelect")}
                onMouseDown={(e) => range.onCheckboxMouseDown(e, idx)}
              >
                {/* マウスはフックが mousedown で扱う（pointer-events-none）。キーボードは onChange で切り替える */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                  aria-label={t("wikiLint.bulk.select")}
                  className="pointer-events-none"
                />
              </span>
              {verdictBadge(t, item.verdict)}
              <span
                className="text-sm font-medium text-foreground flex-1 min-w-0 truncate"
                title={item.title}
              >
                {item.title}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {item.kind === "claim" ? t("wikiList.kindClaim") : t("wikiList.kindTopic")}
              </span>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onOpen(item.id)}
                  disabled={Boolean(pending)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <ExternalLink size={12} />
                  {t("wikiLint.action.open")}
                </button>
                <button
                  onClick={() => runRowAction(item.id, "dismiss")}
                  disabled={Boolean(pending)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {pending === "dismiss" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {t("sourceCheck.dismiss")}
                </button>
                <button
                  onClick={() => runRowAction(item.id, "archive")}
                  disabled={Boolean(pending)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {pending === "archive" ? <Loader2 size={12} className="animate-spin" /> : <ArchiveIcon size={12} />}
                  {t("wikiLint.action.archive")}
                </button>
                <button
                  onClick={() => runRowAction(item.id, "recheck")}
                  disabled={recheckDisabled}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-primary/50 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {pending === "recheck" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {t("sourceCheck.recheck")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
