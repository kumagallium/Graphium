// URL ペースト時のスタイル選択メニュー
// ペーストされた URL を「リンク（そのまま）」か「ブックマーク」か選択する
// URL は中身展開より参照が主目的なのでリンクを既定（先頭・初期選択）にする
// （MediaPickerModal の displayMode 既定と同じ方針）
// 矢印キー + Enter でキーボード操作可能

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import { isImeKeyEvent } from "../../lib/ime-enter";

export type UrlPasteMenuProps = {
  url: string;
  /** メニュー表示位置（ペースト時のカーソル位置） */
  position: { x: number; y: number };
  onSelectBookmark: () => void;
  onSelectLink: () => void;
  onDismiss: () => void;
};

const ITEMS = ["link", "bookmark"] as const;

export function UrlPasteMenu({
  url,
  position,
  onSelectBookmark,
  onSelectLink,
  onDismiss,
}: UrlPasteMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // メニュー表示中もフォーカスはエディタに残り IME 入力が継続し得るため、
  // document レベルで composition を追跡する（lib/ime-enter.ts 参照）
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const handleSelect = useCallback((index: number) => {
    if (ITEMS[index] === "link") onSelectLink();
    else onSelectBookmark();
  }, [onSelectBookmark, onSelectLink]);

  // キーボード操作 + 外側クリック
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const handleCompositionStart = () => {
      composingRef.current = true;
    };
    const handleCompositionEnd = () => {
      composingRef.current = false;
      lastCompositionEndAtRef.current = Date.now();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // IME 変換中・確定直後のキーはメニュー操作として扱わない（矢印は IME の
      // 候補選択、Enter は変換確定）。capture で奪うと WKWebView の確定 Enter
      // （compositionend → keydown(13, isComposing=false)）で「リンク」が誤発火
      // し、エディタに Enter が届かなくなる。
      if (
        isImeKeyEvent({
          composingNow: composingRef.current,
          isComposing: e.isComposing,
          keyCode: e.keyCode,
          msSinceCompositionEnd: Date.now() - lastCompositionEndAtRef.current,
        })
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((prev) => (prev + 1) % ITEMS.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((prev) => (prev - 1 + ITEMS.length) % ITEMS.length);
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          handleSelect(activeIndex);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
          break;
      }
    };
    // composition はメニュー表示前から進行中の可能性があるため即時登録する
    document.addEventListener("compositionstart", handleCompositionStart, true);
    document.addEventListener("compositionend", handleCompositionEnd, true);
    // 少し遅延して登録（ペーストイベントと競合しないため）
    // capture フェーズで登録し、エディタより先にキーイベントを捕捉する
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKeyDown, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("compositionstart", handleCompositionStart, true);
      document.removeEventListener("compositionend", handleCompositionEnd, true);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDismiss, activeIndex, handleSelect]);

  // 画面外にはみ出さないよう上下限ともクランプする
  // （ブロックが画面外にスクロールしていた場合など、負の座標が渡ることがある）
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(position.x, window.innerWidth - 220)),
    top: Math.max(8, Math.min(position.y + 4, window.innerHeight - 120)),
    zIndex: 100,
  };

  const itemClass = (index: number) =>
    `w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground transition-colors ${
      activeIndex === index ? "bg-muted" : "hover:bg-muted"
    }`;

  return (
    <div ref={menuRef} style={style}>
      <div className="bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px]">
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground truncate max-w-[200px]">
          {url}
        </div>
        <div className="border-t border-border my-0.5" />
        <button
          onClick={() => handleSelect(0)}
          onMouseEnter={() => setActiveIndex(0)}
          className={itemClass(0)}
        >
          <Link size={14} className="text-muted-foreground shrink-0" />
          <div className="text-left">
            <div className="font-medium">{t("asset.urlStyleLink")}</div>
            <div className="text-[10px] text-muted-foreground">{t("asset.urlStyleLinkSub")}</div>
          </div>
        </button>
        <button
          onClick={() => handleSelect(1)}
          onMouseEnter={() => setActiveIndex(1)}
          className={itemClass(1)}
        >
          <ExternalLink size={14} className="text-muted-foreground shrink-0" />
          <div className="text-left">
            <div className="font-medium">{t("asset.urlStyleBookmark")}</div>
            <div className="text-[10px] text-muted-foreground">{t("asset.urlStyleBookmarkSub")}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
