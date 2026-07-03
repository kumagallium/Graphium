// ドキュメント内検索バー（Cmd+F の UI）。
//
// ブラウザ標準の検索に近いフローティングバー。画面右上に出て、入力・ヒット
// 件数・前後移動・大文字小文字・閉じる、を 1 行に収める。Cmd+F の購読や
// ハイライト制御は useDocumentSearch が担い、ここは見た目と入力ハンドリング
// だけを持つ。エディタ未準備（editor=null）や非オープン時は何も描画しない。

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, CaseSensitive, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/ui/icon-button";
import { useT } from "@/i18n";
import { useDocumentSearch } from "./use-document-search";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";

interface DocumentSearchBarProps {
  /** 検索対象の BlockNote editor インスタンス（未準備なら null）。 */
  editor: any;
}

export function DocumentSearchBar({ editor }: DocumentSearchBarProps) {
  const t = useT();
  const { state, close, setQuery, toggleCaseSensitive, next, prev } =
    useDocumentSearch(editor);
  const inputRef = useRef<HTMLInputElement>(null);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 開いた瞬間に入力欄へフォーカス＋全選択（続けて打ち直せるように）。
  useEffect(() => {
    if (state.open) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [state.open]);

  if (!editor || !state.open) return null;

  const hasQuery = state.query.length > 0;
  const noHits = hasQuery && state.total === 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 変換確定の Enter は移動に使わない（WebKit の compositionend →
    // keydown(13) 順にも対応する共通ガードで判定）。
    if (isImeKey(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className={cn(
        "fixed top-3 right-4 z-[120] flex items-center gap-1",
        "rounded-xl border border-border bg-popover/95 backdrop-blur",
        "px-2 py-1.5 shadow-lg",
      )}
      role="search"
      // バー内のクリックでエディタの選択が外れてもハイライトは保つ。
      onMouseDown={(e) => {
        // 入力欄・ボタン以外（余白）クリックでフォーカスを奪わない。
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={state.query}
        onChange={(e) => setQuery(e.target.value)}
        {...compositionHandlers}
        onKeyDown={handleKeyDown}
        placeholder={t("docSearch.placeholder")}
        aria-label={t("docSearch.placeholder")}
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
                current: String(state.current),
                total: String(state.total),
              })}
      </span>

      <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

      <IconButton
        size="sm"
        aria-label={t("docSearch.caseSensitive")}
        title={t("docSearch.caseSensitive")}
        aria-pressed={state.caseSensitive}
        onClick={toggleCaseSensitive}
        className={cn(
          state.caseSensitive && "bg-accent text-accent-foreground",
        )}
      >
        <CaseSensitive />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.prev")}
        title={t("docSearch.prev")}
        onClick={prev}
        disabled={state.total === 0}
      >
        <ChevronUp />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.next")}
        title={t("docSearch.next")}
        onClick={next}
        disabled={state.total === 0}
      >
        <ChevronDown />
      </IconButton>

      <IconButton
        size="sm"
        aria-label={t("docSearch.close")}
        title={t("docSearch.close")}
        onClick={close}
      >
        <X />
      </IconButton>
    </div>
  );
}
