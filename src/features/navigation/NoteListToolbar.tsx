// ノート一覧のツールバー（ソート・ラベルフィルタ・テキスト検索）

import { useCallback, useRef, useState } from "react";

export type SortKey = "outgoingLinkCount" | "incomingLinkCount" | "modifiedAt" | "createdAt" | "title";
export type SortDirection = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "outgoingLinkCount", label: "参照先" },
  { key: "incomingLinkCount", label: "被参照" },
  { key: "modifiedAt", label: "更新日" },
  { key: "createdAt", label: "作成日" },
  { key: "title", label: "タイトル" },
];

// データに保存された内部ラベル名でフィルタリング
const CORE_LABELS = ["[手順]", "[使用したもの]", "[結果]", "[属性]"];
// 表示名（「使用するもの」に統一）
const LABEL_SHORT: Record<string, string> = {
  "[手順]": "手順",
  "[使用したもの]": "使用するもの",
  "[結果]": "結果",
  "[属性]": "属性",
};

export function NoteListToolbar({
  sortKey,
  sortDir,
  onSort,
  labelFilter,
  onLabelFilterChange,
  searchQuery,
  onSearchChange,
}: {
  sortKey: SortKey;
  sortDir: SortDirection;
  onSort: (key: SortKey) => void;
  labelFilter: string[];
  onLabelFilterChange: (labels: string[]) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showLabelMenu, setShowLabelMenu] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const toggleLabel = useCallback(
    (label: string) => {
      if (labelFilter.includes(label)) {
        onLabelFilterChange(labelFilter.filter((l) => l !== label));
      } else {
        onLabelFilterChange([...labelFilter, label]);
      }
    },
    [labelFilter, onLabelFilterChange]
  );

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50">
      {/* ソートドロップダウン */}
      <div className="relative" ref={sortRef}>
        <button
          onClick={() => { setShowSortMenu(!showSortMenu); setShowLabelMenu(false); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          {SORT_OPTIONS.find((o) => o.key === sortKey)?.label}
          {sortDir === "desc" ? " ↓" : " ↑"}
        </button>
        {showSortMenu && (
          <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-md py-1 z-10 min-w-[120px]">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  onSort(opt.key);
                  setShowSortMenu(false);
                }}
                className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors ${
                  sortKey === opt.key ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                {opt.label}
                {sortKey === opt.key && (sortDir === "desc" ? " ↓" : " ↑")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ラベルフィルタドロップダウン */}
      <div className="relative" ref={labelRef}>
        <button
          onClick={() => { setShowLabelMenu(!showLabelMenu); setShowSortMenu(false); }}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-muted transition-colors ${
            labelFilter.length > 0 ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          ラベル{labelFilter.length > 0 ? ` (${labelFilter.length})` : ""} &#9662;
        </button>
        {showLabelMenu && (
          <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-md py-1 z-10 min-w-[140px]">
            {CORE_LABELS.map((label) => (
              <button
                key={label}
                onClick={() => toggleLabel(label)}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2"
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] ${
                  labelFilter.includes(label)
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border"
                }`}>
                  {labelFilter.includes(label) && "✓"}
                </span>
                <span className="text-foreground">{LABEL_SHORT[label] || label}</span>
              </button>
            ))}
            {labelFilter.length > 0 && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => { onLabelFilterChange([]); setShowLabelMenu(false); }}
                  className="w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  フィルタをクリア
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* テキスト検索 */}
      <div className="flex-1" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="検索..."
        className="text-xs px-2.5 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 w-48 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
    </div>
  );
}
