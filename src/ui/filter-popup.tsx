// Crucible デザインシステム — FilterPopup コンポーネント
// 列ヘッダのアイコンから呼び出す、複数選択フィルタ用ポップアップ。
// Dropdown を内部で利用し、portal / 外側クリック / Escape 終了の挙動を共通化。

import { type ReactNode, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dropdown } from "./dropdown";
import { cn } from "@/lib/utils";

export type FilterOption = {
  value: string;
  label: string;
  /** 件数表示（任意） */
  count?: number;
  /** 左側に表示するアイコン or 色チップ（任意） */
  icon?: ReactNode;
};

type FilterPopupProps = {
  /** トリガー要素のビューポート座標（呼び出し側で計算して渡す） */
  position: { top: number; left: number };
  /** 閉じる時に呼ばれる（外側クリック・Escape・Clear ボタン） */
  onClose: () => void;
  /** ポップアップ上端の見出し（例: 「種別」「ラベル」） */
  title?: string;
  options: FilterOption[];
  /** 現在選択中の value（空配列 = すべて表示 = フィルタ未適用） */
  selected: string[];
  onChange: (selected: string[]) => void;
  /** 検索ボックス表示。default: options.length >= 8 で自動表示 */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** 「クリア」ボタンのラベル（多言語呼び出し側で差し替え） */
  clearLabel?: string;
  /** 空状態テキスト */
  emptyText?: string;
  /** 検索ボックスのプレースホルダがマッチしなかった時 */
  noMatchText?: string;
  /** popup の min-width。default 220 */
  minWidth?: number;
};

export function FilterPopup({
  position,
  onClose,
  title,
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder = "Search…",
  clearLabel = "Clear",
  emptyText = "No options",
  noMatchText = "No match",
  minWidth = 220,
}: FilterPopupProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const showSearch = searchable ?? options.length >= 8;

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const handleClear = () => {
    onChange([]);
  };

  return (
    <Dropdown position={position} onClose={onClose} minWidth={minWidth}>
      <div className="py-1.5" role="dialog" aria-label={title ?? "Filter"}>
        {title && (
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
            {title}
          </div>
        )}

        {showSearch && (
          <div className="px-2 pb-1.5">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full text-xs pl-6 pr-2 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                autoFocus
              />
            </div>
          </div>
        )}

        {options.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</div>
        ) : filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{noMatchText}</div>
        ) : (
          <div className="max-h-[260px] overflow-y-auto">
            {filteredOptions.map((opt) => {
              const isSelected = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isSelected}
                  onClick={() => toggle(opt.value)}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <span
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-[8px] leading-none",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border",
                    )}
                    aria-hidden
                  >
                    {isSelected && "✓"}
                  </span>
                  {opt.icon && (
                    <span className="shrink-0 inline-flex items-center" aria-hidden>
                      {opt.icon}
                    </span>
                  )}
                  <span className="flex-1 truncate text-foreground">{opt.label}</span>
                  {typeof opt.count === "number" && (
                    <span className="shrink-0 tabular-nums text-text-tertiary">
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selected.length > 0 && (
          <>
            <div className="border-t border-border my-1" />
            <button
              type="button"
              onClick={handleClear}
              className="w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={`${clearLabel} (${selected.length})`}
            >
              {clearLabel}
              <span className="ml-1 tabular-nums">({selected.length})</span>
            </button>
          </>
        )}
      </div>
      <span id={id} className="sr-only" />
    </Dropdown>
  );
}
