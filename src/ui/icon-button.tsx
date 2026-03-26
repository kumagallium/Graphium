// Crucible デザインシステム — IconButton コンポーネント
// アイコンのみのボタン。ツールバー・SideMenu のアクション等に使用。

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** ボタンサイズ (default: "md") */
  size?: "sm" | "md" | "lg";
  /** アクセシビリティ用ラベル（必須） */
  "aria-label": string;
};

const sizeMap = {
  sm: "h-7 w-7 [&_svg]:size-3.5",
  md: "h-8 w-8 [&_svg]:size-4",
  lg: "h-9 w-9 [&_svg]:size-5",
} as const;

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", ...props }, ref) => (
    <button
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
