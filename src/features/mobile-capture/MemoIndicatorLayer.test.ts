// countBlockMemos の挙動を担保する。
// ブロック紐付きメモ（sourceNote.blockId あり）だけを blockId ごとに数え、
// ノート単位のメモ（blockId なし）や別ノート・archive/trash 済みは含めない。

import { describe, it, expect } from "vitest";
import { countBlockMemos } from "./MemoIndicatorLayer";
import type { CaptureIndex } from "./capture-store";

const NOTE_FILE_ID = "note:abc123";
const BLOCK_A = "block-aaa";
const BLOCK_B = "block-bbb";

function makeIndex(captures: CaptureIndex["captures"]): CaptureIndex {
  return { version: 1, updatedAt: "2026-07-23T10:00:00.000Z", captures };
}

describe("countBlockMemos", () => {
  it("captureIndex が null / noteFileId が null のとき空 Map を返す", () => {
    expect(countBlockMemos(null, NOTE_FILE_ID).size).toBe(0);
    expect(countBlockMemos(makeIndex([]), null).size).toBe(0);
  });

  it("blockId 付きメモを blockId ごとに数える", () => {
    const index = makeIndex([
      {
        id: "cap_1",
        text: "ブロック A へのメモ 1",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: BLOCK_A, blockText: "対象" },
      },
      {
        id: "cap_2",
        text: "ブロック A へのメモ 2",
        createdAt: "2026-07-23T10:01:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: BLOCK_A },
      },
      {
        id: "cap_3",
        text: "ブロック B へのメモ",
        createdAt: "2026-07-23T10:02:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: BLOCK_B },
      },
    ]);
    const counts = countBlockMemos(index, NOTE_FILE_ID);
    expect(counts.get(BLOCK_A)).toBe(2);
    expect(counts.get(BLOCK_B)).toBe(1);
  });

  it("blockId のないノート単位メモは数えない", () => {
    const index = makeIndex([
      {
        id: "cap_note_level",
        text: "ノート単位のメモ",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID },
      },
    ]);
    expect(countBlockMemos(index, NOTE_FILE_ID).size).toBe(0);
  });

  it("別ノートの blockId 付きメモは数えない", () => {
    const index = makeIndex([
      {
        id: "cap_other",
        text: "別ノートのメモ",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: "note:other", blockId: BLOCK_A },
      },
    ]);
    expect(countBlockMemos(index, NOTE_FILE_ID).size).toBe(0);
  });

  it("archive / trash 済みメモは数えない（NoteMemosSection のフィルタと同じ基準）", () => {
    const index = makeIndex([
      {
        id: "cap_archived",
        text: "アーカイブ済み",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: BLOCK_A },
        archivedAt: "2026-07-23T11:00:00.000Z",
      },
      {
        id: "cap_trashed",
        text: "ゴミ箱送り",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: BLOCK_A },
        deletedAt: "2026-07-23T11:00:00.000Z",
      },
    ]);
    expect(countBlockMemos(index, NOTE_FILE_ID).size).toBe(0);
  });
});
