import { HelloBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";

// ブロック登録エントリー
// SandboxEditor の blocks に渡す
export const helloBlock: CustomBlockEntry = {
  type: "hello",
  spec: HelloBlock,
};

// スラッシュメニュー用の挿入アイテム
export const helloSlashItem = {
  title: "Hello Block",
  subtext: "サンプルのカスタムブロックを挿入",
  group: "実験ブロック",
  onItemClick: (editor: any) => {
    editor.insertBlocks(
      [{ type: "hello", props: { name: "eureco" } }],
      editor.getTextCursorPosition().block,
      "after"
    );
  },
  aliases: ["hello", "sample"],
};
