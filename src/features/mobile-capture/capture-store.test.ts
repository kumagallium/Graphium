// capture-store の CRUD 操作と sourceAsset 保持のテスト
// PR3-a で追加した sourceAsset フィールドが optional に保たれ、
// 旧データ（sourceAsset 未設定）を読み込んでも壊れないことを担保する。

import { describe, it, expect } from "vitest";
import {
  addCapture,
  createEmptyCaptureIndex,
  recordMemoUsage,
  type CaptureEntry,
  type CaptureIndex,
} from "./capture-store";

describe("addCapture", () => {
  it("sourceAsset 付きメモを追加できる", () => {
    const index = createEmptyCaptureIndex();
    const entry: CaptureEntry = {
      id: "cap_1",
      text: "実験の温度を 80℃ に上げると収率が改善する。\n\n— paper.pdf · p.3",
      createdAt: "2026-05-22T10:00:00.000Z",
      sourceAsset: { fileId: "drive:abc123", type: "pdf", pageNumber: 3 },
    };
    const updated = addCapture(index, entry);
    expect(updated.captures).toHaveLength(1);
    expect(updated.captures[0].sourceAsset).toEqual({
      fileId: "drive:abc123",
      type: "pdf",
      pageNumber: 3,
    });
  });

  it("sourceAsset なしのメモも従来通り追加できる（後方互換）", () => {
    const index = createEmptyCaptureIndex();
    const entry: CaptureEntry = {
      id: "cap_legacy",
      text: "モバイルで素早く書いた付箋",
      createdAt: "2026-05-22T10:00:00.000Z",
    };
    const updated = addCapture(index, entry);
    expect(updated.captures[0].sourceAsset).toBeUndefined();
  });

  it("新規メモは captures 先頭に追加される", () => {
    const initial: CaptureIndex = {
      version: 1,
      updatedAt: "2026-05-22T09:00:00.000Z",
      captures: [
        { id: "old", text: "過去のメモ", createdAt: "2026-05-21T00:00:00.000Z" },
      ],
    };
    const entry: CaptureEntry = {
      id: "new",
      text: "新しいメモ",
      createdAt: "2026-05-22T10:00:00.000Z",
    };
    const updated = addCapture(initial, entry);
    expect(updated.captures.map((c) => c.id)).toEqual(["new", "old"]);
  });
});

describe("recordMemoUsage", () => {
  it("sourceAsset と usedIn は共存できる", () => {
    const index: CaptureIndex = {
      version: 1,
      updatedAt: "2026-05-22T10:00:00.000Z",
      captures: [
        {
          id: "cap_1",
          text: "selection text\n\n— paper.pdf · p.3",
          createdAt: "2026-05-22T10:00:00.000Z",
          sourceAsset: { fileId: "drive:abc", type: "pdf", pageNumber: 3 },
        },
      ],
    };
    const updated = recordMemoUsage(index, "cap_1", "note_1", "実験ノート 2026-05-22");
    expect(updated.captures[0].sourceAsset).toEqual({
      fileId: "drive:abc",
      type: "pdf",
      pageNumber: 3,
    });
    expect(updated.captures[0].usedIn).toHaveLength(1);
    expect(updated.captures[0].usedIn?.[0].noteId).toBe("note_1");
  });
});
