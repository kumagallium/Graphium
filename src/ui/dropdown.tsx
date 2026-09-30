// Crucible デザインシステム — Dropdown コンポーネント
// position:fixed ポータルで表示するフローティングパネル。
// 既存の ProvPanel, LinkDetailPanel の共通パターンを抽出。

import {
  forwardRef,
  type HTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { type PlaceFloatingResult, type Rect, placeFloating } from "./floating-position";

/** 表示位置（ビューポート座標）。anchorRect を持たせると position 経由で起点ボタンの矩形も渡せる */
export type DropdownPosition = { top: number; left: number; anchorRect?: Rect };

type DropdownProps = {
  /** 表示位置（ビューポート座標） */
  position: DropdownPosition;
  /**
   * 起点ボタンの矩形（ビューポート座標）。渡すと下に収まらないとき上へ反転できる。
   * 渡さない場合は position の点を起点として扱う（右クリックなど）。
   */
  anchorRect?: Rect;
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
  anchorRect: anchorRectProp,
  onClose,
  children,
  minWidth = 200,
  maxHeight = "80vh",
  className,
}: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRect = anchorRectProp ?? position.anchorRect;
  const [placed, setPlaced] = useState<PlaceFloatingResult | null>(null);

  // 描いたあと実寸を測り、画面（ビューポート）に収まる位置・最大高さへ直す。
  // 毎レンダーで測る（中身の切り替え・削除確認などで高さが変わるため）。同じ結果なら state は据え置き
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    // 今の maxHeight に縮められた高さではなく、本来の高さを測るため一時的に戻す
    const prevMax = el.style.maxHeight;
    el.style.maxHeight = maxHeight;
    const r = el.getBoundingClientRect();
    el.style.maxHeight = prevMax;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    let next: PlaceFloatingResult;
    if (anchorRect) {
      next = placeFloating({
        anchor: anchorRect,
        size: { width: r.width, height: r.height },
        viewport,
        gap: 4,
      });
    } else {
      // 点が起点: 右に収まらず左に収まるなら点の左へ、下に収まらなければ点の上へ
      const p = position;
      const flipX =
        p.left + r.width > viewport.width - 8 && p.left - r.width >= 8;
      next = placeFloating({
        anchor: { top: p.top, bottom: p.top, left: p.left, right: p.left },
        size: { width: r.width, height: r.height },
        viewport,
        placement: flipX ? "bottom-end" : "bottom-start",
        gap: 0,
      });
    }
    setPlaced((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next,
    );
  };
  useLayoutEffect(measure);

  // 画面サイズ変更・中身の高さ変化（非同期）にも追従
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    window.addEventListener("resize", measure);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRect, position.top, position.left, maxHeight]);

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!ref.current) return;
      if (ref.current.contains(target)) return;
      // Modal などの portal 内のクリックは外側扱いしない
      if (
        target instanceof Element &&
        target.closest("[data-modal-portal]")
      ) {
        return;
      }
      onClose();
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
        top: placed?.top ?? position.top,
        left: placed?.left ?? position.left,
        minWidth,
        // 指定の最大高さと、置いた側の空きの小さいほう
        maxHeight: placed ? `min(${maxHeight}, ${placed.maxHeight}px)` : maxHeight,
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
      "px-2.5 py-0.5 text-xs font-bold text-muted-foreground",
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
