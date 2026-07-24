import { ImageOcrBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー（SandboxEditor の blocks に渡す）
export const imageOcrBlock: CustomBlockEntry = {
  type: "imageOcr",
  spec: ImageOcrBlock,
};

// スラッシュメニュー用の挿入アイテム
// 空の imageOcr ブロックを挿入し、ブロック側のアップローダから画像を選ばせる
export const imageOcrSlashItem = {
  title: t("ocr.slashTitle"),
  subtext: t("ocr.slashSubtext"),
  group: t("ocr.slashGroup"),
  aliases: [
    "image",
    "ocr",
    "scan",
    "picture",
    "photo",
    "画像",
    "写真",
    "スキャン",
    "文字認識",
    "手書き",
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [{ type: "imageOcr" }],
      currentBlock,
      "after",
    );

    // 現在のブロックが空（スラッシュだけ）なら削除する
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" &&
          content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }

    return inserted;
  },
};
