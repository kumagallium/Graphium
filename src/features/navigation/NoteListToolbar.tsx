// ノート一覧のツールバー（ソート・テキスト検索）
// 2026-05-22: ラベルフィルタは列ヘッダ filter popup に移行したため、ここからは外した。
// 単一情報源（列ヘッダ）を維持するため、ツールバー側にラベル選択を残さない。

import { useRef, useState } from "react";
import { useT } from "../../i18n";

export type SortKey =
  | "outgoingLinkCount"
  | "incomingLinkCount"
  | "modifiedAt"
  | "createdAt"
  | "title"
  | "labels"
  | "noteContexts"
  | "knowledgeCount"
  | "author";
export type SortDirection = "asc" | "desc";

const SORT_KEYS: { key: SortKey; labelKey: string }[] = [
  { key: "outgoingLinkCount", labelKey: "nav.outgoing" },
  { key: "incomingLinkCount", labelKey: "nav.incoming" },
  { key: "modifiedAt", labelKey: "nav.modifiedDate" },
  { key: "createdAt", labelKey: "nav.createdDate" },
  { key: "title", labelKey: "nav.title" },
];
// 2026-05-21 ユーザー要望「全ての列が並び替え対象になるよう」に従い、列ヘッダから
// labels / knowledgeCount / author でもソートできる。ツールバー側の SORT_KEYS には
// あえて入れない（一覧上で使うことが少ない sort key を吸い込んで肥大化させない）。

export function NoteListToolbar({
  sortKey,
  sortDir,
  onSort,
  searchQuery,
  onSearchChange,
}: {
  sortKey: SortKey;
  sortDir: SortDirection;
  onSort: (key: SortKey) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const t = useT();
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50">
      {/* ソートドロップダウン */}
      <div className="relative" ref={sortRef}>
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          {t(SORT_KEYS.find((o) => o.key === sortKey)?.labelKey ?? "")}
          {sortDir === "desc" ? " ↓" : " ↑"}
        </button>
        {showSortMenu && (
          <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-md py-1 z-10 min-w-[120px]">
            {SORT_KEYS.map((opt) => (
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
                {t(opt.labelKey)}
                {sortKey === opt.key && (sortDir === "desc" ? " ↓" : " ↑")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* テキスト検索 */}
      <div className="flex-1" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t("common.search")}
        className="text-xs px-2.5 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 w-48 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
    </div>
  );
}
