// Wiki 操作ログビュー
// Ingest・Merge・Cross-Update・Lint 等のイベントを時系列で表示

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  GitMerge,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Check,
  Zap,
} from "lucide-react";
import { wikiLog, type WikiLogEntry, type WikiLogEventType } from "./wiki-log";

type Props = {
  onBack: () => void;
  onOpenWiki: (wikiId: string) => void;
};

const EVENT_ICONS: Record<WikiLogEventType, typeof History> = {
  ingest: BookOpen,
  merge: GitMerge,
  lint: ShieldCheck,
  approve: Check,
  delete: Trash2,
  "cross-update": Zap,
  regenerate: RefreshCw,
};

const EVENT_COLORS: Record<WikiLogEventType, string> = {
  ingest: "text-blue-500",
  merge: "text-purple-500",
  lint: "text-amber-500",
  approve: "text-emerald-500",
  delete: "text-red-500",
  "cross-update": "text-orange-500",
  regenerate: "text-cyan-500",
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

export function WikiLogView({ onBack, onOpenWiki }: Props) {
  const [entries, setEntries] = useState<WikiLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

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
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">{date}</span>
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
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
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
