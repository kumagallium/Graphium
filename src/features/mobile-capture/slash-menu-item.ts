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
    // ラベルは getter で遅延評価する。呼び出し側は生成した項目を useMemo で保持するため、
    // ここで t() を即時評価すると言語を切り替えても古いラベルが残る。
    get title() { return t("memo.slashTitle"); },
    get subtext() { return t("memo.slashSub"); },
    get group() { return t("asset.slashGroup"); },
    aliases: ["memo", "メモ", "めも", "sticky", "付箋"],
    onItemClick: (editor: any) => {
      _memoPickerCallbacks.get(editor)?.();
    },
  };
}
