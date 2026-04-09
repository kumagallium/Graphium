// URL ペースト時のスタイル選択メニュー
// ペーストされた URL を「ブックマーク」か「リンク（そのまま）」か選択する
// 矢印キー + Enter でキーボード操作可能

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, ExternalLink } from "lucide-react";
import { useT } from "../../i18n";

export type UrlPasteMenuProps = {
  url: string;
  /** メニュー表示位置（ペースト時のカーソル位置） */
  position: { x: number; y: number };
  onSelectBookmark: () => void;
  onSelectLink: () => void;
  onDismiss: () => void;
};

const ITEMS = ["bookmark", "link"] as const;

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

  const handleSelect = useCallback((index: number) => {
    if (ITEMS[index] === "bookmark") onSelectBookmark();
    else onSelectLink();
  }, [onSelectBookmark, onSelectLink]);

  // キーボード操作 + 外側クリック
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
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
    // 少し遅延して登録（ペーストイベントと競合しないため）
    // capture フェーズで登録し、エディタより先にキーイベントを捕捉する
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKeyDown, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDismiss, activeIndex, handleSelect]);

  // 画面外にはみ出さないよう調整
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(position.x, window.innerWidth - 220),
    top: Math.min(position.y + 4, window.innerHeight - 120),
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
          <ExternalLink size={14} className="text-muted-foreground shrink-0" />
          <div className="text-left">
            <div className="font-medium">{t("asset.urlStyleBookmark")}</div>
            <div className="text-[10px] text-muted-foreground">{t("asset.urlStyleBookmarkSub")}</div>
          </div>
        </button>
        <button
          onClick={() => handleSelect(1)}
          onMouseEnter={() => setActiveIndex(1)}
          className={itemClass(1)}
        >
          <Link size={14} className="text-muted-foreground shrink-0" />
          <div className="text-left">
            <div className="font-medium">{t("asset.urlStyleLink")}</div>
            <div className="text-[10px] text-muted-foreground">{t("asset.urlStyleLinkSub")}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
