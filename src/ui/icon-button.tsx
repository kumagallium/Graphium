// Crucible デザインシステム — IconButton コンポーネント
// アイコンのみのボタン。ツールバー・SideMenu のアクション等に使用。

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** ボタンサイズ (default: "md") */
  size?: "sm" | "md" | "lg";
  /** アクセシビリティ用ラベル（必須） */
  "aria-label": string;
  /** ホバー・フォーカスで出すツールチップ（src/ui/tooltip.ts）。既定は aria-label と同じ。
   *  false で出さない（隣に同じ文字が見えているときなど） */
  tooltip?: string | false;
  /** ツールチップの 2 行目（使い方・ショートカット） */
  tooltipUsage?: string;
};

const sizeMap = {
  sm: "h-7 w-7 [&_svg]:size-3.5",
  md: "h-8 w-8 [&_svg]:size-4",
  lg: "h-9 w-9 [&_svg]:size-5",
} as const;

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", tooltip, tooltipUsage, ...props }, ref) => (
    <button
      data-tooltip={tooltip === false ? undefined : (tooltip ?? props["aria-label"])}
      data-tooltip-usage={tooltip === false ? undefined : tooltipUsage}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        sizeMap[size],
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export { IconButton };
export type { IconButtonProps };
