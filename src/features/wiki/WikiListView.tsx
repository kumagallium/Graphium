// Wiki リストビュー（メインエリアに表示）
// Summary / Concept カテゴリ別に Wiki ドキュメント一覧を表示
// wikiFiles + wikiMetas から直接描画（noteIndex に依存しない）

import { useMemo, useState } from "react";
import { ArrowLeft, Bot, Search, Trash2 } from "lucide-react";
import type { WikiKind } from "../../lib/document-types";
import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";

/** 日付を YYYY-MM-DD 形式でフォーマット */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type WikiMeta = {
  title: string;
  kind: WikiKind;
  headings: string[];
};

type Props = {
  noteIndex: GraphiumIndex | null;
  wikiKind: WikiKind;
  wikiFiles: GraphiumFile[];
  wikiMetas: Map<string, WikiMeta>;
  onOpenWiki: (wikiId: string) => void;
  onBack: () => void;
  onDeleteWiki: (wikiId: string) => Promise<void>;
};

export function WikiListView({
  wikiKind,
  wikiFiles,
  wikiMetas,
  onOpenWiki,
  onBack,
  onDeleteWiki,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // wikiFiles + wikiMetas からフィルタ
  const wikiEntries = useMemo(() => {
    return wikiFiles
      .filter((f) => {
        const meta = wikiMetas.get(f.id);
        return meta && meta.kind === wikiKind;
      })
      .map((f) => ({
        id: f.id,
        title: wikiMetas.get(f.id)!.title,
        modifiedAt: f.modifiedTime,
        headings: wikiMetas.get(f.id)!.headings,
      }))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  }, [wikiFiles, wikiMetas, wikiKind]);

  // 検索フィルタ
  const filtered = useMemo(() => {
    if (!searchQuery) return wikiEntries;
    const q = searchQuery.toLowerCase();
    return wikiEntries.filter((e) => e.title.toLowerCase().includes(q));
  }, [wikiEntries, searchQuery]);

  const handleDelete = async (e: React.MouseEvent, wikiId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(wikiId);
    try {
      await onDeleteWiki(wikiId);
    } finally {
      setDeletingId(null);
    }
  };

  const kindLabel = wikiKind === "summary" ? "Summary" : wikiKind === "synthesis" ? "Synthesis" : "Concept";

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
          <Bot size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">{kindLabel}</h2>
          <span className="text-xs text-muted-foreground">({filtered.length})</span>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="pl-7 pr-3 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
          />
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        {wikiMetas.size === 0 && wikiFiles.length > 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <Bot size={24} className="opacity-30" />
            <span>
              {searchQuery ? "No matching wikis found" : `No ${kindLabel} wikis yet`}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onOpenWiki(entry.id)}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <Bot size={14} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {entry.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(entry.modifiedAt)}
                      </span>
                      {entry.headings.length > 0 && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {entry.headings.join(" / ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, entry.id)}
                    disabled={deletingId === entry.id}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
