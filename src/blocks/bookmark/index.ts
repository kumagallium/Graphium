import { BookmarkBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";
import { openBookmarkPicker } from "./callbacks";

// コールバックレジストリは callbacks.ts に分離（view.tsx との循環 import 回避）。
// 外部向けには従来どおりここから再エクスポートする。
export { setBookmarkPickerCallback, setBookmarkPeekCallback, openBookmarkPeek } from "./callbacks";

// ブロック登録エントリー
export const bookmarkBlock: CustomBlockEntry = {
  type: "bookmark",
  spec: BookmarkBlock,
};

// スラッシュメニュー用アイテム（ピッカーモーダルを開く）
export const bookmarkSlashItem = {
  title: t("slash.bookmark"),
  subtext: t("slash.bookmarkSub"),
  group: t("asset.slashGroup"),
  onItemClick: (editor: any) => {
    openBookmarkPicker(editor);
  },
  aliases: ["bookmark", "link", "url", "ブックマーク", "リンク"],
};
