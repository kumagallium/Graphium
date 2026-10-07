// media-search.ts（search_media の本体）の回帰テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetSearchIndex } from "./search";
import { resetMediaIndexCache } from "./sources";
import { mediaSourceId, resetMediaSearchIndex, searchMedia } from "./media-search";

function entry(over: Record<string, unknown>) {
  return { url: "", thumbnailUrl: "", uploadedAt: "2026-10-01T00:00:00Z", usedIn: [], mimeType: "", ...over };
}

describe("searchMedia", () => {
  let root: string;

  function writeMedia(media: object[]) {
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media }));
    resetMediaIndexCache();
    resetMediaSearchIndex();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-media-search-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(
      join(root, "notes", "n1.json"),
      JSON.stringify({ version: 2, title: "焼結の実験", pages: [{ id: "p", blocks: [] }] }),
    );
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    resetSearchIndex();
  });

  it("名前・OCR の文字・URL の説明・ドメインで引ける", () => {
    writeMedia([
      entry({ fileId: "a1", name: "熱電変換の総説.pdf", type: "pdf" }),
      entry({ fileId: "i1", name: "IMG_0001.jpg", type: "image", ocrText: "Seebeck coefficient 測定結果" }),
      entry({
        fileId: "u1",
        name: "Thermoelectric materials",
        type: "url",
        url: "https://example.org/te",
        urlMeta: { domain: "example.org", description: "廃熱から電気をつくる材料の解説" },
      }),
    ]);
    expect(searchMedia("総説", {}, root).map((h) => h.id)).toEqual(["pdf:a1"]);
    expect(searchMedia("Seebeck", {}, root).map((h) => h.id)).toEqual(["image:i1"]);
    expect(searchMedia("廃熱", {}, root).map((h) => h.id)).toEqual(["url:https://example.org/te"]);
    expect(searchMedia("example.org", {}, root).map((h) => h.id)).toContain("url:https://example.org/te");
  });

  it("アーカイブ済みは除き、type で絞れる", () => {
    writeMedia([
      entry({ fileId: "a1", name: "焼結 資料.pdf", type: "pdf" }),
      entry({ fileId: "a2", name: "焼結 古い.pdf", type: "pdf", archivedAt: "2026-09-01T00:00:00Z" }),
      entry({ fileId: "d1", name: "焼結 報告.docx", type: "document" }),
    ]);
    const ids = searchMedia("焼結", {}, root).map((h) => h.id).sort();
    expect(ids).toEqual(["document:d1", "pdf:a1"]);
    expect(searchMedia("焼結", { type: "document" }, root).map((h) => h.id)).toEqual(["document:d1"]);
  });

  it("使っているノートを索引のタイトルで返し、同じノートは 1 行にまとめる", () => {
    writeMedia([
      entry({
        fileId: "a1",
        name: "焼結 資料.pdf",
        type: "pdf",
        usedIn: [
          { noteId: "n1", noteTitle: "古い題", blockId: "b1" },
          { noteId: "n1", noteTitle: "古い題", blockId: "b2" },
        ],
      }),
    ]);
    const [hit] = searchMedia("焼結", {}, root);
    expect(hit.usedIn).toEqual([{ noteId: "n1", title: "焼結の実験" }]);
  });

  it("media-index.json が書き換わったら組み直す", () => {
    writeMedia([entry({ fileId: "a1", name: "alpha 資料.pdf", type: "pdf" })]);
    expect(searchMedia("beta", {}, root)).toEqual([]);
    // mtime が同じ値にならないよう少し進める
    writeFileSync(
      join(root, "appdata", "media-index.json"),
      JSON.stringify({ version: 1, media: [entry({ fileId: "a2", name: "beta 資料.pdf", type: "pdf" })] }),
    );
    const later = new Date(Date.now() + 5000);
    utimesSync(join(root, "appdata", "media-index.json"), later, later);
    expect(searchMedia("beta", {}, root).map((h) => h.id)).toEqual(["pdf:a2"]);
  });

  it("mediaSourceId は種類ごとの形にする", () => {
    expect(mediaSourceId({ type: "pdf", fileId: "x", url: "" })).toBe("pdf:x");
    expect(mediaSourceId({ type: "url", fileId: "x", url: "https://a/b" })).toBe("url:https://a/b");
    expect(mediaSourceId({ type: "memo", fileId: "x", url: "" })).toBe("memo:x");
  });
});
