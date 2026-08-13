// shared:// 引用ブロックの登録エントリー・スラッシュメニュー・挿入 helper。

import type { CustomBlockEntry } from "../../base/schema";
import type { SharedEntry } from "../../lib/storage/shared";
import { t } from "../../i18n";
import { SharedCitationBlockSpec } from "./view";
import { entryToBlockProps } from "./props";
import { openSharedCitePicker } from "./callbacks";

export {
  setSharedCitePickerCallback,
  setSharedEntryOpenCallback,
  openSharedEntry,
} from "./callbacks";
export { entryToBlockProps, entryToCachedProps } from "./props";
export { resolveCitation } from "./resolve";

// ブロック登録エントリー
export const sharedCitationBlock: CustomBlockEntry = {
  type: "sharedCitation",
  spec: SharedCitationBlockSpec,
};

// スラッシュメニュー用アイテム（共有エントリピッカーを開く）。
// 共有ストレージはデスクトップ限定機能のため、組み込み側（note-app / side-peek）で
// isTauri() のときだけメニューに加える。
export const sharedCitationSlashItem = {
  title: t("slash.sharedCitation"),
  subtext: t("slash.sharedCitationSub"),
  group: t("cite.slashGroup"),
  onItemClick: (editor: any) => {
    openSharedCitePicker(editor);
  },
  aliases: [
    "shared",
    "cite",
    "citation",
    "共有",
    "きょうゆう",
    "kyoyu",
    "引用",
    "いんよう",
    "inyo",
  ],
};

/**
 * ピッカーで選ばれた共有エントリをカーソル位置に引用ブロックとして挿入する。
 * callout と同じ流儀: カーソル行の after に挿入し、カーソル行が空（スラッシュ
 * コマンドの残骸のみ）なら削除して置き換える。
 */
export function insertSharedCitations(editor: any, entries: SharedEntry[]): void {
  if (!editor || entries.length === 0) return;
  const blocks = entries.map((entry) => ({
    type: "sharedCitation" as const,
    props: entryToBlockProps(entry),
  }));
  const currentBlock = editor.getTextCursorPosition().block;
  editor.insertBlocks(blocks, currentBlock, "after");

  const content = currentBlock.content;
  const isEmpty =
    Array.isArray(content) &&
    content.length <= 1 &&
    (!content[0] ||
      (content[0].type === "text" &&
        content[0].text.replace("/", "").trim() === ""));
  if (isEmpty) {
    editor.removeBlocks([currentBlock]);
  }
}
