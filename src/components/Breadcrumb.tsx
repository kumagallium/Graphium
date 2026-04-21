// パンくずリスト
// 階層ナビゲーションを表示し、各セグメントがクリック可能

import { ChevronRight } from "lucide-react";

export type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

type Props = {
  items: BreadcrumbItem[];
};

export function Breadcrumb({ items }: Props) {
  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 opacity-50" />}
            {isLast || !item.onClick ? (
              <span className={isLast ? "text-foreground font-medium truncate max-w-[200px]" : ""}>
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
