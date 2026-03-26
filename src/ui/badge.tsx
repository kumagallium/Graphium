// Crucible デザインシステム — Badge コンポーネント
// MASTER.md 準拠: rounded-full, text-xs, font-semibold

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // 共通スタイル
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors duration-200 [&_svg]:size-3",
  {
    variants: {
      variant: {
        // デフォルト: ブランドグリーン
        default:
          "border-primary/30 bg-primary/10 text-primary",
        // セカンダリー: ニュートラル
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        // アウトライン: ボーダーのみ
        outline:
          "border-border bg-transparent text-foreground",
        // 成功
        success:
          "border-[#b8d4bb] bg-[#edf5ee] text-[#2d4a32]",
        // エラー
        error:
          "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]",
        // 情報
        info:
          "border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]",
        // 警告
        warning:
          "border-[#fde68a] bg-[#fffbeb] text-[#b45309]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      className={cn(badgeVariants({ variant, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
export type { BadgeProps };
