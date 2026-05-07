// 折り畳み可能なサイドバーセクション。
// 開閉状態は localStorage に永続化（key 単位）。
// FileSidebar が情報過多になってきたため、ユーザーが必要な領域だけ展開できるようにする。

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "graphium-sidebar-section:";

function readOpenState(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (v === "1") return true;
    if (v === "0") return false;
    return defaultOpen;
  } catch {
    return defaultOpen;
  }
}

function writeOpenState(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export type CollapsibleSectionProps = {
  /** localStorage キー（一意） */
  storageKey: string;
  /** セクション見出し */
  title: ReactNode;
  /** 既定の開閉状態（localStorage に値が無いときに使用） */
  defaultOpen?: boolean;
  /** 件数バッジ（>0 のときのみ表示） */
  count?: number;
  /** 子要素（セクション本体） */
  children: ReactNode;
};

export function CollapsibleSection({
  storageKey,
  title,
  defaultOpen = true,
  count,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(() => readOpenState(storageKey, defaultOpen));

  useEffect(() => {
    writeOpenState(storageKey, open);
  }, [storageKey, open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className="px-4 pt-2 pb-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1 text-xs font-semibold text-sidebar-foreground/40 hover:text-sidebar-foreground/70 mb-1.5 transition-colors"
      >
        <span className="shrink-0 -ml-0.5">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="flex-1 text-left">{title}</span>
        {typeof count === "number" && count > 0 && (
          <span className="text-xs text-muted-foreground/70 font-normal">{count}</span>
        )}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}
