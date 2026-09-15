// 文脈ラベル（noteContexts）を付与・除去するピッカー。
// FilterPopup（列ヘッダの絞り込み）が「既存値の選択」しかできないのに対し、こちらは
// 「自由入力で新規作成」＋「既存値のサジェスト選択」＋「クリア」ができる付与用 UI。
// Dropdown（portal / 外側クリック / Escape）を流用してフローティング表示する。
//
// 使う場所（すべて同じコンポーネントを再利用）:
//  - ノート一覧「文脈」セルの「＋文脈」/ ピルクリック
//  - ノートヘッダの「文脈」ピル型ボタン
//  - 複数選択時の一括バー「N件に文脈を付ける」（selected は空で開き、追加のみ行う）
//
// このピッカーでできるのは「いま操作している対象に付ける・外す」だけ。フォルダそのものの
// 名前の変更・削除（ほかのノートや素材にも効く操作）はここに置かず、サイドバーのフォルダ行と
// 素材ギャラリーの絞り込みに任せる。例外は**このピッカーで作ったばかりのフォルダ**:
// まだ操作中の対象にしか付いていないので、打ち間違いを直す（onReplace）・チェックを外して
// 作らなかったことにする、はどちらも対象への付け外しで済み、ほかに波及しない。

import { useMemo, useRef, useState } from "react";
import { Search, Plus, Pencil } from "lucide-react";
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
  /**
   * 付いている文脈を別の名前に差し替える（操作中の対象だけ。replaceNoteContext で 1 回に）。
   * 指定すると、このピッカーで作ったばかりの行に「名前を直す」鉛筆を出す。
   */
  onReplace?: (from: string, to: string) => void;
  /** すべてクリア（未指定なら「クリア」行を出さない = 一括付与モード等） */
  onClear?: () => void;
  title?: string;
  placeholder?: string;
  /** 新規作成行のラベル生成（例: (v) => `「${v}」を新規作成`） */
  createLabel?: (value: string) => string;
  clearLabel?: string;
  emptyText?: string;
  minWidth?: number;
};

const keyOf = (value: string) => value.trim().toLowerCase();

