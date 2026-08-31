// パラメータ・属性値の @参照リンク
//
// 右パネル（プロパティの表）やノードカードの「パラメータを表示」に出る値が
// `@ノート名` / `@素材名` のとき、参照先へ飛べる小さなボタン（↗）を添える。
// - 値そのものはノート側テーブルのただの文字列。ここでは**表示時に**解決するだけで、
//   データには何も足さない（本文セルの @メンションと同じ思想）
// - 解決の実体（ノート名 → noteId、素材名 → 外部ソース ID）はホスト（note-app）が
//   レジストリに登録する。network-graph は noteIndex / mediaIndex を直接知らない
// - 開く経路は onOpenExternalNote（既存）に乗せる。外部ソース ID
//   （pdf:/document:/data:/url:）の振り分けは受け側の Side Peek 実装が行う

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import { t } from "../../i18n";

/**
 * 名前 → 開ける ID（ノートの素 ID or 外部ソース ID）。解決できなければ null。
 * note-app が本文メンションのクリック解決と同じロジックを登録する。
 */
let paramLinkResolver: ((name: string) => string | null) | null = null;

export function setParamLinkResolver(resolver: ((name: string) => string | null) | null) {
  paramLinkResolver = resolver;
}

/**
 * セル値・属性値から参照リンク先を解決する。
 * `@名前` 形式（前後の空白は許容）でなければ null。
 */
export function resolveParamLinkTarget(value: string | null | undefined): string | null {
  if (!value || !paramLinkResolver) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("@") || trimmed.length < 2) return null;
  return paramLinkResolver(trimmed.slice(1));
}

/**
 * 参照先へ飛ぶ小さなボタン。解決できた値の隣に置く。
 * アイコンは共有引用カードの「開く」と同じ ArrowUpRight — サイドピークで開く操作の
 * 既存語彙で、ExternalLink（箱 + 矢印）だと別タブで開きそうに見えるため使わない。
 * 編集クリックと混ざらないようボタンだけがリンク
 */
export function ParamLinkButton({
  targetId,
  onOpen,
  size = 10,
}: {
  targetId: string;
  onOpen: (id: string) => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      className="nodrag"
      onClick={(e) => {
        // セルの編集開始・ノード選択にクリックを渡さない
        e.stopPropagation();
        onOpen(targetId);
      }}
      title={t("paramLink.open")}
      aria-label={t("paramLink.open")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 1,
        margin: 0,
        border: "none",
        borderRadius: 3,
        background: "transparent",
        color: "var(--color-primary, var(--color-text-secondary))",
        cursor: "pointer",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    >
      <ArrowUpRight size={size} />
    </button>
  );
}

/** @入力の候補。label は一覧表示用（絵文字可）、insert は確定時にセルへ入る値 */
export type ParamLinkSuggestion = { label: string; insert: string };

let paramLinkSuggestions: ((query: string) => ParamLinkSuggestion[]) | null = null;

export function setParamLinkSuggestions(
  provider: ((query: string) => ParamLinkSuggestion[]) | null
) {
  paramLinkSuggestions = provider;
}

/**
 * 値セルの編集入力。値を `@` で始めると、本文の @メンションと同じ候補
 * （ノート・素材）が下に出て、選ぶと `@名前` が確定される。
 * - 候補の確定は onPick（親がセル値の確定まで行う）。Enter は候補を
 *   ↑↓ で選んでいるときだけ候補確定、それ以外は通常の確定（onCommit）
 * - 候補クリックは mousedown で拾う（blur で編集が閉じるより先に動かす）
 */
export function ParamValueField({
  value,
  onChange,
  onCommit,
  onCancel,
  onPick,
  compositionHandlers,
  isImeKey,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onPick: (insert: string) => void;
  compositionHandlers: Record<string, unknown>;
  isImeKey: (e: React.KeyboardEvent) => boolean;
  style?: CSSProperties;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // -1 = 候補を選んでいない（Enter は通常確定）。↑↓ で 0..n-1 に入る
  const [highlighted, setHighlighted] = useState(-1);

  const trimmed = value.trimStart();
  const query = trimmed.startsWith("@") ? trimmed.slice(1) : null;
  const suggestions = useMemo(
    () => (query !== null && paramLinkSuggestions ? paramLinkSuggestions(query) : []),
    [query]
  );

  // 候補の出現・消滅や入力で選択状態をリセット
  useLayoutEffect(() => {
    setHighlighted(-1);
  }, [query, suggestions.length]);

  // ドロップダウンは fixed で input の近くに置く（右パネルの overflow に切られない）。
  // 画面下端に近い入力では下に収まらないので、空きの広い側（上下）へ開く
  const [rect, setRect] = useState<
    | { left: number; width: number; maxHeight: number; top?: number; bottom?: number }
    | null
  >(null);
  useLayoutEffect(() => {
    if (suggestions.length === 0) {
      setRect(null);
      return;
    }
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const base = { left: r.left, width: Math.max(r.width, 220) };
    if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
      setRect({ ...base, top: r.bottom + 2, maxHeight: Math.min(220, Math.max(spaceBelow, 80)) });
    } else {
      // 上に開く。bottom 指定にすると候補数が変わっても input 側に張り付いたまま伸びる
      setRect({
        ...base,
        bottom: window.innerHeight - r.top + 2,
        maxHeight: Math.min(220, Math.max(spaceAbove, 80)),
      });
    }
  }, [suggestions.length, value]);

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value)}
        {...compositionHandlers}
        onKeyDown={(e) => {
          if (suggestions.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setHighlighted((cur) => {
              const n = suggestions.length;
              if (e.key === "ArrowDown") return (cur + 1) % n;
              return cur <= 0 ? n - 1 : cur - 1;
            });
            return;
          }
          if (e.key === "Enter" && !isImeKey(e)) {
            if (highlighted >= 0 && suggestions[highlighted]) {
              e.preventDefault();
              onPick(suggestions[highlighted].insert);
            } else {
              onCommit();
            }
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={onCancel}
        style={style}
      />
      {rect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: rect.left,
              top: rect.top,
              bottom: rect.bottom,
              minWidth: rect.width,
              maxWidth: 340,
              maxHeight: rect.maxHeight,
              overflowY: "auto",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              boxShadow: "var(--shadow-2, 0 4px 12px rgba(0,0,0,0.12))",
              zIndex: 300,
              padding: 3,
            }}
          >
            {suggestions.map((sug, i) => (
              <div
                key={`${sug.insert}:${i}`}
                // click では blur（編集終了）が先に走るので mousedown で確定する
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(sug.insert);
                }}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  background: highlighted === i ? "var(--color-accent)" : "transparent",
                  color: "var(--color-foreground)",
                }}
              >
                {sug.label}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
