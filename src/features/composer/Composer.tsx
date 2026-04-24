// Cmd+K Composer — Ask 単機能の AI 呼び出し口
// 「⌘K＝AI に聞く / `/`＝挿入 / `#`＝ラベル / `@`＝参照」という
// 1 ショートカット 1 用途の棲み分けに揃えるため、当面 UI は Ask のみ公開する。
//
// compose / insert-prov / insert-media の実装は ref ハンドラに残しており、
// 将来スラッシュメニューや別ショートカットから再利用できる（詳細は
// project_composer_mode_redesign.md）。

import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n";
import type { ComposerMode, ComposerSubmission, DiscoveryCard } from "./types";

type ComposerProps = {
  open: boolean;
  /** 現状は常に "ask"。将来 UI 復活時のために型は残してある。 */
  mode: ComposerMode;
  prompt: string;
  onPromptChange: (value: string) => void;
  /** 将来用。現在の UI には呼び出す箇所がない。 */
  onModeChange?: (mode: ComposerMode) => void;
  onSubmit: (submission: ComposerSubmission) => void;
  onClose: () => void;
  /** Ask モードの発見カード（直近文脈から呼び出し側が組み立てる） */
  discoveryCards?: DiscoveryCard[];
  onDiscoveryCardSelect?: (card: DiscoveryCard) => void;
};

export function Composer(props: ComposerProps) {
  const {
    open,
    mode,
    prompt,
    onPromptChange,
    onSubmit,
    onClose,
    discoveryCards,
    onDiscoveryCardSelect,
  } = props;

  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 開いた瞬間にフォーカス・textarea の縦サイズ初期化
  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [open]);

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter で送信（Shift+Enter は改行）
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const trimmed = prompt.trim();
      if (trimmed.length === 0) return;
      onSubmit({ mode, prompt: trimmed });
    }
  };

  const handleInput = (value: string) => {
    onPromptChange(value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  };

  const cards = useMemo(() => discoveryCards ?? [], [discoveryCards]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={t("composer.aria.dialog")}
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
      }}
    >
      {/* オーバーレイ */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0.22 0.01 85 / 0.35)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* 本体 */}
      <div
        style={{
          position: "relative",
          width: "min(640px, calc(100vw - 32px))",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 上段 — プロンプト入力 */}
        <div
          style={{
            padding: "14px 16px 10px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, 'SF Mono', monospace",
              fontSize: 13,
              color: "var(--forest)",
              lineHeight: "22px",
              userSelect: "none",
            }}
            aria-hidden
          >
            »
          </span>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("composer.placeholder")}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--ink)",
              minHeight: 22,
              maxHeight: 120,
              fontFamily: "inherit",
            }}
          />
          <kbd
            style={{
              fontFamily: "ui-monospace, 'SF Mono', monospace",
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: "var(--r-1)",
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
              background: "var(--paper-2)",
              alignSelf: "flex-start",
              whiteSpace: "nowrap",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* 中段 — 発見カード */}
        {cards.length > 0 && (
          <div
            style={{
              borderTop: "1px solid var(--rule-2)",
              padding: "10px 12px 12px",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
              background: "var(--paper-2)",
            }}
          >
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => onDiscoveryCardSelect?.(card)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--r-2)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  font: "inherit",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  {card.title}
                </span>
                {card.hint && (
                  <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45 }}>
                    {card.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

      </div>
    </div>,
    document.body,
  );
}
