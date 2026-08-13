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
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.sharedCitation"); },
  get subtext() { return t("slash.sharedCitationSub"); },
  get group() { return t("cite.slashGroup"); },
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
