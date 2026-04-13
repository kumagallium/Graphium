// スラッシュメニュー: メモから挿入
// /memo でメモピッカーを開く

import { t } from "../../i18n";

// メモピッカーを開くグローバルコールバック（note-app.tsx で登録）
let _openMemoPickerCallback: (() => void) | null = null;

export function setMemoPickerCallback(fn: typeof _openMemoPickerCallback) {
  _openMemoPickerCallback = fn;
}

type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  onItemClick: (editor: any) => void;
};

/** スラッシュメニューに追加するメモ挿入アイテム */
export function getMemoSlashMenuItem(): SlashMenuItem {
  return {
    title: t("memo.slashTitle"),
    subtext: t("memo.slashSub"),
    group: t("asset.slashGroup"),
    aliases: ["memo", "メモ", "めも", "sticky", "付箋"],
    onItemClick: (_editor: any) => {
      _openMemoPickerCallback?.();
    },
  };
}
