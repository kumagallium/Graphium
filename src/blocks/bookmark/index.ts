import { BookmarkBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const bookmarkBlock: CustomBlockEntry = {
  type: "bookmark",
  spec: BookmarkBlock,
};

// スラッシュメニューからピッカーを開くグローバルコールバック
let bookmarkPickerCallback: (() => void) | null = null;

export function setBookmarkPickerCallback(cb: (() => void) | null) {
  bookmarkPickerCallback = cb;
}

// スラッシュメニュー用アイテム（ピッカーモーダルを開く）
export const bookmarkSlashItem = {
  title: t("slash.bookmark"),
  subtext: t("slash.bookmarkSub"),
  group: t("asset.slashGroup"),
  onItemClick: () => {
    bookmarkPickerCallback?.();
  },
  aliases: ["bookmark", "link", "url", "ブックマーク", "リンク"],
};
