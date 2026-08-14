// Markdown エクスポート機能（単一ノート）
// PDF / PROV-JSON-LD エクスポートと同じく、ノートヘッダメニューから呼ばれる。

import { downloadBlob } from "../../lib/download-file";
import { sanitizeFilename } from "./filenames";
import { buildMarkdownFileContent } from "./doc-to-markdown";
import { blocksToMarkdown, type MarkdownCapableEditor } from "./blocks-to-markdown";

export type { MarkdownCapableEditor };

/**
 * 現在開いているノートを Markdown ファイルとしてエクスポートする。
 * タイトルは H1 としてファイル先頭に付ける（タイトルはブロック外に保存されているため）。
 * 内部リンク（@メンション）は Obsidian 互換の [[タイトル]] に変換して書き出す
 * （markdown-import が同じ表記を解決するので、エクスポート→再インポートで対称）。
 */
export async function exportNoteToMarkdown(options: {
  title: string;
  editor: MarkdownCapableEditor;
}): Promise<void> {
  const { title, editor } = options;
  const markdown = await blocksToMarkdown(editor, editor.document);
  const content = buildMarkdownFileContent(title, markdown);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  await downloadBlob(blob, `${sanitizeFilename(title)}.md`);
}
