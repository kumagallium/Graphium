// ローカルビュー（時系列モード）ヘッダーの「起点」セレクト。
//
// ノート題で絞り込む検索付きピッカー。専用の Popover 部品は無いため、
// UrlPasteMenu / material-actions-menu と同じ「絶対配置 div + 外側クリックで
// 閉じる」パターンに揃える（docs/internal/note-chain-plan.md §3 PR3 W1）。
//
// 候補は index.notes から deletedAt / archivedAt / source==="ai"（Wiki）を
// 除いたもの。クエリが空なら modifiedAt 降順、クエリがあれば題の部分一致。

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useFloatingPlacement } from "../../ui/floating-position";
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
  // 候補一覧は body へ出して fixed で置く（ピークの下に潜らない）。実寸を測り、
  // 下に収まらなければ上へ・高さが足りなければ最大高さを空きに縮める
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const placed = useFloatingPlacement(containerRef.current, panelEl, open, {}, [
    query,
  ]);
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
      const target = e.target as Node;
      // 一覧は portal 先なので、ボタン側と一覧側の両方を内側と見なす
      if (containerRef.current?.contains(target) || panelEl?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, panelEl]);

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
      {open && createPortal(
        <div
          ref={setPanelEl}
          role="listbox"
          style={{
            position: "fixed",
            top: placed?.top ?? 0,
            left: placed?.left ?? 0,
            // 位置が決まるまで見せない（visibility だと検索欄へフォーカスできない）
            opacity: placed ? undefined : 0,
            zIndex: 9999,
            width: 260,
            maxHeight: Math.min(320, placed ? placed.maxHeight : 320),
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
        </div>,
        document.body,
      )}
    </div>
  );
}
