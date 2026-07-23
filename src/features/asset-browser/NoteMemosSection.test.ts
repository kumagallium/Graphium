// filterMemosByNote の挙動を担保する。
// 「ノートに紐づくメモ」は sourceNote.fileId の完全一致のみで判定し、
// 素材経由のメモ（sourceAsset 持ち）や、出典のないメモは混入しない。

import { describe, it, expect } from "vitest";
import { filterMemosByNote } from "./NoteMemosSection";
import type { CaptureIndex } from "../mobile-capture";

const NOTE_FILE_ID = "note:abc123";

function makeIndex(captures: CaptureIndex["captures"]): CaptureIndex {
  return { version: 1, updatedAt: "2026-05-27T10:00:00.000Z", captures };
}

describe("filterMemosByNote", () => {
  it("captureIndex が null のとき空配列を返す", () => {
    expect(filterMemosByNote(null, NOTE_FILE_ID)).toEqual([]);
  });

  it("noteFileId が空文字のとき空配列を返す", () => {
    const index = makeIndex([
      {
        id: "cap_1",
        text: "メモ",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID },
      },
    ]);
    expect(filterMemosByNote(index, "")).toEqual([]);
  });

  it("sourceNote.fileId が一致するメモを拾う", () => {
    const index = makeIndex([
      {
        id: "cap_match",
        text: "このノートに書いたメモ",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, title: "Test Note" },
      },
    ]);
    const result = filterMemosByNote(index, NOTE_FILE_ID);
    expect(result.map((c) => c.id)).toEqual(["cap_match"]);
  });

  it("別ノートの sourceNote は除外する", () => {
    const index = makeIndex([
      {
        id: "cap_other_note",
        text: "別ノートのメモ",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceNote: { fileId: "note:other" },
      },
    ]);
    expect(filterMemosByNote(index, NOTE_FILE_ID)).toEqual([]);
  });

  it("素材経由のメモ（sourceAsset のみ）は除外する", () => {
    const index = makeIndex([
      {
        id: "cap_asset",
        text: "PDF から作ったメモ",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceAsset: { fileId: "drive:pdf1", type: "pdf" },
      },
    ]);
    expect(filterMemosByNote(index, NOTE_FILE_ID)).toEqual([]);
  });

  it("出典のないメモは除外する", () => {
    const index = makeIndex([
      {
        id: "cap_orphan",
        text: "クイックキャプチャ",
        createdAt: "2026-05-27T10:00:00.000Z",
      },
    ]);
    expect(filterMemosByNote(index, NOTE_FILE_ID)).toEqual([]);
  });

  it("ブロック紐付きメモ（sourceNote.blockId あり）もノート単位のフィルタで拾う", () => {
    const index = makeIndex([
      {
        id: "cap_block",
        text: "ブロックへのメモ",
        createdAt: "2026-07-23T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID, blockId: "block-1", blockText: "対象ブロック" },
      },
    ]);
    const result = filterMemosByNote(index, NOTE_FILE_ID);
    expect(result.map((c) => c.id)).toEqual(["cap_block"]);
  });

  it("createdAt の新しい順に並ぶ", () => {
    const index = makeIndex([
      {
        id: "older",
        text: "古いメモ",
        createdAt: "2026-05-25T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID },
      },
      {
        id: "newer",
        text: "新しいメモ",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID },
      },
    ]);
    expect(filterMemosByNote(index, NOTE_FILE_ID).map((c) => c.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("ノート / 素材 / 別ノート / 出典なしが混在しても正しく抽出する", () => {
    const index = makeIndex([
      {
        id: "cap_note_match",
        text: "match",
        createdAt: "2026-05-27T12:00:00.000Z",
        sourceNote: { fileId: NOTE_FILE_ID },
      },
      {
        id: "cap_asset",
        text: "asset",
        createdAt: "2026-05-27T11:00:00.000Z",
        sourceAsset: { fileId: "drive:pdf1", type: "pdf" },
      },
      {
        id: "cap_other_note",
        text: "other",
        createdAt: "2026-05-27T10:00:00.000Z",
        sourceNote: { fileId: "note:other" },
      },
      {
        id: "cap_orphan",
        text: "orphan",
        createdAt: "2026-05-27T09:00:00.000Z",
      },
    ]);
    expect(filterMemosByNote(index, NOTE_FILE_ID).map((c) => c.id)).toEqual([
      "cap_note_match",
    ]);
  });
});
