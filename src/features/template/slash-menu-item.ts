// /template スラッシュメニューアイテム

import { t } from "../../i18n";

// テンプレートピッカーを開くコールバック（スラッシュ発火時のブロックを渡す）。
// エディタ単位で登録する（メインエディタと SidePeek がそれぞれ自分のピッカーを持つ。
// 登録は useTemplatePicker が行う）。項目は押されたエディタをキーに引くので、
// ピークで押せばピークのピッカーが開き、挿入先もピークのノートになる。
// 以前はモジュール変数 1 つに note-app が登録していたため、ピークに出すと
// メイン側のノートに書き込んでしまい、ピークには出せなかった。
const pickerCallbacks = new WeakMap<object, (triggerBlock: any) => void>();

export function setTemplatePickerCallback(
  editor: object | null | undefined,
  fn: ((triggerBlock: any) => void) | null,
): void {
  if (!editor) return;
  if (fn) pickerCallbacks.set(editor, fn);
  else pickerCallbacks.delete(editor);
}

export function getTemplateSlashMenuItem() {
  return {
    // ラベルは getter で遅延評価する。呼び出し側は生成した項目を useMemo で保持するため、
    // ここで t() を即時評価すると言語を切り替えても古いラベルが残る。
    get title() { return t("template.slash.title"); },
    get subtext() { return t("template.slash.sub"); },
    get group() { return t("slash.advancedGroup"); },
    aliases: [
      "template",
      "テンプレート",
      "てんぷれーと",
      "plan",
      "計画",
      "experiment",
      "実験",
    ],
    onItemClick: (editor: any) => {
      const currentBlock = editor.getTextCursorPosition().block;
      pickerCallbacks.get(editor)?.(currentBlock);
    },
  };
}
