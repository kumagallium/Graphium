// インデックステーブルの行からノートを作成するロジック

import { createFile, type ProvNoteDocument, type ProvNoteFile } from "../../lib/google-drive";

// テーブル行の1列目テキストを取得する
export function getFirstCellText(tableBlock: any, rowIndex: number): string {
  const rows = tableBlock.content?.rows;
  if (!rows || rowIndex >= rows.length) return "";

  const row = rows[rowIndex];
  const firstCell = row?.cells?.[0];
  if (!firstCell) return "";

  // BlockNote テーブルセル: インラインコンテンツの配列
  if (Array.isArray(firstCell)) {
    return firstCell
      .map((c: any) => (c.type === "text" ? c.text : c.text ?? ""))
      .join("")
      .trim();
  }

  // オブジェクト形式のフォールバック
  if (typeof firstCell === "object" && firstCell !== null) {
    if (firstCell.text) return firstCell.text.trim();
    if (Array.isArray(firstCell.content)) {
      return firstCell.content
        .map((c: any) => (typeof c === "string" ? c : c.text ?? ""))
        .join("")
        .trim();
    }
  }

  if (typeof firstCell === "string") return firstCell.trim();
  return "";
}

// ノートを作成して store の linkedNotes を更新する
export async function createNoteFromRow(
  editor: any,
  tableBlockId: string,
  rowIndex: number,
  files: ProvNoteFile[],
  store: { setLinkedNote: (blockId: string, sampleName: string, noteId: string) => void },
  onAddNoteLink?: (targetNoteId: string, sourceBlockId: string) => void,
): Promise<string | null> {
  const block = editor.getBlock(tableBlockId);
  if (!block) return null;

  const title = getFirstCellText(block, rowIndex);
  if (!title) return null;

  // 同名ノートが既にあるか確認
  const existing = files.find(
    (f) => f.name.replace(/\.provnote\.json$/, "") === title
  );
  if (existing) {
    const ok = confirm(`「${title}」という名前のノートが既に存在します。新しいノートを作成しますか？`);
    if (!ok) return null;
  }

  // 新規ノートドキュメントを構築
  const now = new Date().toISOString();
  const newDoc: ProvNoteDocument = {
    version: 2,
    title,
    pages: [
      {
        id: crypto.randomUUID(),
        title: "Main",
        blocks: [
          {
            type: "heading",
            props: { level: 1 },
            content: [{ type: "text", text: title }],
            children: [],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };

  // Google Drive に作成
  const fileId = await createFile(title, newDoc);

  // ストアの linkedNotes を更新
  store.setLinkedNote(tableBlockId, title, fileId);

  // 親ドキュメントに noteLink を追加（Graph 表示用）
  onAddNoteLink?.(fileId, tableBlockId);

  return fileId;
}
