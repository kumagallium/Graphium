import { describe, it, expect } from "vitest";
import { setMediaEntryContexts, type MediaIndex, type MediaIndexEntry } from "./media-index";

const entry = (fileId: string, extra: Partial<MediaIndexEntry> = {}): MediaIndexEntry => ({
  fileId,
  name: `${fileId}.png`,
  type: "image",
  mimeType: "image/png",
  url: "",
  thumbnailUrl: "",
  uploadedAt: "2026-09-03T00:00:00.000Z",
  usedIn: [],
  ...extra,
});

const index = (media: MediaIndexEntry[]): MediaIndex => ({
  version: 7,
  updatedAt: "2026-09-03T00:00:00.000Z",
  media,
});

describe("setMediaEntryContexts", () => {
  it("指定した素材だけフォルダが変わる", () => {
    const next = setMediaEntryContexts(index([entry("a"), entry("b")]), "a", ["材料X"]);
    expect(next.media.find((m) => m.fileId === "a")?.noteContexts).toEqual(["材料X"]);
    expect(next.media.find((m) => m.fileId === "b")?.noteContexts).toBeUndefined();
  });

  it("ノートと同じ規則で正規化する（trim・小文字比較の重複除去・表示は初出の形）", () => {
    const next = setMediaEntryContexts(index([entry("a")]), "a", ["  材料X ", "材料x", "実験"]);
    expect(next.media[0].noteContexts).toEqual(["材料X", "実験"]);
  });

  it("空にすると欄ごと落ちる", () => {
    const before = index([entry("a", { noteContexts: ["材料X"] })]);
    expect(setMediaEntryContexts(before, "a", []).media[0].noteContexts).toBeUndefined();
  });

  it("更新時刻を進める", () => {
    const next = setMediaEntryContexts(index([entry("a")]), "a", ["材料X"]);
    expect(next.updatedAt).not.toBe("2026-09-03T00:00:00.000Z");
  });

  it("存在しない fileId なら中身は変わらない", () => {
    const before = index([entry("a", { noteContexts: ["材料X"] })]);
    const next = setMediaEntryContexts(before, "zzz", ["別"]);
    expect(next.media).toEqual(before.media);
  });

  it("他のフィールドは保つ（usedIn や OCR を落とさない）", () => {
    const before = index([
      entry("a", { ocrText: "読み取り済み", usedIn: [{ noteId: "n1", noteTitle: "N", blockId: "b" }] }),
    ]);
    const next = setMediaEntryContexts(before, "a", ["材料X"]);
    expect(next.media[0].ocrText).toBe("読み取り済み");
    expect(next.media[0].usedIn).toHaveLength(1);
  });
});
