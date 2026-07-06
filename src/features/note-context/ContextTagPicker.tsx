// 文脈ラベル（noteContexts）を付与・除去するピッカー。
// FilterPopup（列ヘッダの絞り込み）が「既存値の選択」しかできないのに対し、こちらは
// 「自由入力で新規作成」＋「既存値のサジェスト選択」＋「クリア」ができる付与用 UI。
// Dropdown（portal / 外側クリック / Escape）を流用してフローティング表示する。
//
// 使う場所（すべて同じコンポーネントを再利用）:
//  - ノート一覧「文脈」セルの「＋文脈」/ ピルクリック
//  - ノートヘッダの「文脈」ピル型ボタン
//  - 複数選択時の一括バー「N件に文脈を付ける」（selected は空で開き、追加のみ行う）

import { useMemo, useRef, useState } from "react";
import { Search, Plus, Trash2 } from "lucide-react";
import { Dropdown } from "@/ui/dropdown";
import { cn } from "@/lib/utils";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { noteContextHue } from "./context-tags";
import { useT } from "../../i18n";

export type ContextSuggestion = { value: string; count: number };

type ContextTagPickerProps = {
  /** トリガー要素のビューポート座標（呼び出し側で getBoundingClientRect して渡す） */
  position: { top: number; left: number };
  onClose: () => void;
  /** このノート（or 選択）に現在付いている文脈。空配列で一括付与モードにも使える */
  selected: string[];
  /** 全ノートから集計した既存文脈の候補（値 + 件数） */
  suggestions: ContextSuggestion[];
  /** 文脈を 1 つ追加（既存の選択でも呼ぶ。呼び出し側で正規化・重複除去される） */
  onAdd: (value: string) => void;
  /** 文脈を 1 つ除去 */
  onRemove: (value: string) => void;
  /** すべてクリア（未指定なら「クリア」行を出さない = 一括付与モード等） */
  onClear?: () => void;
  /**
   * 候補（文脈タグ）自体を削除する。指定すると各候補行のホバーでゴミ箱を出す。
   * その文脈を全ノートから外す想定。確認は呼び出し側で行い、実際に削除したら true を返す
   * （true のときだけ、このピッカーのセッション表示からも即座に消す）。
   */
  onDeleteCandidate?: (value: string) => boolean | Promise<boolean>;
  title?: string;
  placeholder?: string;
  /** 新規作成行のラベル生成（例: (v) => `「${v}」を新規作成`） */
  createLabel?: (value: string) => string;
  clearLabel?: string;
  emptyText?: string;
  minWidth?: number;
};

