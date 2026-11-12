// ノート一覧のデータソース抽象化
// インデックスファイルから取得する IndexFileNoteListSource を使用

import { buildKnowledgeMap, type GraphiumIndex, type NoteIndexEntry } from "./index-file";
import { buildLinkCounts, linkCountsOf } from "./link-counts";

export type NoteListEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  labels: string[];
  /** ユーザーが手で付ける文脈ラベル（v21）。未付与は空配列。 */
  noteContexts: string[];
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
  /** OCR 画像ブロックから抽出したテキスト（一覧のテキスト検索対象） */
  ocrText?: string;
};

export interface NoteListSource {
  loadNoteList(): Promise<NoteListEntry[]>;
}

// インデックスファイルからノート一覧を構築
export class IndexFileNoteListSource implements NoteListSource {
  constructor(private index: GraphiumIndex) {}

  async loadNoteList(): Promise<NoteListEntry[]> {
    // 参照先・被参照はナレッジ一覧と同じ規則で数える（link-counts.ts）。このノートから作った
    // 知見は出典として必ずこのノートへリンクするが、それは被参照には数えない — 本アイコンの
    // 列（knowledgeCount）が同じ数を出しているので、数えると 2 列に同じ数字が並ぶ
    const linkCounts = buildLinkCounts(this.index);

    // 通常ノート ID → 派生 wiki エントリ配列の逆引き
    const knowledgeMap = buildKnowledgeMap(this.index);

    // AI ドキュメント（Wiki）はノート一覧から除外（AI Knowledge セクションで表示）
    return this.index.notes.filter((n) => n.source !== "ai").map((n) => {
      const wikiEntries = knowledgeMap.get(n.noteId) ?? [];
      // Phase D-3-α: block-level labels と inlineLabels を統合する。
      // フィルタ UI は単一の文字列配列を見ているので、material/tool/attribute/output の
      // 出処（block ラベル / インライン style / メディアサイドストア）を区別しない。
      const labelSet = new Set<string>(n.labels.map((l) => l.label));
      if (n.inlineLabels) {
        for (const il of n.inlineLabels) labelSet.add(il.label);
      }
      // step コンテナを持つノートは「Step」チップ / フィルタの対象にする。
      // v6 で procedure ラベルは step ブロックへ変換されたため、labels には現れない
      const hasSteps = (n.steps?.length ?? 0) > 0;
      if (hasSteps) labelSet.add("procedure");
      return {
        noteId: n.noteId,
        title: n.title,
        modifiedAt: n.modifiedAt,
        createdAt: n.createdAt,
        labels: Array.from(labelSet),
        noteContexts: n.noteContexts ?? [],
        incomingLinkCount: linkCountsOf(linkCounts, n.noteId).incoming,
        outgoingLinkCount: linkCountsOf(linkCounts, n.noteId).outgoing,
        author: n.author,
        model: n.model,
        knowledgeCount: wikiEntries.length,
        primaryKnowledgeWikiId: wikiEntries[0]?.noteId,
        ocrText: n.ocrText,
      };
    });
  }

  // バックリンク: 指定ノートを参照している全ノートを返す
  getBacklinks(noteId: string): NoteIndexEntry[] {
    return this.index.notes.filter((n) =>
      n.outgoingLinks.some((link) => link.targetNoteId === noteId)
    );
  }

  // タイトル + 見出し + step タイトル + OCR 画像テキストで検索
  searchNotes(query: string): NoteIndexEntry[] {
    const q = query.toLowerCase();
    return this.index.notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        [...n.headings, ...(n.steps ?? [])].some((h) =>
          h.text.toLowerCase().includes(q),
        ) ||
        (n.ocrText?.toLowerCase().includes(q) ?? false)
    );
  }
}
