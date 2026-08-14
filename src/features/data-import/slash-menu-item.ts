// スラッシュメニュー: データを取り込む
//
// ファイル選択 → 取り込みダイアログ。コールバックをエディタ単位で持つのは
// asset-browser/slash-menu-items.ts と同じ理由（main / SidePeek がそれぞれ
// 自分のダイアログを開けるようにするため）。

import { t } from "../../i18n";
import type { SlashMenuItem } from "../../base/slash-menu-types";

const _callbacks = new WeakMap<object, () => void>();

export function setDataImportCallback(editor: any, fn: (() => void) | null) {
  if (!editor) return;
  if (fn) _callbacks.set(editor, fn);
  else _callbacks.delete(editor);
}

export function getDataImportSlashMenuItem(): SlashMenuItem {
  return {
    // ラベルは getter で遅延評価する（useMemo に保持されるため、即時評価すると
    // 言語を切り替えても古いラベルが残る）
    get title() { return t("dataImport.slashTitle"); },
    get subtext() { return t("dataImport.slashSub"); },
    get group() { return t("dataImport.slashGroup"); },
    aliases: [
      "data", "csv", "tsv", "dat", "import",
      "データ", "でーた", "取り込み", "とりこみ", "計測", "実験データ",
    ],
    onItemClick: (editor: any) => {
      _callbacks.get(editor)?.();
    },
  };
}
