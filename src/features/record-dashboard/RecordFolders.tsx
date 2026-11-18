// 記録の画面の「フォルダごとの動き」。
// フォルダごとに、いちばん新しい記録の日・直近の日ごとの件数・残した人・まだチェックの付いていない項目の数を見せる。
// どれも記録から数えるだけで、進み具合として保存している状態は無い（期限・担当・完了の印は持たない）。
// フォルダを押すと、そのフォルダの記録だけに絞る。もう一度押すと戻る。
import { Folder, FolderOpen, ListChecks } from "lucide-react";
import { useState } from "react";
import type { Locale } from "../../i18n";
import "./record-dashboard.css";
import type { RecordCopy } from "./copy";
import { type FolderActivity, dayKeyOf, daysAgo, densityLevel, formatDate } from "./model";
import { WhoMark } from "./RecordRow";

/** たたんでいるときに出すフォルダの数 */
const FOLDERS_FOLDED = 5;

export type RecordFoldersProps = {
  folders: readonly FolderActivity[];
  /** 選んでいるフォルダ。undefined は選んでいない、null は「フォルダなし」 */
  selected: string | null | undefined;
  onSelect: (name: string | null) => void;
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

export function RecordFolders({ folders, selected, onSelect, now, locale, copy }: RecordFoldersProps) {
  const [open, setOpen] = useState(false);
  if (folders.length === 0) return null;
  // 濃淡の基準は、どのフォルダでも同じにする（フォルダどうしで比べられるように）
  const maxDay = Math.max(0, ...folders.flatMap((f) => f.days));
  const isSelected = (f: FolderActivity) => selected !== undefined && selected === f.name;
  // たたんでいても、選んでいるフォルダは出したままにする
  const shown = open ? folders : folders.filter((f, i) => i < FOLDERS_FOLDED || isSelected(f));
  const rest = folders.length - shown.length;
  return (
    <section className="rd-folders" aria-label={copy.folders}>
      <header className="rd-folders-head">
        <h3>{copy.folders}</h3>
        <span>{copy.lastDays(folders[0].days.length)}</span>
      </header>
      <ul>
        {shown.map((f) => {
          const Icon = f.name === null ? FolderOpen : Folder;
          return (
            <li key={f.name ?? ""}>
              <button type="button" className="rd-folder" aria-pressed={isSelected(f)} onClick={() => onSelect(f.name)}>
                <span className="rd-folder-top">
                  <Icon size={16} aria-hidden="true" />
                  <span className="rd-folder-name">{f.name ?? copy.noFolder}</span>
                  <span className="rd-folder-last">{lastLabel(f.lastAt, now, locale, copy)}</span>
                </span>
                <span className="rd-folder-mid">
                  <span className="rd-folder-days" aria-hidden="true">
                    {f.days.map((count, i) => (
                      <span key={i} className="rd-cal-swatch" data-level={densityLevel(count, maxDay)} />
                    ))}
                  </span>
                  <span className="rd-folder-who" aria-hidden="true">
                    {f.who.self && <WhoMark type="self" />}
                    {f.who.ai && <WhoMark type="ai" />}
                    {f.who.other && <WhoMark type="other" />}
                  </span>
                  <span className="rd-folder-count">{copy.count(f.count)}</span>
                </span>
                {f.checklist && (
                  <span className="rd-folder-check" data-open={f.checklist.open > 0 ? "true" : undefined}>
                    <ListChecks size={14} aria-hidden="true" />
                    {f.checklist.open > 0 ? copy.unchecked(f.checklist.open, f.checklist.total) : copy.allChecked(f.checklist.total)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {(rest > 0 || open) && folders.length > FOLDERS_FOLDED && (
        <button type="button" className="rd-folders-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? copy.fewer : copy.moreFolders(rest)}
        </button>
      )}
    </section>
  );
}
