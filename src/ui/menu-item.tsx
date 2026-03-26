// Crucible デザインシステム — MenuItem コンポーネント
// Dropdown 内のメニュー項目。ラベル選択・コマンドパレット等に使用。

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** アクティブ（選択中）状態 */
  active?: boolean;
  /** 左側のカラードット（PROV-DM ラベル用） */
  dotColor?: string;
};

const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  ({ className, children, active, dotColor, ...props }, ref) => (
    <button
      className={cn(
        "flex items-center w-full text-left px-3 py-1.5 text-sm bg-transparent border-none cursor-pointer text-foreground",
        "hover:bg-accent",
        active && "font-semibold",
        className,
      )}
      ref={ref}
      {...props}
    >
      {dotColor && (
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5 shrink-0"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {children}
      {active && (
        <span className="ml-auto text-xs text-muted-foreground">
          ✓
        </span>
      )}
    </button>
  ),
);
MenuItem.displayName = "MenuItem";

export { MenuItem };
export type { MenuItemProps };
