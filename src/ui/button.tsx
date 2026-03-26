// Crucible デザインシステム — Button コンポーネント
// MASTER.md 準拠: rounded-lg, focus-visible リング, transition-colors

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 共通スタイル
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        // プライマリー: ブランドグリーン背景
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        // セカンダリー: 薄いグリーン背景
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        // アウトライン: ボーダーのみ
        outline:
          "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        // ゴースト: 背景なし
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        // 破壊的: 赤
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
export type { ButtonProps };
