// /template スラッシュメニューアイテム

import { t } from "../../i18n";

// テンプレートピッカーを開くグローバルコールバック（スラッシュ発火時のブロックを渡す）
// note-app.tsx 側で登録する
let _openTemplatePickerCallback: ((triggerBlock: any) => void) | null = null;

export function setTemplatePickerCallback(fn: ((triggerBlock: any) => void) | null) {
  _openTemplatePickerCallback = fn;
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
      _openTemplatePickerCallback?.(currentBlock);
    },
  };
}
