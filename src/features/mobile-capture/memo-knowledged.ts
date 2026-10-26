// メモのナレッジ化の記録（knowledgedInto）。capture-store.ts は storage registry に依存するため、
// Node（MCP の start_claim_task → submit_claims）からも使えるよう純関数だけをここに置く。

import type { CaptureIndex } from "./capture-store";

/** メモのナレッジ化記録を追加（同じノートへの重複記録は防ぐ） */
export function recordMemoKnowledged(
  index: CaptureIndex,
  captureId: string,
  noteId: string,
  noteTitle: string,
): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const knowledgedInto = c.knowledgedInto ?? [];
      // 同じノートへの重複記録を防ぐ
      if (knowledgedInto.some((k) => k.noteId === noteId)) return c;
      return {
        ...c,
        knowledgedInto: [
          ...knowledgedInto,
          { noteId, noteTitle, knowledgedAt: new Date().toISOString() },
        ],
      };
    }),
  };
}

