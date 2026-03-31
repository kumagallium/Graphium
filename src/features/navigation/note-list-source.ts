// ノート一覧のデータソース抽象化
// Phase 1-3: Drive 直接走査。将来: インデックスファイルに移行可能

import type { ProvNoteFile, ProvNoteDocument } from "../../lib/google-drive";

export type NoteListEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  labels: string[];
  incomingLinkCount: number;
};

export interface NoteListSource {
  loadNoteList(): Promise<NoteListEntry[]>;
}

// Drive キャッシュを走査してノート一覧を構築
export class DriveDirectNoteListSource implements NoteListSource {
  constructor(
    private files: ProvNoteFile[],
    private docCache: Map<string, ProvNoteDocument>,
  ) {}

  async loadNoteList(): Promise<NoteListEntry[]> {
    // 各ノートのメタデータを抽出
    const entries: NoteListEntry[] = [];
    // 被参照カウント用: noteId → 参照元ノートID の Set
    const incomingMap = new Map<string, Set<string>>();

    for (const file of this.files) {
      const doc = this.docCache.get(file.id);
      if (!doc) continue;

      const page = doc.pages[0];
      if (!page) continue;

      // ユニークなラベル名
      const labels = [...new Set(Object.values(page.labels || {}))];

      entries.push({
        noteId: file.id,
        title: doc.title,
        modifiedAt: file.modifiedTime,
        createdAt: file.createdTime,
        labels,
        incomingLinkCount: 0,
      });

      // 出力リンクを収集（noteLinks + knowledgeLinks + indexTables）
      const outgoing = new Set<string>();

      if (doc.noteLinks) {
        for (const link of doc.noteLinks) {
          outgoing.add(link.targetNoteId);
        }
      }
      if (page.knowledgeLinks) {
        for (const link of page.knowledgeLinks) {
          if (link.targetNoteId) outgoing.add(link.targetNoteId);
        }
      }
      if (page.indexTables) {
        for (const linkedNotes of Object.values(page.indexTables)) {
          for (const noteId of Object.values(linkedNotes)) {
            outgoing.add(noteId);
          }
        }
      }

      for (const targetId of outgoing) {
        if (!incomingMap.has(targetId)) {
          incomingMap.set(targetId, new Set());
        }
        incomingMap.get(targetId)!.add(file.id);
      }
    }

    // 被参照数を設定
    for (const entry of entries) {
      entry.incomingLinkCount = incomingMap.get(entry.noteId)?.size ?? 0;
    }

    return entries;
  }
}
