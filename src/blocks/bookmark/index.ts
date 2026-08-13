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
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.bookmark"); },
  get subtext() { return t("slash.bookmarkSub"); },
  get group() { return t("asset.slashGroup"); },
  onItemClick: (editor: any) => {
    openBookmarkPicker(editor);
  },
  aliases: ["bookmark", "link", "url", "ブックマーク", "リンク"],
};