export function ContextTagPicker({
  position,
  onClose,
  selected,
  suggestions,
  onAdd,
  onRemove,
  onReplace,
  onClear,
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
  // ref を変えたときに再描画させるためのカウンタ（ref はそれ自体では再描画しない）
  const [, bumpRender] = useState(0);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  // 名前を直す入力欄の IME 判定（検索欄と組成状態を混ぜない）
  const fixIme = useImeEnterGuard();

  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);

  // このピッカーを開いている間に一度でも表示した値を覚えておく（キー=小文字, 値=表示名）。
  // チェックを外した瞬間に行が消えると「外す＝消える」と紐づいて怖いので、開いている間は
  // 外しても行を残す（チェックが外れるだけに見せる）。閉じて開き直すと自然に消える。
  const seenValuesRef = useRef<Map<string, string>>(new Map());
  // このピッカーで作ったフォルダ（キー）。名前を直す鉛筆を出す対象
  const createdKeysRef = useRef<Set<string>>(new Set());
  // 作ったあとに外した・直した元の名前（キー）。どこにも残っていないので行ごと消す。
  // 親の集計が追いつく前の古い候補で行が戻ってこないよう、選択されない限り出さない
  const discardedKeysRef = useRef<Set<string>>(new Set());

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
      const key = keyOf(s.value);
      if (key) map.set(key, s);
    }
    // (3) 現在の選択で補完
    for (const v of selected) {
      const key = keyOf(v);
      if (key && !map.has(key)) map.set(key, { value: v, count: 0 });
    }
    // 見た値として記録（次回以降のレンダーで消えないように）
    for (const opt of map.values()) {
      const key = keyOf(opt.value);
      if (key && !seenValuesRef.current.has(key)) seenValuesRef.current.set(key, opt.value);
    }
    return Array.from(map.values());
  }, [suggestions, selected]);

  // 作らなかったことにした値は、選び直されない限り出さない（毎描画で判定する。ref は memo の依存にできない）
  const visible = merged.filter((o) => {
    const key = keyOf(o.value);
    return !discardedKeysRef.current.has(key) || selectedKeys.has(key);
  });

  const q = query.trim();
  const qLower = q.toLowerCase();
  const filtered = q ? visible.filter((o) => o.value.toLowerCase().includes(qLower)) : visible;
  const exactExists = visible.some((o) => o.value.toLowerCase() === qLower);
  const canCreate = q.length > 0 && !exactExists;

  // ── 作ったばかりのフォルダの名前を直す ──
  const [fixing, setFixing] = useState<{ from: string; value: string } | null>(null);
  // blur と Enter / Esc が続けて来ても 1 回だけ処理する
  const fixingRef = useRef<string | null>(null);

  const startFix = (value: string) => {
    fixingRef.current = value;
    setFixing({ from: value, value });
  };
  const cancelFix = () => {
    fixingRef.current = null;
    setFixing(null);
  };
  const commitFix = (nextValue: string) => {
    const from = fixingRef.current;
    fixingRef.current = null;
    setFixing(null);
    const to = nextValue.trim();
    if (!from || !onReplace || !to || to === from) return;
    const fromKey = keyOf(from);
    const toKey = keyOf(to);
    // 直した先が既にあるフォルダなら、そちらに合流する（作ったばかりの扱いは引き継がない）
    const joinsExisting = toKey !== fromKey && visible.some((o) => keyOf(o.value) === toKey);
    onReplace(from, to);
    createdKeysRef.current.delete(fromKey);
    seenValuesRef.current.delete(fromKey);
    if (toKey !== fromKey) discardedKeysRef.current.add(fromKey);
    discardedKeysRef.current.delete(toKey);
    seenValuesRef.current.set(toKey, joinsExisting ? (seenValuesRef.current.get(toKey) ?? to) : to);
    if (!joinsExisting) createdKeysRef.current.add(toKey);
    bumpRender((x) => x + 1);
  };

  const toggle = (value: string) => {
    const key = keyOf(value);
    if (selectedKeys.has(key)) {
      onRemove(value);
      // 作ったばかりのフォルダは、外せばどこにも残らない。行ごと消して「作らなかった」に戻す
      if (createdKeysRef.current.has(key)) {
        createdKeysRef.current.delete(key);
        seenValuesRef.current.delete(key);
        discardedKeysRef.current.add(key);
        bumpRender((x) => x + 1);
      }
    } else {
      onAdd(value);
    }
  };

  // すべて外したら、作ったばかりのフォルダも作らなかったことにする（toggle と同じ）
  const clearAll = () => {
    if (!onClear) return;
    onClear();
    if (createdKeysRef.current.size > 0) {
      for (const key of createdKeysRef.current) {
        seenValuesRef.current.delete(key);
        discardedKeysRef.current.add(key);
      }
      createdKeysRef.current.clear();
      bumpRender((x) => x + 1);
    }
  };

  // Enter / 作成行は「付ける」意味に固定（既存に一致すれば選択、無ければ新規作成）。
  // onAdd は呼び出し側で正規化・重複除去されるので、既に付いていれば実質 no-op。
  const addTyped = () => {
    if (!q) return;
    if (!exactExists) {
      createdKeysRef.current.add(qLower);
      discardedKeysRef.current.delete(qLower);
    }
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
                  addTyped();
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
            onClick={addTyped}
            className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2 text-primary"
          >
            <Plus size={13} className="shrink-0" aria-hidden />
            <span className="flex-1 truncate">{createLabelFn(q)}</span>
          </button>
        )}

        {/* 候補リスト */}
        {visible.length === 0 && !canCreate ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyTextText}</div>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            {filtered.map((opt) => {
              const key = keyOf(opt.value);
              const isSelected = selectedKeys.has(key);
              const h = noteContextHue(opt.value);
              const checkbox = (
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
              );
              const dot = (
                <span
                  className="w-2.5 h-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `hsl(${h} 45% 45%)` }}
                  aria-hidden
                />
              );

              if (fixing && keyOf(fixing.from) === key) {
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-1 text-xs">
                    {checkbox}
                    {dot}
                    <input
                      type="text"
                      value={fixing.value}
                      onChange={(e) => setFixing({ from: fixing.from, value: e.target.value })}
                      {...fixIme.compositionHandlers}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !fixIme.isImeKey(e)) {
                          e.preventDefault();
                          commitFix(fixing.value);
                        } else if (e.key === "Escape") {
                          // ピッカーごと閉じず、直すのだけやめる
                          e.preventDefault();
                          e.stopPropagation();
                          cancelFix();
                        }
                      }}
                      // 外をクリックしたら、有効な変更だけ確定する（サイドバーの改名と同じ）
                      onBlur={() => commitFix(fixing.value)}
                      aria-label={t("nav.fixNewFolderAria", { value: fixing.from })}
                      className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-primary/50 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                      autoFocus
                    />
                  </div>
                );
              }

              const canFix = !!onReplace && createdKeysRef.current.has(key);
              return (
                <div key={key} className="relative">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      "w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2",
                      canFix && "pr-8",
                    )}
                  >
                    {checkbox}
                    {dot}
                    <span className="flex-1 truncate text-foreground">{opt.value}</span>
                    {/* 作ったばかりのフォルダの件数は「いま付けた分」なので出さず、鉛筆に場所を譲る */}
                    {!canFix && opt.count > 0 && (
                      <span className="shrink-0 tabular-nums text-text-tertiary">{opt.count}</span>
                    )}
                  </button>
                  {/* 作ったばかりのフォルダだけ、名前を直せる。気づいてすぐ押せるよう常に出す */}
                  {canFix && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startFix(opt.value);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-text-tertiary hover:text-foreground hover:bg-muted transition-colors"
                      aria-label={t("nav.fixNewFolderAria", { value: opt.value })}
                      title={t("nav.fixNewFolder")}
                    >
                      <Pencil size={12} />
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
              onClick={clearAll}
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
