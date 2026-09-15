// ローカルビュー（時系列モード）ヘッダーの「起点」セレクト。
//
// ノート題で絞り込む検索付きピッカー。専用の Popover 部品は無いため、
// UrlPasteMenu / material-actions-menu と同じ「絶対配置 div + 外側クリックで
// 閉じる」パターンに揃える（docs/internal/note-chain-plan.md §3 PR3 W1）。
//
// 候補は index.notes から deletedAt / archivedAt / source==="ai"（Wiki）を
// 除いたもの。クエリが空なら modifiedAt 降順、クエリがあれば題の部分一致。

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";

export type NoteOriginPickerProps = {
  index: GraphiumIndex | null;
  value: string | null;
  onChange: (noteId: string) => void;
};

const MAX_CANDIDATES = 20;

function isCandidate(entry: NoteIndexEntry): boolean {
  return !entry.deletedAt && !entry.archivedAt && entry.source !== "ai";
}

export function NoteOriginPicker({ index, value, onChange }: NoteOriginPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const currentTitle = useMemo(() => {
    if (!value || !index) return null;
    return index.notes.find((n) => n.noteId === value)?.title ?? null;
  }, [index, value]);

  const candidates = useMemo(() => {
    if (!index) return [];
    const pool = index.notes.filter(isCandidate);
    const trimmed = query.trim();
    if (!trimmed) {
      return [...pool].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, MAX_CANDIDATES);
    }
    const needle = trimmed.toLowerCase();
    return pool.filter((n) => n.title.toLowerCase().includes(needle)).slice(0, MAX_CANDIDATES);
  }, [index, query]);

  // 開いたら検索欄にフォーカス、クエリと選択位置を初期化
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  // 候補が変わったら選択位置を先頭へ戻す
  useEffect(() => {
    setActiveIndex(0);
  }, [candidates.length]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (noteId: string) => {
    onChange(noteId);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isImeKey(e)) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (candidates.length > 0) setActiveIndex((prev) => (prev + 1) % candidates.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (candidates.length > 0) setActiveIndex((prev) => (prev - 1 + candidates.length) % candidates.length);
        break;
      case "Enter":
        e.preventDefault();
        if (candidates[activeIndex]) pick(candidates[activeIndex].noteId);
        break;
      case "Escape":
        e.preventDefault();
        // 全体グラフは document の keydown で Esc を拾って自分を閉じる。ここで止めないと
        // ドロップダウンを閉じるつもりの Esc で全体グラフごと閉じる（検索欄と同じ対策）
        e.stopPropagation();
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="px-2 py-0.5 rounded-md border border-border bg-card text-sm"
      >
        {currentTitle ?? <span className="text-muted-foreground">{t("localView.originPlaceholder")}</span>}
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            width: 260,
            maxHeight: 320,
            display: "flex",
            flexDirection: "column",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-2)",
            overflow: "hidden",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t("localView.originPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            {...compositionHandlers}
            className="px-2 py-1.5 text-sm border-b border-border bg-transparent outline-none"
          />
          <div style={{ overflowY: "auto", padding: 4 }}>
            {candidates.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                {t("localView.originNone")}
              </div>
            ) : (
              candidates.map((entry, i) => (
                <button
                  key={entry.noteId}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onClick={() => pick(entry.noteId)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={
                    "w-full text-left px-2 py-1.5 rounded-md text-sm truncate " +
                    (i === activeIndex ? "bg-secondary" : "hover:bg-secondary/60")
                  }
                >
                  {entry.title}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
