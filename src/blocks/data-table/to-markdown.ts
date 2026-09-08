// データ表 → Markdown（純ロジック）
//
// 行の実体は素材にあり、ここは同期でしか呼ばれない。本文が既に読めていれば
// 先頭の数十行を普通の Markdown 表として出し、残りは「元ファイルを参照」の 1 行で
// 示す。全行を出さないのは、AI が読む本文やエクスポートが数千行の数字で埋まると
// 肝心の文章が薄まるため。まだ読めていなければ、表があった痕跡だけを斜体で残す
// （静かに落とすと、図が消えたことに気づけないのと同じ問題になる）。

import { t } from "../../i18n";
import { textParagraph, type BlockToMarkdown, type MarkdownBlock } from "../markdown-block";
import { defaultCaption } from "../../features/data-import/to-table-block";
import { peekDataTable } from "./data";
import { parseDataTableSource } from "./model";

/** Markdown に出すデータ行の上限 */
export const DATA_TABLE_EXPORT_ROW_LIMIT = 50;

type InlineText = { type: "text"; text: string; styles: Record<string, never> };

function cell(text: string): InlineText[] {
  return text === "" ? [] : [{ type: "text", text, styles: {} }];
}

function tableBlock(headers: string[], rows: string[][]): MarkdownBlock {
  return {
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      rows: [
        { cells: headers.map(cell) },
        ...rows.map((r) => ({ cells: headers.map((_, i) => cell(r[i] ?? "")) })),
      ],
    },
    children: [],
  };
}

export const dataTableToMarkdown: BlockToMarkdown = (block, ctx) => {
  const source = parseDataTableSource(block.props?.source);
  if (!source) return [...ctx.children];
  const caption = String(block.props?.caption ?? "").trim() || defaultCaption(source.fileName);
  const data = peekDataTable(source);
  const out: MarkdownBlock[] = [
    textParagraph(
      t("dataTable.exportHeading", { caption, fileName: source.fileName }),
      { italic: true },
    ),
  ];
  if (data && data.headers.length > 0) {
    out.push(tableBlock(data.headers, data.rows.slice(0, DATA_TABLE_EXPORT_ROW_LIMIT)));
    if (data.rows.length > DATA_TABLE_EXPORT_ROW_LIMIT) {
      out.push(
        textParagraph(
          t("dataTable.exportMore", {
            count: String(data.rows.length - DATA_TABLE_EXPORT_ROW_LIMIT),
            fileName: source.fileName,
          }),
          { italic: true },
        ),
      );
    }
  } else {
    out.push(textParagraph(t("dataTable.exportSummary", { fileName: source.fileName }), { italic: true }));
  }
  return [...out, ...ctx.children];
};
