// 検索バーの見た目と入力ハンドリングだけを持つ presentational コンポーネント。
//
// ブラウザ標準の検索に近いフローティングバー。入力・ヒット件数・前後移動・
// 大文字小文字・閉じる、を 1 行に収める。
// 検索そのもの（ハイライト・ヒット計算）は呼び出し側が持つ:
//   - ノート本文 → DocumentSearchBar / useDocumentSearch
//   - 素材 PDF   → PdfViewer / usePdfSearch

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, CaseSensitive, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/ui/icon-button";
import { useT } from "@/i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";

export interface SearchBarProps {
  query: string;
  /** ヒット総数。 */
  total: number;
  /** 現在ヒットの 1-based 表示位置（ヒット 0 件のときは 0）。 */
  current: number;
  caseSensitive: boolean;
  onQueryChange: (q: string) => void;
  onToggleCaseSensitive: () => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** 入力欄のプレースホルダ（検索対象で文言が変わる）。 */
  placeholder: string;
  /** 配置。既定は画面右上固定。コンテナ内に置く場合は absolute 系を渡す。 */
  className?: string;
}

export function SearchBar({
  query,
  total,
  current,
  caseSensitive,
  onQueryChange,
  onToggleCaseSensitive,
  onNext,
  onPrev,
  onClose,
  placeholder,
  className,
}: SearchBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // マウント（＝開いた瞬間）に入力欄へフォーカス＋全選択（続けて打ち直せるように）。
  useEffect(() => {
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, []);

  const hasQuery = query.length > 0;
  const noHits = hasQuery && total === 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 変換確定の Enter は移動に使わない（WebKit の compositionend →
    // keydown(13) 順にも対応する共通ガードで判定）。
    if (isImeKey(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Escape は「検索を閉じる」だけに使う。伝播させると、素材サイドピークの
      // ように Escape で閉じる親まで一緒に閉じてしまう。
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        "rounded-xl border border-border bg-popover/95 backdrop-blur",
        "px-2 py-1.5 shadow-lg",
        className ?? "fixed top-3 right-4 z-[120]",
      )}
      role="search"
      // バー内のクリックで対象側の選択が外れてもハイライトは保つ。
      onMouseDown={(e) => {
        // 入力欄・ボタン以外（余白）クリックでフォーカスを奪わない。
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        {...compositionHandlers}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "w-44 bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none",
          "placeholder:text-muted-foreground/60",
        )}
      />

      {/* ヒット件数 */}
      <span
        className={cn(
          "min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums",
          noHits ? "text-destructive" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {!hasQuery
          ? ""
          : noHits
            ? t("docSearch.noResults")
            : t("docSearch.count", {
                current: String(current),
                total: String(total),
              })}
      </span>

      <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

      <IconButton
        size="sm"
        aria-label={t("docSearch.caseSensitive")}
        title={t("docSearch.caseSensitive")}
        aria-pressed={caseSensitive}
        onClick={onToggleCaseSensitive}
        className={cn(caseSensitive && "bg-accent text-accent-foreground")}
      >
        <CaseSensitive />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.prev")}
        title={t("docSearch.prev")}
        onClick={onPrev}
        disabled={total === 0}
      >
        <ChevronUp />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.next")}
        title={t("docSearch.next")}
        onClick={onNext}
        disabled={total === 0}
      >
        <ChevronDown />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.close")}
        title={t("docSearch.close")}
        onClick={onClose}
      >
        <X />
      </IconButton>
    </div>
  );
}
