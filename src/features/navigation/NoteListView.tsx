// ノート一覧ビュー（メインエディタ領域に表示）
// 全ノートをテーブル形式で表示し、ソート・フィルタ・検索に対応

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProvNoteFile, ProvNoteDocument } from "../../lib/google-drive";
import { loadFile } from "../../lib/google-drive";
import {
  DriveDirectNoteListSource,
  type NoteListEntry,
} from "./note-list-source";
import { NoteListToolbar, type SortKey, type SortDirection } from "./NoteListToolbar";
import { formatRelativeTime } from "./recent-notes-store";

// ラベル表示名のマッピング
const LABEL_COLORS: Record<string, string> = {
  "[手順]": "bg-blue-100 text-blue-700",
  "[使用するもの]": "bg-amber-100 text-amber-700",
  "[結果]": "bg-emerald-100 text-emerald-700",
  "[属性]": "bg-purple-100 text-purple-700",
};

const LABEL_SHORT: Record<string, string> = {
  "[手順]": "手順",
  "[使用するもの]": "使用",
  "[結果]": "結果",
  "[属性]": "属性",
};

export function NoteListView({
  files,
  docCache,
  onOpenNote,
  onBack,
}: {
  files: ProvNoteFile[];
  docCache: Map<string, ProvNoteDocument>;
  onOpenNote: (noteId: string) => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<NoteListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("incomingLinkCount");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // 未キャッシュのノートをバックグラウンドで読み込んでから一覧構築
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // キャッシュにないファイルを読み込み
      const missing = files.filter((f) => !docCache.has(f.id));
      if (missing.length > 0) {
        await Promise.allSettled(
          missing.map(async (f) => {
            try {
              const doc = await loadFile(f.id);
              docCache.set(f.id, doc);
            } catch {
              // 読み込みエラーはスキップ
            }
          })
        );
      }
      if (cancelled) return;
      const source = new DriveDirectNoteListSource(files, docCache);
      const result = await source.loadNoteList();
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [files, docCache]);

  // ソート切り替え
  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      // 新しいキーの場合はデフォルト方向
      setSortDir(key === "title" ? "asc" : "desc");
      return key;
    });
  }, []);

  // フィルタ + ソート適用
  const filtered = useMemo(() => {
    let result = entries;

    // テキスト検索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.title.toLowerCase().includes(q));
    }

    // ラベルフィルタ（AND）
    if (labelFilter.length > 0) {
      result = result.filter((e) =>
        labelFilter.every((label) => e.labels.includes(label))
      );
    }

    // ソート
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "incomingLinkCount":
          cmp = a.incomingLinkCount - b.incomingLinkCount;
          break;
        case "modifiedAt":
          cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "title":
          cmp = a.title.localeCompare(b.title, "ja");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [entries, searchQuery, labelFilter, sortKey, sortDir]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; 戻る
        </button>
        <h1 className="text-base font-semibold text-foreground">ノート一覧</h1>
        <span className="text-xs text-muted-foreground">
          {loading ? "読み込み中..." : `${filtered.length} / ${entries.length} 件`}
        </span>
      </div>

      {/* ツールバー */}
      <NoteListToolbar
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* テーブル */}
      <div className="flex-1 overflow-auto px-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">ノートを読み込んでいます...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {entries.length === 0 ? "ノートがありません" : "一致するノートがありません"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">ノート</th>
                <th
                  className="py-2 px-3 font-medium w-[60px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("incomingLinkCount")}
                >
                  被参照{sortKey === "incomingLinkCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-3 font-medium w-[140px]">ラベル</th>
                <th
                  className="py-2 pl-3 font-medium w-[80px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  更新日{sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.noteId}
                  className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => onOpenNote(entry.noteId)}
                >
                  <td className="py-2 pr-3">
                    <span className="text-foreground hover:text-primary transition-colors">
                      {entry.title}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {entry.incomingLinkCount > 0 && (
                      <span
                        className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded ${
                          entry.incomingLinkCount >= 2
                            ? "bg-purple-100 text-purple-700 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        &larr; {entry.incomingLinkCount}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {entry.labels.map((label) => (
                        <span
                          key={label}
                          className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${
                            LABEL_COLORS[label] || "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {LABEL_SHORT[label] || label.replace(/[[\]]/g, "")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground">
                    {formatRelativeTime(entry.modifiedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
