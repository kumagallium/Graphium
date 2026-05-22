// MemoComposer のデザイン案比較ストーリー
// MaterialFullView 右パネル「Memos」タブ上部の直接入力欄。
//
// 3 案を並べて、design.md ガイドライン（角丸 rounded-lg / border-subtle /
// transition duration-200 / space-y-4）と居心地の良さの観点で見比べる。
//
// 動作は 3 案とも同じ（Enter 送信・Shift+Enter 改行・送信後フォーカス維持）。
// 違うのは「枠の角丸 / focus フィードバック / アイコン有無 / 余白」の見た目だけ。

import { useRef, useState, type KeyboardEvent } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StickyNote } from "lucide-react";
import { MemoComposer } from "./MemoComposer";
import "../../app.css";

const meta: Meta = {
  title: "Asset Browser / MemoComposer",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "MaterialFullView 右パネル「Memos」タブ上部の直接入力欄。A/B/C の 3 案を比較する。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const onSubmit = async (text: string) => {
  console.log("[MemoComposer] submitted:", text);
  await new Promise((r) => setTimeout(r, 200));
};

// ── 共通フック（3 案で同じ挙動。見た目だけ差し替える） ─────────────
function useMemoComposerState(submit: (t: string) => void | Promise<void>) {
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
      await submit(trimmed);
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

  return { text, setText, submitting, ref, adjustHeight, handleKeyDown };
}

// ── 案 A: 控えめ案（現状を tailwind 化、rounded-lg + focus ring + 余白整理） ─
function MemoComposerA() {
  const s = useMemoComposerState(onSubmit);
  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface">
      <textarea
        ref={s.ref}
        value={s.text}
        onChange={(e) => {
          s.setText(e.target.value);
          s.adjustHeight();
        }}
        onKeyDown={s.handleKeyDown}
        placeholder="メモを書く… ⏎ で保存・Shift+⏎ で改行"
        rows={1}
        disabled={s.submitting}
        className="
          w-full resize-none rounded-lg border border-border-subtle bg-background
          px-2.5 py-1.5
          text-xs leading-relaxed text-foreground
          placeholder:text-text-tertiary
          transition-all duration-200
          focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20
          disabled:opacity-60
        "
        style={{ fontFamily: "inherit", overflowY: "auto" }}
      />
    </div>
  );
}

// ── 案 B: カード風（shadow-sm + 上下余白、入力欄が浮いて見える） ────
function MemoComposerB() {
  const s = useMemoComposerState(onSubmit);
  return (
    <div className="px-3 py-3 border-b border-border-subtle bg-surface">
      <textarea
        ref={s.ref}
        value={s.text}
        onChange={(e) => {
          s.setText(e.target.value);
          s.adjustHeight();
        }}
        onKeyDown={s.handleKeyDown}
        placeholder="メモを書く… ⏎ で保存・Shift+⏎ で改行"
        rows={1}
        disabled={s.submitting}
        className="
          w-full resize-none rounded-lg border border-border-subtle bg-card
          px-3 py-2
          text-xs leading-relaxed text-foreground
          placeholder:text-text-tertiary
          shadow-sm
          transition-all duration-200
          hover:shadow-md
          focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20
          disabled:opacity-60
        "
        style={{ fontFamily: "inherit", overflowY: "auto" }}
      />
    </div>
  );
}

// ── 案 C: アイコン付き（左に StickyNote、Slack の入力欄ふう） ────────
function MemoComposerC() {
  const s = useMemoComposerState(onSubmit);
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
          ref={s.ref}
          value={s.text}
          onChange={(e) => {
            s.setText(e.target.value);
            s.adjustHeight();
          }}
          onKeyDown={s.handleKeyDown}
          placeholder="メモを書く… ⏎ で保存・Shift+⏎ で改行"
          rows={1}
          disabled={s.submitting}
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

// ── 右パネル幅を模した枠（実際の Memos タブと同じ幅で見比べる） ────
function PanelFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-text-tertiary px-1">{label}</div>
      <div className="w-[360px] border border-border-subtle rounded-lg bg-card overflow-hidden">
        {children}
        <div className="px-3 py-6 text-xs text-text-tertiary text-center leading-relaxed">
          この素材に紐づくメモはまだありません。
          <br />
          上の入力欄から書き込むか、PDF のテキストを選択して「メモに保存」できます。
        </div>
      </div>
    </div>
  );
}

// ── 単独案: 採用予定（MemoComposer 本体）─────────────
export const Production: Story = {
  name: "Production (現在の実装)",
  render: () => (
    <PanelFrame label="Production (現在の MemoComposer.tsx)">
      <MemoComposer onSubmit={onSubmit} />
    </PanelFrame>
  ),
};

// ── 案 A 単独 ─────────────
export const VariantA: Story = {
  name: "A: 控えめ案",
  render: () => (
    <PanelFrame label="A: 控えめ案 / rounded-lg + focus ring + 余白整理">
      <MemoComposerA />
    </PanelFrame>
  ),
};

// ── 案 B 単独 ─────────────
export const VariantB: Story = {
  name: "B: カード風",
  render: () => (
    <PanelFrame label="B: カード風 / shadow-sm + 上下余白で浮かせる">
      <MemoComposerB />
    </PanelFrame>
  ),
};

// ── 案 C 単独 ─────────────
export const VariantC: Story = {
  name: "C: アイコン付き",
  render: () => (
    <PanelFrame label="C: アイコン付き / StickyNote + Slack ふう">
      <MemoComposerC />
    </PanelFrame>
  ),
};

// ── 3 案を横並びで比較 ────────────────────────────────
export const Compare: Story = {
  name: "Compare: A / B / C",
  parameters: { layout: "fullscreen" },
  render: () => (
    <div className="p-8 bg-background min-h-screen">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          MemoComposer デザイン案比較
        </h2>
        <p className="text-xs text-text-tertiary">
          3 案とも動作（Enter 送信・Shift+Enter 改行・送信後フォーカス維持）は同じ。
          見た目だけ違う。各 placeholder にフォーカスして focus フィードバックも見比べる。
        </p>
      </div>
      <div className="flex gap-6 items-start flex-wrap">
        <PanelFrame label="A: 控えめ案 / rounded-lg + focus ring + 余白整理">
          <MemoComposerA />
        </PanelFrame>
        <PanelFrame label="B: カード風 / shadow-sm + 上下余白で浮かせる">
          <MemoComposerB />
        </PanelFrame>
        <PanelFrame label="C: アイコン付き / StickyNote + Slack ふう">
          <MemoComposerC />
        </PanelFrame>
      </div>
    </div>
  ),
};
