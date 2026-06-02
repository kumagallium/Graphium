// スラッシュメニュー: メモから挿入
// /memo でメモピッカーを開く

import { t } from "../../i18n";
import type { SlashMenuItem } from "../../base/slash-menu-types";

// メモピッカーを開くコールバック。エディタ単位で登録する
// （main editor / SidePeek / list-SidePeek の各々が自分用のピッカーを持つ）。
const _memoPickerCallbacks = new WeakMap<object, () => void>();

export function setMemoPickerCallback(editor: any, fn: (() => void) | null) {
  if (!editor) return;
  if (fn) _memoPickerCallbacks.set(editor, fn);
  else _memoPickerCallbacks.delete(editor);
}

/** スラッシュメニューに追加するメモ挿入アイテム */
export function getMemoSlashMenuItem(): SlashMenuItem {
  return {
    title: t("memo.slashTitle"),
    subtext: t("memo.slashSub"),
    group: t("asset.slashGroup"),
    aliases: ["memo", "メモ", "めも", "sticky", "付箋"],
    onItemClick: (editor: any) => {
      _memoPickerCallbacks.get(editor)?.();
    },
  };
}
