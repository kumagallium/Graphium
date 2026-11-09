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
  /** 選択肢（省くと設定の一覧）。移す先のように一部だけ見せるときに渡す */
  folders?: SharedFolder[];
  /** 1 件でも描く（移す先が 1 つだけでも、どこへ移すかは見せる） */
  alwaysShow?: boolean;
};

export function SharedFolderPicker({ value, onChange, label, disabled, folders, alwaysShow }: SharedFolderPickerProps) {
  const { t } = useLocale();
  const list = folders ?? listShareableFolders();
  const defaultRoot = listShareableFolders()[0]?.root;
  if (list.length === 0 || (list.length < 2 && !alwaysShow)) return null;
  return (
    <fieldset className="space-y-1" data-testid="shared-folder-picker" disabled={disabled}>
      <legend className="text-xs text-muted-foreground mb-1">{label ?? t("share.folder.label")}</legend>
      {list.map((f) => (
        <label
          key={f.id}
          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${
            value === f.root ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
          }`}
        >
          {/* ラジオは名前の行（leading-5 = 20px）の高さの中で縦の中央に置く。
              mt で寄せると、日本語の字形で行の高さが変わったときにずれる（利用者の指摘 2026-11-06） */}
          <span className="flex items-center h-5 shrink-0">
            <input
              type="radio"
              name="shared-folder"
              value={f.root}
              checked={value === f.root}
              onChange={() => onChange(f.root)}
              className="m-0 accent-primary"
            />
          </span>
          <span className="min-w-0">
            <span className="block text-sm leading-5 text-foreground">
              {sharedFolderLabel(f)}
              {f.root === defaultRoot && (
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

export type SharedFolderMultiPickerProps = {
  /** 選ばれている共有フォルダのパス（並びは登録順に揃えて返す） */
  values: string[];
  onChange: (roots: string[]) => void;
  label?: string;
  disabled?: boolean;
  /** テスト / Storybook 用。省くと設定の一覧を読む */
  folders?: SharedFolder[];
};

/**
 * 共有先を複数選ぶ欄（テンプレートの共有だけで使う）。
 *
 * テンプレートは共有するたびに新しい封筒になり、元のノートの共有状態とも結び付かないので、
 * 選んだフォルダの数だけ独立したコピーを置ける。ノート・ナレッジ・素材は 1 か所にしか置けない
 * （共有コピーを 1 つしか覚えない）ので、こちらは使わずラジオの SharedFolderPicker のまま。
 * 2 件以上のときだけ描く（1 件なら選ぶものが無い）。
 */
export function SharedFolderMultiPicker({ values, onChange, label, disabled, folders }: SharedFolderMultiPickerProps) {
  const { t } = useLocale();
  const list = folders ?? listShareableFolders();
  const defaultRoot = listShareableFolders()[0]?.root;
  if (list.length < 2) return null;
  const toggle = (root: string, on: boolean) => {
    const next = new Set(values);
    if (on) next.add(root);
    else next.delete(root);
    // 登録順に揃える（共有の順番・結果の並びが毎回同じになるように）
    onChange(list.map((f) => f.root).filter((r) => next.has(r)));
  };
  return (
    <fieldset className="space-y-1" data-testid="shared-folder-multi-picker" disabled={disabled}>
      <legend className="text-xs text-muted-foreground mb-1">{label ?? t("share.folder.labelMulti")}</legend>
      {list.map((f) => {
        const checked = values.includes(f.root);
        return (
          <label
            key={f.id}
            className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${
              checked ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
            }`}
          >
            {/* 名前の行（leading-5）の高さの中で縦の中央に置く（ラジオの欄と同じ作法） */}
            <span className="flex items-center h-5 shrink-0">
              <input
                type="checkbox"
                value={f.root}
                checked={checked}
                onChange={(e) => toggle(f.root, e.target.checked)}
                className="m-0 accent-primary"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm leading-5 text-foreground">
                {sharedFolderLabel(f)}
                {f.root === defaultRoot && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{t("settings.sharedFolders.defaultBadge")}</span>
                )}
              </span>
              <span className="block text-[11px] font-mono text-muted-foreground break-all">{f.root}</span>
            </span>
          </label>
        );
      })}
      <p className="text-[11px] text-muted-foreground">{t("share.folder.hintMulti")}</p>
    </fieldset>
  );
}
