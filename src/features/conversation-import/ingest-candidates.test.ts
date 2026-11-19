import { describe, it, expect } from "vitest";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { conversationIngestCandidates } from "./ingest-candidates";

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
    expect(ids(conversationIngestCandidates(["a", "b"], new Set(["a", "b"]), media, () => false))).toEqual(["b"]);
  });

  it("変わっていない会話は、まだナレッジ化していなければ候補にする", () => {
    const media = [conv("a", 500), conv("b", 500)];
    const got = conversationIngestCandidates(["a", "b"], new Set(), media, (id) => id === "conversation:a");
    expect(ids(got)).toEqual(["b"]);
  });

  it("伸びた会話は、ナレッジ化済みでも候補にする", () => {
    expect(ids(conversationIngestCandidates(["a"], new Set(["a"]), [conv("a", 500)], () => true))).toEqual(["a"]);
  });

  it("アーカイブ済み・ほかの種類・今回取り込んでいない会話は候補にしない", () => {
    const media = [conv("a", 500, { archivedAt: "x" }), conv("p", 500, { type: "pdf" }), conv("z", 500)];
    expect(conversationIngestCandidates(["a", "p"], new Set(["a", "p"]), media, () => false)).toEqual([]);
  });

  it("同じ id が重なっても 1 件にする", () => {
    expect(ids(conversationIngestCandidates(["a", "a"], new Set(["a"]), [conv("a", 500)], () => false))).toEqual(["a"]);
  });
});
