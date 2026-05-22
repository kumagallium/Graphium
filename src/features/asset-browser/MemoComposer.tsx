// 素材ページ右パネル「Memos」タブ上部の直接入力欄。
// - Enter で送信、Shift+Enter で改行（ChatGPT / Slack と同じパターン）
// - 送信後はクリアしてフォーカス維持 → 連投できる
// - 自動高さ拡張（auto + scrollHeight）
//
// 「クリック → 入力 → Enter」だけで完結することを優先。確定ボタンは出さない。

import { useRef, useState, type KeyboardEvent } from "react";
import { StickyNote } from "lucide-react";

export type MemoComposerProps = {
  onSubmit: (text: string) => void | Promise<void>;
  /** プレースホルダー上書き（テスト・ストーリー用） */
  placeholder?: string;
};

export function MemoComposer({ onSubmit, placeholder }: MemoComposerProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
      requestAnimationFrame(() => {
        adjustHeight();
        ref.current?.focus();
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="px-3 py-3 border-b border-border-subtle bg-surface">
      <div
        className="
          flex items-start gap-2
          rounded-lg border border-border-subtle bg-background
          px-2.5 py-2
          transition-all duration-200
          focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20
        "
      >
        <StickyNote
          size={14}
          className="mt-0.5 text-text-tertiary flex-shrink-0"
          aria-hidden
        />
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "メモを書く… ⏎ で保存・Shift+⏎ で改行"}
          rows={1}
          disabled={submitting}
          className="
            flex-1 min-w-0 resize-none border-0 outline-none bg-transparent
            text-xs leading-relaxed text-foreground
            placeholder:text-text-tertiary
            disabled:opacity-60
          "
          style={{ fontFamily: "inherit", overflowY: "auto" }}
        />
      </div>
    </div>
  );
}
