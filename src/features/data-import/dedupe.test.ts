import { describe, it, expect, vi } from "vitest";
import { findSameDataAsset } from "./dedupe";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";

const bytesOf = (text: string) => new TextEncoder().encode(text);

function entry(fileId: string, name: string, over: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId,
    name,
    type: "data",
    mimeType: "text/plain",
    url: `media://${fileId}`,
    thumbnailUrl: "",
    uploadedAt: "2026-08-14T00:00:00.000Z",
    usedIn: [],
    ...over,
  };
}

function index(media: MediaIndexEntry[]): MediaIndex {
  return { version: 5, updatedAt: "2026-08-14T00:00:00.000Z", media };
}

describe("findSameDataAsset", () => {
  it("同じ名前で中身も同じ素材を見つける", async () => {
    const store = new Map([["a", bytesOf("time,value\n1,2\n")]]);
    const found = await findSameDataAsset(
      index([entry("a", "run.csv")]),
      { name: "run.csv", bytes: bytesOf("time,value\n1,2\n") },
      async (id) => store.get(id)!,
    );
    expect(found).toBe("a");
  });

  it("同じ名前でも中身が違えば別物として扱う（装置の上書き出力）", async () => {
    const store = new Map([["a", bytesOf("time,value\n1,2\n")]]);
    const found = await findSameDataAsset(
      index([entry("a", "run.csv")]),
      { name: "run.csv", bytes: bytesOf("time,value\n9,9\n") },
      async (id) => store.get(id)!,
    );
    expect(found).toBeUndefined();
  });

  it("名前が違えば中身を読みにいかない（無駄な読み込みをしない）", async () => {
    const readBytes = vi.fn(async () => bytesOf(""));
    const found = await findSameDataAsset(
      index([entry("a", "other.csv")]),
      { name: "run.csv", bytes: bytesOf("x") },
      readBytes,
    );
    expect(found).toBeUndefined();
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("アーカイブ済みは使い回さない", async () => {
    const store = new Map([["a", bytesOf("same")]]);
    const found = await findSameDataAsset(
      index([entry("a", "run.csv", { archivedAt: "2026-08-01T00:00:00.000Z" })]),
      { name: "run.csv", bytes: bytesOf("same") },
      async (id) => store.get(id)!,
    );
    expect(found).toBeUndefined();
  });

  it("データ以外の素材は候補にしない", async () => {
    const store = new Map([["a", bytesOf("same")]]);
    const found = await findSameDataAsset(
      index([entry("a", "run.csv", { type: "document" })]),
      { name: "run.csv", bytes: bytesOf("same") },
      async (id) => store.get(id)!,
    );
    expect(found).toBeUndefined();
  });

  it("読めない候補は飛ばして次を見る", async () => {
    const found = await findSameDataAsset(
      index([entry("broken", "run.csv"), entry("ok", "run.csv")]),
      { name: "run.csv", bytes: bytesOf("same") },
      async (id) => {
        if (id === "broken") throw new Error("gone");
        return bytesOf("same");
      },
    );
    expect(found).toBe("ok");
  });

  it("素材インデックスが無ければ何も返さない", async () => {
    expect(
      await findSameDataAsset(null, { name: "a.csv", bytes: bytesOf("x") }, async () => bytesOf(""))
    ).toBeUndefined();
  });
});
