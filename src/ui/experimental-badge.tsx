// 実験的機能の印 — 有効性をまだ示せていない機能の入口（設定トグル名・見出し）に添える小さなピル
// 文言とツールチップは呼び出し側が i18n で渡す。個々の項目ごとには付けない（うるさくなるため）

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const experimentalBadgeVariants = cva(
  // 文字と同じ行に収まる高さ。目立たせすぎないよう font-medium・細い枠
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-medium leading-none align-middle select-none",
  {
    variants: {
      size: {
        xs: "px-1.5 py-0 text-xs",
        sm: "px-2 py-0.5 text-xs",
      },
      tone: {
        neutral: "border-border bg-transparent text-muted-foreground",
        warning: "border-warning-border bg-warning-bg text-warning",
        accent: "border-primary/30 bg-primary/10 text-primary",
      },
    },
    defaultVariants: { size: "xs", tone: "neutral" },
  },
);

type ExperimentalBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  VariantProps<typeof experimentalBadgeVariants> & {
    /** 表示文言（i18n で渡す） */
    label: string;
    /** ホバー時の説明（共通の data-tooltip 方式） */
    tooltip?: string;
  };

const ExperimentalBadge = forwardRef<HTMLSpanElement, ExperimentalBadgeProps>(
  ({ className, label, tooltip, size, tone, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(experimentalBadgeVariants({ size, tone }), className)}
      data-tooltip={tooltip}
      {...props}
    >
      {label}
    </span>
  ),
);
ExperimentalBadge.displayName = "ExperimentalBadge";

export { ExperimentalBadge, experimentalBadgeVariants };
export type { ExperimentalBadgeProps };