export function ContextTagPicker({
  position,
  onClose,
  selected,
  suggestions,
  onAdd,
  onRemove,
  onClear,
  onDeleteCandidate,
  title,
  placeholder,
  createLabel,
  clearLabel,
  emptyText,
  minWidth = 240,
}: ContextTagPickerProps) {
  const t = useT();
  // 呼び出し側が上書きしない限り、既存の nav.* キーでローカライズした既定文言を使う
  const placeholderText = placeholder ?? t("nav.contextPlaceholder");
  const createLabelFn = createLabel ?? ((v: string) => t("nav.createContext", { value: v }));
  const clearLabelText = clearLabel ?? t("nav.clearContexts");
  const emptyTextText = emptyText ?? t("nav.contextEmpty");
  const [query, setQuery] = useState("");
  // seenValuesRef を変えたときに再描画させるためのカウンタ（ref はそれ自体では再描画しない）
  const [, bumpRender] = useState(0);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const selectedKeys = useMemo(
    () => new Set(selected.map((s) => s.trim().toLowerCase())),
    [selected],
  );

  // このピッカーを開いている間に一度でも表示した値を覚えておく（キー=小文字, 値=表示名）。
  // チェックを外した瞬間に行が消えると「外す＝消える」と紐づいて怖いので、開いている間は
  // 外しても行を残す（チェックが外れるだけに見せる）。閉じて開き直すと自然に消える。
  const seenValuesRef = useRef<Map<string, string>>(new Map());

  // 候補・現在の選択・セッション中に見た値を統合する。
  // 選択済みだが候補に無い（この場で作った/このノート固有の）値や、外したばかりの値も出す。
  const merged = useMemo(() => {
    const map = new Map<string, ContextSuggestion>();
    // (1) セッション中に見た値を土台に（件数は不明なので 0。後段で最新値に上書きされる）
    for (const [key, value] of seenValuesRef.current) {
      map.set(key, { value, count: 0 });
    }
    // (2) 最新の集計候補で上書き（件数を反映）
    for (const s of suggestions) {
      const key = s.value.trim().toLowerCase();
      if (key) map.set(key, s);
    }
    // (3) 現在の選択で補完
    for (const v of selected) {
      const key = v.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, { value: v, count: 0 });
    }
    // 見た値として記録（次回以降のレンダーで消えないように）
    for (const opt of map.values()) {
      const key = opt.value.trim().toLowerCase();
      if (key && !seenValuesRef.current.has(key)) seenValuesRef.current.set(key, opt.value);
    }
    return Array.from(map.values());
  }, [suggestions, selected]);

  const q = query.trim();
  const qLower = q.toLowerCase();
  const filtered = useMemo(
    () => (q ? merged.filter((o) => o.value.toLowerCase().includes(qLower)) : merged),
    [merged, q, qLower],
  );
  const exactExists = merged.some((o) => o.value.toLowerCase() === qLower);
  const canCreate = q.length > 0 && !exactExists;

  const toggle = (value: string) => {
    if (selectedKeys.has(value.trim().toLowerCase())) {
      onRemove(value);
    } else {
      onAdd(value);
    }
  };

  // 候補ごと削除（全ノートから外す）。確認は呼び出し側。実際に削除されたら
  // セッション表示（seenValuesRef）からも消してこの場で行を消す。
  const handleDeleteCandidate = async (value: string) => {
    if (!onDeleteCandidate) return;
    const deleted = await onDeleteCandidate(value);
    if (deleted) {
      seenValuesRef.current.delete(value.trim().toLowerCase());
      bumpRender((x) => x + 1);
    }
  };

  const commitTyped = () => {
    if (!q) return;
    // Enter は「付ける」意味に固定（既存に一致すれば選択、無ければ新規作成）。
    // onAdd は呼び出し側で正規化・重複除去されるので、既に付いていれば実質 no-op。
    onAdd(q);
    setQuery("");
  };

  return (
    <Dropdown position={position} onClose={onClose} minWidth={minWidth}>
      <div className="py-1.5" role="dialog" aria-label={title ?? t("nav.noteContexts")}>
        {title && (
          <div className="px-3 pt-1 pb-1.5 text-xs font-bold text-muted-foreground">
            {title}
          </div>
        )}

        {/* 自由入力 + 検索 */}
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
              {...compositionHandlers}
              onKeyDown={(e) => {
                // IME 変換確定の Enter では追加しない。isComposing だけでは
                // WKWebView（デスクトップ）の compositionend → keydown(13) 順を
                // 取りこぼすため、共通ガードで判定する。
                if (e.key === "Enter" && !isImeKey(e)) {
                  e.preventDefault();
                  commitTyped();
                }
              }}
              placeholder={placeholderText}
              className="w-full text-xs pl-6 pr-2 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
              autoFocus
            />
          </div>
        </div>

        {/* 新規作成行（入力が既存と一致しないときだけ） */}
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              onAdd(q);
              setQuery("");
            }}
            className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2 text-primary"
          >
            <Plus size={13} className="shrink-0" aria-hidden />
            <span className="flex-1 truncate">{createLabelFn(q)}</span>
          </button>
        )}

        {/* 候補リスト */}
        {merged.length === 0 && !canCreate ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyTextText}</div>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            {filtered.map((opt) => {
              const isSelected = selectedKeys.has(opt.value.toLowerCase());
              const h = noteContextHue(opt.value);
              return (
                <div key={opt.value.toLowerCase()} className="relative group">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      "w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2",
                      onDeleteCandidate && "pr-8",
                    )}
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
                    <span
                      className="w-2.5 h-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: `hsl(${h} 45% 45%)` }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-foreground">{opt.value}</span>
                    {opt.count > 0 && (
                      <span className="shrink-0 tabular-nums text-text-tertiary group-hover:opacity-0 transition-opacity">
                        {opt.count}
                      </span>
                    )}
                  </button>
                  {/* 候補ごと削除（全ノートから外す）。行のトグルとは別の操作。 */}
                  {onDeleteCandidate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteCandidate(opt.value);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded text-text-tertiary hover:text-destructive hover:bg-destructive/10 transition-all"
                      aria-label={t("nav.deleteContextOptionAria", { value: opt.value })}
                      title={t("nav.deleteContextOptionTooltip")}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* クリア（選択があり onClear が渡された時のみ） */}
        {onClear && selected.length > 0 && (
          <>
            <div className="border-t border-border my-1" />
            <button
              type="button"
              onClick={onClear}
              className="w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={`${clearLabelText} (${selected.length})`}
            >
              {clearLabelText}
              <span className="ml-1 tabular-nums">({selected.length})</span>
            </button>
          </>
        )}
      </div>
    </Dropdown>
  );
}
