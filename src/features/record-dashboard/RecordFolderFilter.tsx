// 記録の画面の、フォルダでの絞り込み。
// ボタンを押すと、フォルダが新しく動いた順に並ぶ。選ぶと、そのフォルダの記録だけになる。
// 数えるのは記録の数といちばん新しい記録の日だけで、進み具合として保存している状態は無い。
import { Check, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "../../i18n";
import "./record-dashboard.css";
import type { RecordCopy } from "./copy";
import { type FolderSummary, dayKeyOf, daysAgo, formatDate } from "./model";

export type RecordFolderFilterProps = {
  folders: readonly FolderSummary[];
  /** 選んでいるフォルダ。undefined は絞っていない、null は「フォルダなし」 */
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  /** 今日・昨日の判定に使う「いま」（ISO 8601） */
  now: string;
  locale: Locale;
  copy: RecordCopy;
};

/** いちばん新しい記録の日。今日・昨日はその言葉で、それより前は日付で出す */
function lastLabel(lastAt: string, now: string, locale: Locale, copy: RecordCopy): string {
  const day = dayKeyOf(lastAt);
  if (!day) return "";
  const ago = daysAgo(day, now);
  if (ago === 0) return copy.today;
  if (ago === 1) return copy.yesterday;
  return formatDate(day, locale);
}

export function RecordFolderFilter({ folders, value, onChange, now, locale, copy }: RecordFolderFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // 外を押したとき・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (next: string | null | undefined) => {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  };
  // ↑↓ で行を移る
  const onMenuKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const options = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".rd-folder-option")];
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1);
    options[next]?.focus();
  };

  const on = value !== undefined;
  const label = value === undefined ? copy.allFolders : value === null ? copy.noFolder : value;
  return (
    <div className="rd-folder-filter" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="rd-folder-button"
        data-on={on ? "true" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${copy.folder}: ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Folder size={16} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="rd-folder-menu" id={menuId} role="listbox" aria-label={copy.folder} onKeyDown={onMenuKey}>
          <li role="none">
            <button type="button" className="rd-folder-option" role="option" aria-selected={value === undefined} autoFocus={value === undefined} onClick={() => pick(undefined)}>
              {value === undefined ? <Check size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
              <span className="rd-folder-option-name">{copy.allFolders}</span>
            </button>
          </li>
          {folders.map((f, i) => {
            const selected = value !== undefined && value === f.name;
            const Icon = selected ? Check : f.name === null ? FolderOpen : Folder;
            return (
              // 「フォルダなし」は、名前のあるフォルダと線で分ける
              <li key={f.name ?? ""} role="none" data-sep={i === 0 || f.name === null ? "true" : undefined}>
                <button type="button" className="rd-folder-option" role="option" aria-selected={selected} autoFocus={selected} onClick={() => pick(f.name)}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="rd-folder-option-name">{f.name ?? copy.noFolder}</span>
                  <span className="rd-folder-option-meta">{lastLabel(f.lastAt, now, locale, copy)}</span>
                  <span className="rd-folder-option-meta">{copy.count(f.count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
