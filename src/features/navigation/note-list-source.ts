// ノート一覧のデータソース抽象化
// インデックスファイルから取得する IndexFileNoteListSource を使用

import { buildKnowledgeMap, type GraphiumIndex, type NoteIndexEntry } from "./index-file";

export type NoteListEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  labels: string[];
  incomingLinkCount: number;
  outgoingLinkCount: number;
  /** 作者 (username)。LLM 経由で書き込まれたノートで値が入る */
  author?: string;
  /** 書記役 LLM のモデル ID (例: claude-opus-4-7) */
  model?: string;
  /** このノートを派生元として参照する wiki エントリ数（Knowledge 化済みインジケータ用） */
  knowledgeCount: number;
  /** 主要な派生 wiki エントリ ID（一覧の Knowledge アイコンからのジャンプ先） */
  primaryKnowledgeWikiId?: string;
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

    // 通常ノート ID → 派生 wiki エントリ配列の逆引き
    const knowledgeMap = buildKnowledgeMap(this.index);

    // AI ドキュメント（Wiki）はノート一覧から除外（AI Knowledge セクションで表示）
    return this.index.notes.filter((n) => n.source !== "ai").map((n) => {
      const wikiEntries = knowledgeMap.get(n.noteId) ?? [];
      return {
        noteId: n.noteId,
        title: n.title,
        modifiedAt: n.modifiedAt,
        createdAt: n.createdAt,
        labels: [...new Set(n.labels.map((l) => l.label))],
        incomingLinkCount: incomingMap.get(n.noteId)?.size ?? 0,
        outgoingLinkCount: outgoingMap.get(n.noteId) ?? 0,
        author: n.author,
        model: n.model,
        knowledgeCount: wikiEntries.length,
        primaryKnowledgeWikiId: wikiEntries[0]?.noteId,
      };
    });
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
