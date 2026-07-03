// 素材ページ右パネル「Memos」タブ上部の直接入力欄。
// - Enter で送信、Shift+Enter で改行（ChatGPT / Slack と同じパターン）
// - 送信後はクリアしてフォーカス維持 → 連投できる
// - 自動高さ拡張（auto + scrollHeight）
//
// 「クリック → 入力 → Enter」だけで完結することを優先。確定ボタンは出さない。
//
// IME 確定 Enter の誤送信対策:
// - `onCompositionStart` / `onCompositionEnd` で composition 状態を ref で追跡
// - `e.nativeEvent.isComposing` と `e.keyCode === 229` を冗長にチェック
// - Safari/macOS で compositionend 直後にもう一度 Enter keydown が飛ぶ
//   ケースを `compositionend` からの経過時間で吸収する
import { useRef, useState, type KeyboardEvent } from "react";
import { StickyNote } from "lucide-react";
import { useT } from "../../i18n";

export type MemoComposerProps = {
  onSubmit: (text: string) => void | Promise<void>;
  /** プレースホルダー上書き（テスト・ストーリー用） */
  placeholder?: string;
};

export type EnterSubmitGuard = {
  /** Enter キーか */
  isEnter: boolean;
  /** Shift+Enter（改行扱い） */
  shiftKey: boolean;
  /** ref 経由で追跡している composition 状態 */
  composingNow: boolean;
  /** React SyntheticEvent.nativeEvent.isComposing */
  isComposing: boolean;
  /** keydown の keyCode（IME 中は 229 を返すブラウザ向け） */
  keyCode: number;
  /** compositionend からの経過ミリ秒 */
  msSinceCompositionEnd: number;
};

/**
 * Enter で submit していいかを判定する。IME 確定 Enter を弾くために
 * 複数のシグナルを冗長にチェックする。
 * - composingNow: onCompositionStart/End で ref 追跡（最も確実）
 * - isComposing / keyCode 229: ブラウザのネイティブ判定
 * - msSinceCompositionEnd: Safari/macOS で compositionend 直後に
 *   再度 Enter keydown が飛ぶ既知のケースを吸収
 */
export function shouldSubmitOnEnter(g: EnterSubmitGuard): boolean {
  if (!g.isEnter || g.shiftKey) return false;
  if (g.composingNow || g.isComposing || g.keyCode === 229) return false;
  if (g.msSinceCompositionEnd < 50) return false;
  return true;
}

export function MemoComposer({ onSubmit, placeholder }: MemoComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

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
    const ok = shouldSubmitOnEnter({
      isEnter: e.key === "Enter",
      shiftKey: e.shiftKey,
      composingNow: composingRef.current,
      isComposing: e.nativeEvent.isComposing,
      keyCode: e.keyCode,
      msSinceCompositionEnd: Date.now() - lastCompositionEndAtRef.current,
    });
    if (!ok) return;
    e.preventDefault();
    void handleSubmit();
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
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            lastCompositionEndAtRef.current = Date.now();
          }}
          placeholder={placeholder ?? t("memo.composerPlaceholder")}
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
