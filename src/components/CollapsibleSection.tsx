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
  /**
   * 見出しの文字部分をクリックしたときの遷移。渡すと、シェブロン＝開閉 /
   * 文字＝遷移 の 2 つのボタンに分かれる（フォルダ行と同じ操作）。
   * 「すべてのノート」のように、中身を畳めて自身も画面を持つ節のためのもの。
   */
  onTitleClick?: () => void;
  /** onTitleClick を渡したとき、その画面を開いているか（見出しをハイライトする） */
  titleActive?: boolean;
};

export function CollapsibleSection({
  storageKey,
  title,
  defaultOpen = true,
  count,
  children,
  onTitleClick,
  titleActive = false,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(() => readOpenState(storageKey, defaultOpen));

  useEffect(() => {
    writeOpenState(storageKey, open);
  }, [storageKey, open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const chevron = open ? <ChevronDown size={12} /> : <ChevronRight size={12} />;
  const headerClass = "flex items-center gap-1 text-xs font-semibold mb-1.5 transition-colors";
  const labelClass = titleActive
    ? "text-primary"
    : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70";

  return (
    <div className="px-4 pt-2 pb-1">
      {onTitleClick ? (
        // シェブロンと文字を別のボタンにする。入れ子のボタンを作らないよう
        // 見出し全体は div が持つ（フォルダ行と同じ組み方）
        <div className={`${headerClass} ${labelClass}`}>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="shrink-0 -ml-0.5 inline-flex items-center justify-center rounded hover:bg-sidebar-accent"
          >
            {chevron}
          </button>
          <button
            type="button"
            onClick={onTitleClick}
            className="flex-1 flex items-center gap-1 text-left min-w-0"
          >
            <span className="flex-1 text-left truncate">{title}</span>
            {typeof count === "number" && count > 0 && (
              <span className="text-xs text-muted-foreground/70 font-normal">{count}</span>
            )}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={`w-full ${headerClass} text-sidebar-foreground/40 hover:text-sidebar-foreground/70`}
        >
          <span className="shrink-0 -ml-0.5">{chevron}</span>
          <span className="flex-1 text-left">{title}</span>
          {typeof count === "number" && count > 0 && (
            <span className="text-xs text-muted-foreground/70 font-normal">{count}</span>
          )}
        </button>
      )}
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}
