import { PdfViewerBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
// SandboxEditor の blocks に渡す
export const pdfViewerBlock: CustomBlockEntry = {
  type: "pdf",
  spec: PdfViewerBlock,
};

// スラッシュメニュー用の挿入アイテム
export const pdfSlashItem = {
  title: t("slash.pdf"),
  subtext: t("slash.pdfSub"),
  group: t("asset.slashGroup"),
  onItemClick: (editor: any) => {
    editor.insertBlocks(
      [{ type: "pdf", props: { url: "", name: "" } }],
      editor.getTextCursorPosition().block,
      "after",
    );
  },
  aliases: ["pdf", "document", "paper"],
};
