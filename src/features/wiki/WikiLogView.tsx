// Wiki 操作ログビュー
// Ingest・Merge・Cross-Update・Lint 等のイベントを時系列で表示

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  FileSearch,
  GitMerge,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { useT } from "../../i18n";
import {
  MaintenanceRunList,
  runsHaveOperation,
  type MaintenanceListBinding,
} from "../knowledge-maintenance/MaintenanceRunList";
import { wikiLog, type WikiLogEntry, type WikiLogEventType } from "./wiki-log";

type Props = {
  onBack: () => void;
  onOpenWiki: (wikiId: string) => void;
  /** 保守の操作の一覧（上部の節）。渡さなければ節は出さない */
  maintenance?: MaintenanceListBinding;
};

const EVENT_ICONS: Record<WikiLogEventType, typeof History> = {
  ingest: BookOpen,
  merge: GitMerge,
  lint: Scissors,
  delete: Trash2,
  "cross-update": Zap,
  regenerate: RefreshCw,
  archive: Archive,
  "source-check": FileSearch,
  undo: Undo2,
  restore: RotateCcw,
};

const EVENT_COLORS: Record<WikiLogEventType, string> = {
  ingest: "text-blue-500",
  merge: "text-purple-500",
  lint: "text-amber-500",
  delete: "text-red-500",
  "cross-update": "text-orange-500",
  regenerate: "text-cyan-500",
  archive: "text-slate-500",
  "source-check": "text-teal-500",
  undo: "text-indigo-500",
  restore: "text-sky-500",
};

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WikiLogView({ onBack, onOpenWiki, maintenance }: Props) {
  const t = useT();
  const [entries, setEntries] = useState<WikiLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // 保守の操作の一覧は、この画面が出たときに読み始める（起動時には読まない）。
  // 読み込みを頼む前は節を出さない（見出しだけが一瞬出るのを避ける）
  const ensureMaintenanceLoaded = maintenance?.ensureLoaded;
  const [maintenanceRequested, setMaintenanceRequested] = useState(false);
  useEffect(() => {
    if (!ensureMaintenanceLoaded) return;
    ensureMaintenanceLoaded();
    setMaintenanceRequested(true);
  }, [ensureMaintenanceLoaded]);
  // 読み込み中だけを理由にした節は、まだ一度も読み終えていない間に限る（読み直しで見出しが一瞬出るのを避ける）
  const maintenanceLoading = maintenance?.loading ?? false;
  const [maintenanceLoadedOnce, setMaintenanceLoadedOnce] = useState(false);
  useEffect(() => {
    if (maintenanceRequested && !maintenanceLoading) setMaintenanceLoadedOnce(true);
  }, [maintenanceRequested, maintenanceLoading]);
  // 操作が 1 件も無く、読み込みも終わっているときは、節ごと出さない
  const showMaintenance =
    maintenance !== undefined &&
    maintenanceRequested &&
    ((maintenanceLoading && !maintenanceLoadedOnce) ||
      maintenance.hasMore ||
      maintenance.unreadableCount > 0 ||
      runsHaveOperation(maintenance.runs));

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const recent = await wikiLog.getRecent(100);
      setEntries(recent);
    } catch {
      // IndexedDB エラー時は空で表示
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // 日付ごとにグループ化
  const grouped = entries.reduce<Record<string, WikiLogEntry[]>>((acc, entry) => {
    const date = new Date(entry.timestamp).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(entry);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <History size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Activity Log</h2>
          <span className="text-xs text-muted-foreground">({entries.length})</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={loadEntries}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto">
        {/* 保守の操作（取り消せる操作の一覧）。既存のログの一覧の上に置く */}
        {showMaintenance && maintenance && (
          <section aria-label={t("maintenance.section.title")} className="border-b border-border">
            <div className="sticky top-0 bg-background/95 backdrop-blur px-4 py-1.5 border-b border-border">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {t("maintenance.section.title")}
              </span>
            </div>
            <p className="px-4 pt-2 text-xs text-muted-foreground leading-relaxed">
              {t("maintenance.section.hint")}
            </p>
            <div className="px-4 py-2">
              <MaintenanceRunList
                runs={maintenance.runs}
                states={maintenance.states}
                blockersOf={maintenance.blockersOf}
                onUndo={maintenance.onUndo}
                undoingKey={maintenance.undoingKey}
                loading={maintenance.loading}
                hasMore={maintenance.hasMore}
                onLoadMore={maintenance.onLoadMore}
                unreadableCount={maintenance.unreadableCount}
                onOpenPage={onOpenWiki}
              />
            </div>
          </section>
        )}
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <History size={24} className="opacity-30" />
            <span>No activity yet</span>
          </div>
        ) : (
          Object.entries(grouped).map(([date, dayEntries]) => (
            <div key={date}>
              <div className="sticky top-0 bg-background/95 backdrop-blur px-4 py-1.5 border-b border-border">
                <span className="text-[10px] font-semibold text-muted-foreground">{date}</span>
              </div>
              <div className="divide-y divide-border/50">
                {dayEntries.map((entry) => {
                  const Icon = EVENT_ICONS[entry.type] ?? History;
                  const color = EVENT_COLORS[entry.type] ?? "text-muted-foreground";
                  return (
                    <div key={entry.id} className="px-4 py-2.5 flex items-start gap-2.5">
                      <Icon size={14} className={`mt-0.5 shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {entry.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {formatTime(entry.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-foreground mt-0.5 leading-relaxed">
                          {entry.summary}
                        </p>
                        {entry.wikiIds.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {entry.wikiIds.map((id) => (
                              <button
                                key={id}
                                onClick={() => onOpenWiki(id)}
                                className="text-[10px] text-primary hover:underline"
                              >
                                {id.length > 16 ? `${id.slice(0, 12)}...` : id}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
