// Crucible デザインシステム — Dropdown コンポーネント
// position:fixed ポータルで表示するフローティングパネル。
// 既存の LabelDropdownPortal, ProvPanel, LinkDetailPanel の共通パターンを抽出。

import { forwardRef, type HTMLAttributes, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type DropdownProps = {
  /** 表示位置（ビューポート座標） */
  position: { top: number; left: number };
  /** 閉じるコールバック（外側クリック・Escape） */
  onClose: () => void;
  children: React.ReactNode;
  /** 最小幅 (default: 200px) */
  minWidth?: number;
  /** 最大高さ (default: 80vh) */
  maxHeight?: string;
  className?: string;
};

function Dropdown({
  position,
  onClose,
  children,
  minWidth = 200,
  maxHeight = "80vh",
  className,
}: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // バッジクリックとの競合を避けるため少し遅延
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Escape で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={cn(
        "fixed z-[9999] rounded-lg border border-border bg-card shadow-lg overflow-y-auto",
        className,
      )}
      style={{
        top: position.top,
        left: position.left,
        minWidth,
        maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ドロップダウン内のセクションヘッダー
const DropdownSectionHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn(
      "px-2.5 py-0.5 text-[10px] font-bold text-muted-foreground tracking-wider uppercase",
      className,
    )}
    ref={ref}
    {...props}
  />
));
DropdownSectionHeader.displayName = "DropdownSectionHeader";

// ドロップダウン内の区切り線
function DropdownDivider() {
  return <div className="border-t border-border my-1" />;
}

export { Dropdown, DropdownSectionHeader, DropdownDivider };
