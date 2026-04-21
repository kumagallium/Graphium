// ノート一覧のデータソース抽象化
// インデックスファイルから取得する IndexFileNoteListSource を使用

import type { GraphiumIndex, NoteIndexEntry } from "./index-file";

export type NoteListEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  labels: string[];
  incomingLinkCount: number;
  outgoingLinkCount: number;
};

export interface NoteListSource {
  loadNoteList(): Promise<NoteListEntry[]>;
}

// インデックスファイルからノート一覧を構築
export class IndexFileNoteListSource implements NoteListSource {
  constructor(private index: GraphiumIndex) {}

  async loadNoteList(): Promise<NoteListEntry[]> {
    // 被参照カウント用: noteId → 参照元ノートID の Set
    const incomingMap = new Map<string, Set<string>>();
    for (const note of this.index.notes) {
      for (const link of note.outgoingLinks) {
        if (!incomingMap.has(link.targetNoteId)) {
          incomingMap.set(link.targetNoteId, new Set());
        }
        incomingMap.get(link.targetNoteId)!.add(note.noteId);
      }
    }

    // outgoing: ユニークなターゲット数
    const outgoingMap = new Map<string, number>();
    for (const note of this.index.notes) {
      const uniqueTargets = new Set(note.outgoingLinks.map((l) => l.targetNoteId));
      outgoingMap.set(note.noteId, uniqueTargets.size);
    }

    // AI ドキュメント（Wiki）はノート一覧から除外（AI Knowledge セクションで表示）
    return this.index.notes.filter((n) => n.source !== "ai").map((n) => ({
      noteId: n.noteId,
      title: n.title,
      modifiedAt: n.modifiedAt,
      createdAt: n.createdAt,
      labels: [...new Set(n.labels.map((l) => l.label))],
      incomingLinkCount: incomingMap.get(n.noteId)?.size ?? 0,
      outgoingLinkCount: outgoingMap.get(n.noteId) ?? 0,
    }));
  }

  // バックリンク: 指定ノートを参照している全ノートを返す
  getBacklinks(noteId: string): NoteIndexEntry[] {
    return this.index.notes.filter((n) =>
      n.outgoingLinks.some((link) => link.targetNoteId === noteId)
    );
  }

  // タイトル + 見出しで検索
  searchNotes(query: string): NoteIndexEntry[] {
    const q = query.toLowerCase();
    return this.index.notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.headings.some((h) => h.text.toLowerCase().includes(q))
    );
  }
}
