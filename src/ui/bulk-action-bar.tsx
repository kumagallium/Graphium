// 一覧で複数選択したときの一括操作バー（ノート・素材・メモ・知見の一覧で共通）。
//
// 決まり（2026-11-07、利用者の指摘「150% でボタンの文字が改行してダサい・ボタンが多い」）:
// - 件数は左に 1 回だけ（「N 件を選択中」）。ボタンは動詞だけにして短く保つ
// - 表に並べるのはよく使う 3 つまで（primary）。残りは「その他 ⌄」のメニュー（more）。
//   primary が 3 つに満たなければ more から繰り上げ、メニューが 1 項目だけになるならメニューは作らない
// - 削除はアイコンだけの赤いボタンで右端に固定（件数はツールタイプと aria-label に）
// - 実行中の操作（busyLabel あり）は、メニューに入っていても表に出して進み具合を見せる
// - ボタンの文字は折り返さない（whitespace-nowrap）。幅が足りなければバーごと折り返す
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { Dropdown } from "./dropdown";
import type { Rect } from "./floating-position";

export type BulkAction = {
  id: string;
  /** 動詞だけの文言（件数は付けない。対象が選択の一部だけなら subsetCount を渡す） */
  label: string;
  icon?: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  tooltip?: string;
  disabled?: boolean;
  /** 実行中の文言。渡すとスピナー付きで表に出し、押せなくする */
  busyLabel?: string;
  /** 選んだうち、この操作の対象になる件数（選択数と違うときだけ「（N 件）」を添える） */
  subsetCount?: number;
};

type Props = {
  count: number;
  onClear: () => void;
  /** 表に並べる操作（3 つまでを想定） */
  primary: BulkAction[];
  /** 「その他」に入れる操作 */
  more?: BulkAction[];
  onDelete?: () => void;
  /** 削除ボタンのツールチップ・aria-label（例「11 件を削除」） */
  deleteLabel?: string;
  /** 書き出し失敗などの短い知らせ（件数の右に出す） */
  notice?: ReactNode;
  className?: string;
};

/** 表に並べるボタンの数（削除と「その他」は別） */
const MAX_SHOWN = 3;

const BTN =
  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-background text-xs font-medium text-foreground whitespace-nowrap shrink-0 hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-default";

export function BulkActionBar({
  count,
  onClear,
  primary,
  more = [],
  onDelete,
  deleteLabel,
  notice,
  className,
}: Props) {
  const t = useT();
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<Rect | null>(null);

  const labelOf = (a: BulkAction) => {
    if (a.busyLabel) return a.busyLabel;
    if (a.subsetCount != null && a.subsetCount !== count) {
      return t("bulk.withSubset", { label: a.label, count: String(a.subsetCount) });
    }
    return a.label;
  };

  // 表は 3 つまで。primary が 3 つに満たなければ more から繰り上げる。
  // メニューに 1 項目しか残らないなら、それも表に出す（1 項目のためにメニューを開かせない）
  const slots = Math.max(0, MAX_SHOWN - primary.length);
  let lifted = more.slice(0, slots);
  let menu = more.slice(slots);
  if (menu.length === 1) {
    lifted = [...lifted, ...menu];
    menu = [];
  }
  // 実行中のものはメニューから表へ出す（閉じたメニューの中では進み具合が見えないため）
  const busyMore = menu.filter((a) => a.busyLabel);
  const restMore = menu.filter((a) => !a.busyLabel);
  const shown = [...primary, ...lifted, ...busyMore];

  return (
    <div
      className={`px-6 py-2 border-b border-border bg-primary/5 flex flex-wrap items-center gap-x-3 gap-y-2 ${className ?? ""}`}
      role="toolbar"
      aria-label={t("bulk.selectedCount", { count: String(count) })}
    >
      <span className="text-xs font-medium text-foreground whitespace-nowrap">
        {t("bulk.selectedCount", { count: String(count) })}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
      >
        {t("bulk.clear")}
      </button>
      {notice}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {shown.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled || !!a.busyLabel}
            className={BTN}
            data-tooltip={a.tooltip}
          >
            {a.busyLabel ? <Loader2 size={12} className="animate-spin" /> : a.icon}
            {labelOf(a)}
          </button>
        ))}
        {restMore.length > 0 && (
          <button
            ref={moreBtnRef}
            type="button"
            className={BTN}
            aria-haspopup="menu"
            aria-expanded={!!menuAnchor}
            onClick={() => {
              if (menuAnchor) {
                setMenuAnchor(null);
                return;
              }
              const r = moreBtnRef.current?.getBoundingClientRect();
              if (r) setMenuAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
            }}
          >
            {t("bulk.more")}
            <ChevronDown size={12} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-destructive/40 bg-background text-destructive shrink-0 hover:bg-destructive/10 transition-colors"
            data-tooltip={deleteLabel}
            aria-label={deleteLabel}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {menuAnchor && (
        <Dropdown
          // メニューの右端をボタンの右端に揃える（右に寄ったバーなので左へ開く）
          position={{ top: menuAnchor.bottom + 4, left: menuAnchor.right - 240 }}
          anchorRect={menuAnchor}
          placement="bottom-end"
          onClose={() => setMenuAnchor(null)}
          minWidth={220}
        >
          <div role="menu" className="py-1">
            {restMore.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={(e) => {
                  setMenuAnchor(null);
                  a.onClick(e);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground text-left whitespace-nowrap hover:bg-muted transition-colors disabled:text-muted-foreground disabled:cursor-default"
                data-tooltip={a.tooltip}
              >
                <span className="w-3.5 inline-flex justify-center text-muted-foreground">{a.icon}</span>
                {labelOf(a)}
              </button>
            ))}
          </div>
        </Dropdown>
      )}
    </div>
  );
}
