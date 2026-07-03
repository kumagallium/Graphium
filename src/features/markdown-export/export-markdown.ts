// Markdown エクスポート機能（単一ノート）
// PDF / PROV-JSON-LD エクスポートと同じく、ノートヘッダメニューから呼ばれる。
// ライブエディタ（フルスキーマでマウント済み）の blocksToMarkdownLossy を使うので、
// カスタムブロックも BlockNote 側の外部 HTML 変換を経由してそのまま変換できる。

import { downloadBlob } from "../../lib/download-file";
import { sanitizeFilename } from "./filenames";
import { buildMarkdownFileContent } from "./doc-to-markdown";

/** エディタに要求する最小インターフェース（BlockNoteEditor 互換） */
export type MarkdownCapableEditor = {
  document: any[];
  blocksToMarkdownLossy(blocks?: any[]): Promise<string>;
};

/**
 * 現在開いているノートを Markdown ファイルとしてエクスポートする。
 * タイトルは H1 としてファイル先頭に付ける（タイトルはブロック外に保存されているため）。
 */
export async function exportNoteToMarkdown(options: {
  title: string;
  editor: MarkdownCapableEditor;
}): Promise<void> {
  const { title, editor } = options;
  const markdown = await editor.blocksToMarkdownLossy(editor.document);
  const content = buildMarkdownFileContent(title, markdown);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  await downloadBlob(blob, `${sanitizeFilename(title)}.md`);
}
