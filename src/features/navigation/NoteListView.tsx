// ノート一覧ビュー（メインエディタ領域に表示）
// 全ノートをテーブル形式で表示し、ソート・フィルタ・検索に対応

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IndexFileNoteListSource,
  type NoteListEntry,
} from "./note-list-source";
import type { ProvNoteIndex } from "./index-file";
import { NoteListToolbar, type SortKey, type SortDirection } from "./NoteListToolbar";
import { formatRelativeTime } from "./recent-notes-store";

// ラベル色マッピング（design.md PROV-DM ラベル色準拠）
// ノート内の SideMenu バッジと同じゴーストスタイル: 薄い背景 + ラベル色テキスト + 薄いボーダー
const LABEL_HEX: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[結果]": "#c26356",
  "[属性]": "#c08b3e",
  "[パターン]": "#8b7ab5",
  "[試料]": "#8b7ab5",
  "[条件]": "#c08b3e",
};

// 表示名（「使用するもの」に統一）
const LABEL_SHORT: Record<string, string> = {
  "[手順]": "手順",
  "[使用したもの]": "使用するもの",
  "[結果]": "結果",
  "[属性]": "属性",
  "[パターン]": "パターン",
  "[試料]": "試料",
  "[条件]": "属性",
};

export function NoteListView({
  noteIndex,
  onOpenNote,
  onBack,
}: {
  noteIndex: ProvNoteIndex | null;
  onOpenNote: (noteId: string) => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<NoteListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("outgoingLinkCount");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // インデックスからノート一覧を構築
  useEffect(() => {
    if (!noteIndex) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const source = new IndexFileNoteListSource(noteIndex);
      const result = await source.loadNoteList();
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [noteIndex]);

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
        case "outgoingLinkCount":
          cmp = a.outgoingLinkCount - b.outgoingLinkCount;
          break;
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
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-3">ノート</th>
                <th
                  className="py-2 px-2 w-[56px] cursor-pointer hover:text-foreground text-center"
                  onClick={() => handleSort("outgoingLinkCount")}
                  title="参照先（このノートが参照しているノート数）"
                >
                  参照先{sortKey === "outgoingLinkCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 px-2 w-[56px] cursor-pointer hover:text-foreground text-center"
                  onClick={() => handleSort("incomingLinkCount")}
                  title="被参照（他ノートから参照されている数）"
                >
                  被参照{sortKey === "incomingLinkCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-3 w-[140px]">ラベル</th>
                <th
                  className="py-2 pl-3 w-[80px] cursor-pointer hover:text-foreground"
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
                  <td className="py-2 px-3">
                    <span className="text-foreground hover:text-primary transition-colors">
                      {entry.title}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    {entry.outgoingLinkCount > 0 && (
                      <span
                        className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${
                          entry.outgoingLinkCount >= 3
                            ? "bg-info-bg text-info font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {entry.outgoingLinkCount} &rarr;
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {entry.incomingLinkCount > 0 && (
                      <span
                        className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${
                          entry.incomingLinkCount >= 2
                            ? "bg-label-sample-bg text-label-sample font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        &larr; {entry.incomingLinkCount}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {entry.labels.map((label) => {
                        const color = LABEL_HEX[label] ?? "#8fa394";
                        return (
                          <span
                            key={label}
                            className="inline-block text-xs font-semibold rounded-full whitespace-nowrap"
                            style={{
                              padding: "0px 6px",
                              backgroundColor: color + "18",
                              color,
                              border: `1px solid ${color}38`,
                              lineHeight: 1.6,
                            }}
                          >
                            {LABEL_SHORT[label] || label.replace(/[[\]]/g, "")}
                          </span>
                        );
                      })}
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
