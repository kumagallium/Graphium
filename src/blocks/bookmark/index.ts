import { BookmarkBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const bookmarkBlock: CustomBlockEntry = {
  type: "bookmark",
  spec: BookmarkBlock,
};

// ブックマークピッカーを開くコールバック。エディタ単位で登録する
// （main editor / SidePeek / list-SidePeek の各々が自分用のピッカーを持つ）。
const bookmarkPickerCallbacks = new WeakMap<object, () => void>();

export function setBookmarkPickerCallback(editor: any, cb: (() => void) | null) {
  if (!editor) return;
  if (cb) bookmarkPickerCallbacks.set(editor, cb);
  else bookmarkPickerCallbacks.delete(editor);
}

// ブックマークをサイドピークで開くコールバック。エディタ単位で登録する
// （main editor / SidePeek / list-SidePeek の各々が自分用の開き手を持つ）。
const bookmarkPeekCallbacks = new WeakMap<object, (url: string) => void>();

export function setBookmarkPeekCallback(editor: any, cb: ((url: string) => void) | null) {
  if (!editor) return;
  if (cb) bookmarkPeekCallbacks.set(editor, cb);
  else bookmarkPeekCallbacks.delete(editor);
}

// 登録済みなら true を返してサイドピークを開く。未登録なら false（呼び出し側で外部リンクにフォールバック）。
export function openBookmarkPeek(editor: any, url: string): boolean {
  if (!editor) return false;
  const cb = bookmarkPeekCallbacks.get(editor);
  if (!cb) return false;
  cb(url);
  return true;
}

// スラッシュメニュー用アイテム（ピッカーモーダルを開く）
export const bookmarkSlashItem = {
  title: t("slash.bookmark"),
  subtext: t("slash.bookmarkSub"),
  group: t("asset.slashGroup"),
  onItemClick: (editor: any) => {
    bookmarkPickerCallbacks.get(editor)?.();
  },
  aliases: ["bookmark", "link", "url", "ブックマーク", "リンク"],
};
