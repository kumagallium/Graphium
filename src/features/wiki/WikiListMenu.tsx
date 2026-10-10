// 知見一覧ヘッダーの「…」メニュー — 構造の付け直し・前回の結果・Asterism 書き出しをまとめる
// 既存の Dropdown / MenuItem を使う（外側クリックと Esc で閉じる・画面内への位置合わせは Dropdown 側）。
// ここで足すのは role=menu と矢印キーでの移動だけ。項目が 0 件のときはボタンごと出さない。

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { FileJson, ListTree, History, MoreHorizontal } from "lucide-react";
import { Dropdown, MenuItem } from "@/ui";
import type { DropdownPosition } from "@/ui/dropdown";
import { useT } from "../../i18n";

export type WikiListMenuProps = {
  /** 知見の構造を付け直す（AI 有効時だけ渡す） */
  onFrameBackfill?: () => void;
  /** 付け直しの実行中。true の間はその項目を無効にする */
  frameBackfillBusy?: boolean;
  /** 前回の結果を開く（結果があるときだけ渡す） */
  onShowLastBackfillResult?: () => void;
  /** Asterism 向けの書き出し（連携オンのときだけ渡す） */
  onAsterismExport?: () => void;
  className?: string;
};

export function WikiListMenu({
  onFrameBackfill,
  frameBackfillBusy = false,
  onShowLastBackfillResult,
  onAsterismExport,
  className,
}: WikiListMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  if (!onFrameBackfill && !onShowLastBackfillResult && !onAsterismExport) return null;

  const toggle = () => {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, anchorRect: r });
    setOpen(true);
  };

  const items = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

  const onListKey = (e: KeyboardEvent) => {
    const list = items();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") list[(i + 1) % list.length].focus();
    else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length].focus();
    else if (e.key === "Home") list[0].focus();
    else if (e.key === "End") list[list.length - 1].focus();
    else return;
    e.preventDefault();
  };

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        // 開いている間の押下は Dropdown の外側クリック判定に渡さない（閉じた直後に開き直るのを防ぐ）
        onMouseDown={(e) => { if (open) e.stopPropagation(); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("wikiList.menu")}
        data-tooltip={t("wikiList.menu")}
        className={
          "p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors " + (className ?? "")
        }
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <Dropdown position={pos} onClose={close} minWidth={220}>
          <div
            ref={(el) => {
              listRef.current = el;
              // 開いたら先頭の項目へフォーカス（キーボードで続けて操作できるように）
              if (el && !el.contains(document.activeElement)) items()[0]?.focus();
            }}
            role="menu"
            onKeyDown={onListKey}
            className="py-1"
          >
            {onFrameBackfill && (
              <MenuItem
                role="menuitem"
                disabled={frameBackfillBusy}
                onClick={pick(onFrameBackfill)}
                className="gap-2 disabled:opacity-50 disabled:cursor-default"
                data-tooltip={frameBackfillBusy ? t("frameBackfill.busyTitle") : t("frameBackfill.buttonTitle")}
              >
                <ListTree size={14} />
                {t("frameBackfill.button")}
              </MenuItem>
            )}
            {onShowLastBackfillResult && (
              <MenuItem role="menuitem" onClick={pick(onShowLastBackfillResult)} className="gap-2">
                <History size={14} />
                {t("frameBackfill.lastResult")}
              </MenuItem>
            )}
            {onAsterismExport && (
              <MenuItem
                role="menuitem"
                onClick={pick(onAsterismExport)}
                className="gap-2"
                data-tooltip={t("asterismExport.buttonTitle")}
              >
                <FileJson size={14} />
                {t("asterismExport.menuItem")}
              </MenuItem>
            )}
          </div>
        </Dropdown>
      )}
    </>
  );
}
