import { HelloBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
// SandboxEditor の blocks に渡す
export const helloBlock: CustomBlockEntry = {
  type: "hello",
  spec: HelloBlock,
};

// スラッシュメニュー用の挿入アイテム
export const helloSlashItem = {
  title: t("slash.hello"),
  subtext: t("slash.helloSub"),
  group: t("slash.advancedGroup"),
  onItemClick: (editor: any) => {
    editor.insertBlocks(
      [{ type: "hello", props: { name: "eureco" } }],
      editor.getTextCursorPosition().block,
      "after"
    );
  },
  aliases: ["hello", "sample"],
};
