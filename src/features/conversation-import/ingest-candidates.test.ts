import { describe, it, expect } from "vitest";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { conversationIngestCandidates, conversationIngestLeftOutCount } from "./ingest-candidates";

const conv = (fileId: string, ownChars: number, over: Partial<MediaIndexEntry> = {}): MediaIndexEntry =>
  ({
    fileId,
    name: fileId,
    type: "conversation",
    mimeType: "text/plain",
    url: `conversation:${fileId}`,
    thumbnailUrl: "",
    uploadedAt: "2026-11-10T00:00:00Z",
    usedIn: [],
    conversation: { provider: "claude-code", sessionId: fileId, workdir: "", startedAt: "", endedAt: "", ownTurns: 1, ownChars, bodyChars: 10, importedAt: "2026-11-10T00:00:00Z" },
    ...over,
  }) as MediaIndexEntry;

const ids = (list: MediaIndexEntry[]) => list.map((m) => m.fileId);

describe("conversationIngestCandidates", () => {
  it("本人の発言が 300 字以上の会話だけを候補にする（299 / 300 の境界）", () => {
    const media = [conv("a", 299), conv("b", 300)];
    expect(ids(conversationIngestCandidates(["a", "b"], new Set(["a", "b"]), media, () => false, () => false))).toEqual(["b"]);
  });

  it("変わっていない会話は、まだナレッジ化していなければ候補にする", () => {
    const media = [conv("a", 500), conv("b", 500)];
    const got = conversationIngestCandidates(["a", "b"], new Set(), media, (id) => id === "conversation:a", () => false);
    expect(ids(got)).toEqual(["b"]);
  });

  it("伸びた会話は、ナレッジ化済みでも候補にする", () => {
    expect(ids(conversationIngestCandidates(["a"], new Set(["a"]), [conv("a", 500)], () => true, () => false))).toEqual(["a"]);
  });

  it("アーカイブ済み・ほかの種類・今回取り込んでいない会話は候補にしない", () => {
    const media = [conv("a", 500, { archivedAt: "x" }), conv("p", 500, { type: "pdf" }), conv("z", 500)];
    expect(conversationIngestCandidates(["a", "p"], new Set(["a", "p"]), media, () => false, () => false)).toEqual([]);
  });

  it("同じ id が重なっても 1 件にする", () => {
    expect(ids(conversationIngestCandidates(["a", "a"], new Set(["a"]), [conv("a", 500)], () => false, () => false))).toEqual(["a"]);
  });
});

describe("ノートにまとめた会話", () => {
  const NOTE = "aaaaaaaa-1111-4222-8333-444444444441";
  const GONE = "bbbbbbbb-1111-4222-8333-444444444442";
  const withNotes = (fileId: string, ownChars: number, noteIds = [NOTE]) => {
    const base = conv(fileId, ownChars);
    return { ...base, conversation: { ...base.conversation!, createdNoteIds: noteIds } } as MediaIndexEntry;
  };
  const exists = (id: string) => id === NOTE;

  it("実在するノートのある会話は候補から外れ、外した本数が数えられる", () => {
    const media = [conv("a", 500), withNotes("b", 500), withNotes("c", 900)];
    const all = new Set(["a", "b", "c"]);
    expect(ids(conversationIngestCandidates(["a", "b", "c"], all, media, () => false, exists))).toEqual(["a"]);
    expect(conversationIngestLeftOutCount(["a", "b", "c"], all, media, () => false, exists)).toBe(2);
  });

  it("ノートが消えている（索引に無い・ゴミ箱）会話は外さない", () => {
    const media = [withNotes("b", 500, [GONE])];
    expect(ids(conversationIngestCandidates(["b"], new Set(["b"]), media, () => false, exists))).toEqual(["b"]);
    expect(conversationIngestLeftOutCount(["b"], new Set(["b"]), media, () => false, exists)).toBe(0);
  });

  it("実在するノートが 1 件でもあれば外す", () => {
    const media = [withNotes("b", 500, [GONE, NOTE])];
    expect(conversationIngestCandidates(["b"], new Set(["b"]), media, () => false, exists)).toEqual([]);
  });

  it("発言が少ない会話は、ノートがあっても外した数に入れない", () => {
    expect(conversationIngestLeftOutCount(["b"], new Set(["b"]), [withNotes("b", 100)], () => false, exists)).toBe(0);
  });
});
