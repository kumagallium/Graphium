// 共有先（共有フォルダ）を選ぶ欄（§26 PR3）。
//
// 共有フォルダが 2 件以上あるときだけ意味がある。1 件なら何も描かない（呼び出し側は
// 既定の共有先へそのまま書けばよい）。初期値は既定の共有先（一覧の 1 件目）。
// 誰が読めるかはフォルダの権限が決めるので、名前だけでなく実パスも並べて見せる。

import { useLocale } from "../../i18n";
import { getSharedFolders, sharedFolderLabel, type SharedFolder } from "../../lib/storage/shared";

/** 選べる共有フォルダ（2 件以上のときだけ選ぶ意味がある） */
export function listShareableFolders(): SharedFolder[] {
  return getSharedFolders();
}

/** 共有先を選ばせる必要があるか（初回共有で、共有フォルダが 2 件以上） */
export function needsSharedFolderChoice(isReshare: boolean): boolean {
  return !isReshare && listShareableFolders().length > 1;
}

export type SharedFolderPickerProps = {
  /** 選ばれている共有フォルダのパス */
  value: string;
  onChange: (root: string) => void;
  /** 見出しの代わりに出す説明（まとめて共有で「新しく共有するものの置き場」と言い換える等） */
  label?: string;
  disabled?: boolean;
  /** テスト / Storybook 用。省くと設定の一覧を読む */
  folders?: SharedFolder[];
};

export function SharedFolderPicker({ value, onChange, label, disabled, folders }: SharedFolderPickerProps) {
  const { t } = useLocale();
  const list = folders ?? listShareableFolders();
  if (list.length < 2) return null;
  return (
    <fieldset className="space-y-1" data-testid="shared-folder-picker" disabled={disabled}>
      <legend className="text-xs text-muted-foreground mb-1">{label ?? t("share.folder.label")}</legend>
      {list.map((f, i) => (
        <label
          key={f.id}
          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${
            value === f.root ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
          }`}
        >
          <input
            type="radio"
            name="shared-folder"
            value={f.root}
            checked={value === f.root}
            onChange={() => onChange(f.root)}
            className="mt-0.5 accent-primary"
          />
          <span className="min-w-0">
            <span className="text-sm text-foreground">
              {sharedFolderLabel(f)}
              {i === 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">{t("settings.sharedFolders.defaultBadge")}</span>
              )}
            </span>
            <span className="block text-[11px] font-mono text-muted-foreground break-all">{f.root}</span>
          </span>
        </label>
      ))}
      <p className="text-[11px] text-muted-foreground">{t("share.folder.hint")}</p>
    </fieldset>
  );
}
