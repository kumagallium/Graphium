// ラベル付きブロックのギャラリービュー
// 特定のラベルが付いたブロックを全ノート横断でリスト表示する

import { useMemo, useState } from "react";
import { useT, getDisplayLabelName } from "../../i18n";
import type { ProvNoteIndex } from "../navigation/index-file";

// ラベル色マッピング（NoteListView と同じ）
const LABEL_HEX: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[結果]": "#c26356",
  "[属性]": "#c08b3e",
  "[パターン]": "#8b7ab5",
  "[試料]": "#8b7ab5",
  "[条件]": "#c08b3e",
};

/** 日付を YYYY-MM-DD 形式でフォーマット */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type LabelEntry = {
  noteId: string;
  noteTitle: string;
  blockId: string;
  label: string;
  preview: string;
  modifiedAt: string;
};

type SortKey = "modifiedAt" | "noteTitle";

export type LabelGalleryViewProps = {
  noteIndex: ProvNoteIndex | null;
  label: string;
  onBack: () => void;
  onNavigateNote: (noteId: string) => void;
};

export function LabelGalleryView({
  noteIndex,
  label,
  onBack,
  onNavigateNote,
}: LabelGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortAsc, setSortAsc] = useState(false);

  // ラベルに一致するブロックを全ノートから収集
  const entries = useMemo(() => {
    if (!noteIndex) return [];
    const result: LabelEntry[] = [];
    for (const note of noteIndex.notes) {
      for (const l of note.labels) {
        if (l.label === label) {
          result.push({
            noteId: note.noteId,
            noteTitle: note.title,
            blockId: l.blockId,
            label: l.label,
            preview: l.preview,
            modifiedAt: note.modifiedAt,
          });
        }
      }
    }
    return result;
  }, [noteIndex, label]);

  // フィルタ + ソート
  const filtered = useMemo(() => {
    let result = entries;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.noteTitle.toLowerCase().includes(q) ||
          e.preview.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "modifiedAt") {
        cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      } else {
        cmp = a.noteTitle.localeCompare(b.noteTitle);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [entries, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(key === "noteTitle");
      return key;
    });
  };

  const displayName = getDisplayLabelName(label);
  const color = LABEL_HEX[label] ?? "#8fa394";

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
        <span
          className="inline-block text-sm font-semibold rounded-full px-2.5 py-0.5"
          style={{
            backgroundColor: color + "18",
            color,
            border: `1px solid ${color}38`,
          }}
        >
          {displayName}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("asset.count", { count: String(filtered.length) })}
        </span>
      </div>

      {/* 検索 + ソート */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("label.search")}
          className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
        />
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => handleSort("modifiedAt")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "modifiedAt"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("asset.sortDate")}{sortKey === "modifiedAt" && (sortAsc ? " ↑" : " ↓")}
          </button>
          <button
            onClick={() => handleSort("noteTitle")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "noteTitle"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("label.sortNote")}{sortKey === "noteTitle" && (sortAsc ? " ↑" : " ↓")}
          </button>
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-auto px-6">
        {!noteIndex ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("label.noBlocks")}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-3">{t("label.noteColumn")}</th>
                <th className="py-2 px-3">{t("label.previewColumn")}</th>
                <th className="py-2 pl-3 w-[80px]">{t("nav.modifiedDate")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={`${entry.noteId}-${entry.blockId}-${i}`}
                  className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => onNavigateNote(entry.noteId)}
                >
                  <td className="py-2 px-3">
                    <span className="text-foreground hover:text-primary transition-colors font-medium">
                      {entry.noteTitle}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">
                    {entry.preview || t("common.empty")}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground">
                    {formatDate(entry.modifiedAt)}
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
