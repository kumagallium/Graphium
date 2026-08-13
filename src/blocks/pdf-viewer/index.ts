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
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.pdf"); },
  get subtext() { return t("slash.pdfSub"); },
  get group() { return t("asset.slashGroup"); },
  onItemClick: (editor: any) => {
    editor.insertBlocks(
      [{ type: "pdf", props: { url: "", name: "" } }],
      editor.getTextCursorPosition().block,
      "after",
    );
  },
  aliases: ["pdf", "document", "paper"],
};
