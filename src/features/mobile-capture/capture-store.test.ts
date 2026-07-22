// capture-store の CRUD 操作と sourceAsset 保持のテスト
// PR3-a で追加した sourceAsset フィールドが optional に保たれ、
// 旧データ（sourceAsset 未設定）を読み込んでも壊れないことを担保する。

import { describe, it, expect } from "vitest";
import {
  addCapture,
  createEmptyCaptureIndex,
  recordMemoUsage,
  recordMemoKnowledged,
  archiveCapture,
  restoreCaptureFromArchive,
  trashCapture,
  restoreCaptureFromTrash,
  sendCaptureArchiveToTrash,
  getActiveCaptures,
  getArchivedCaptures,
  getTrashedCaptures,
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

describe("recordMemoKnowledged", () => {
  const base: CaptureIndex = {
    version: 1,
    updatedAt: "2026-07-22T10:00:00.000Z",
    captures: [{ id: "cap_1", text: "ある知見のメモ", createdAt: "2026-07-22T09:00:00.000Z" }],
  };

  it("ナレッジ化先ノートを逆リンクとして記録する", () => {
    const updated = recordMemoKnowledged(base, "cap_1", "note_9", "生成されたノート");
    expect(updated.captures[0].knowledgedInto).toHaveLength(1);
    expect(updated.captures[0].knowledgedInto?.[0]).toMatchObject({
      noteId: "note_9",
      noteTitle: "生成されたノート",
    });
    expect(updated.captures[0].knowledgedInto?.[0].knowledgedAt).toBeTruthy();
  });

  it("同じノートへの重複記録は防ぐ", () => {
    const once = recordMemoKnowledged(base, "cap_1", "note_9", "生成されたノート");
    const twice = recordMemoKnowledged(once, "cap_1", "note_9", "生成されたノート");
    expect(twice.captures[0].knowledgedInto).toHaveLength(1);
  });

  it("別ノートへのナレッジ化は追記される", () => {
    const once = recordMemoKnowledged(base, "cap_1", "note_9", "ノートA");
    const twice = recordMemoKnowledged(once, "cap_1", "note_10", "ノートB");
    expect(twice.captures[0].knowledgedInto?.map((k) => k.noteId)).toEqual(["note_9", "note_10"]);
  });
});

describe("archive / trash のライフサイクル", () => {
  const base: CaptureIndex = {
    version: 1,
    updatedAt: "2026-07-22T10:00:00.000Z",
    captures: [
      { id: "a", text: "メモA", createdAt: "2026-07-22T01:00:00.000Z" },
      { id: "b", text: "メモB", createdAt: "2026-07-22T02:00:00.000Z" },
      { id: "c", text: "メモC", createdAt: "2026-07-22T03:00:00.000Z" },
    ],
  };

  it("archiveCapture は archivedAt をセットし、restore で解除する", () => {
    const archived = archiveCapture(base, "a");
    expect(archived.captures.find((c) => c.id === "a")?.archivedAt).toBeTruthy();
    const restored = restoreCaptureFromArchive(archived, "a");
    expect(restored.captures.find((c) => c.id === "a")?.archivedAt).toBeUndefined();
  });

  it("trashCapture は deletedAt をセットし、restore で解除する", () => {
    const trashed = trashCapture(base, "b");
    expect(trashed.captures.find((c) => c.id === "b")?.deletedAt).toBeTruthy();
    const restored = restoreCaptureFromTrash(trashed, "b");
    expect(restored.captures.find((c) => c.id === "b")?.deletedAt).toBeUndefined();
  });

  it("sendCaptureArchiveToTrash は archivedAt を解除して deletedAt に付け替える", () => {
    const archived = archiveCapture(base, "c");
    const moved = sendCaptureArchiveToTrash(archived, "c");
    const entry = moved.captures.find((c) => c.id === "c");
    expect(entry?.archivedAt).toBeUndefined();
    expect(entry?.deletedAt).toBeTruthy();
  });

  it("getActive/Archived/Trashed はステータスで振り分ける", () => {
    let index = archiveCapture(base, "a");
    index = trashCapture(index, "b");
    expect(getActiveCaptures(index).map((c) => c.id)).toEqual(["c"]);
    expect(getArchivedCaptures(index).map((c) => c.id)).toEqual(["a"]);
    expect(getTrashedCaptures(index).map((c) => c.id)).toEqual(["b"]);
  });

  it("アーカイブ済みメモは active にもゴミ箱にも出ない", () => {
    const index = archiveCapture(base, "a");
    expect(getActiveCaptures(index).some((c) => c.id === "a")).toBe(false);
    expect(getTrashedCaptures(index).some((c) => c.id === "a")).toBe(false);
    expect(getArchivedCaptures(index).some((c) => c.id === "a")).toBe(true);
  });
});
