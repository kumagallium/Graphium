import { PdfViewerBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";

// ブロック登録エントリー
// SandboxEditor の blocks に渡す
export const pdfViewerBlock: CustomBlockEntry = {
  type: "pdf",
  spec: PdfViewerBlock,
};

// スラッシュメニュー用の挿入アイテム
export const pdfSlashItem = {
  title: "PDF",
  subtext: "PDF ファイルを埋め込み表示",
  group: "メディア",
  onItemClick: (editor: any) => {
    editor.insertBlocks(
      [{ type: "pdf", props: { url: "", name: "" } }],
      editor.getTextCursorPosition().block,
      "after",
    );
  },
  aliases: ["pdf", "document", "paper"],
};
