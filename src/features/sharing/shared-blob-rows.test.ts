// 共有ノート内の画像・ファイル（extra.blobs）を素材タブの行に組み立てる純関数のテスト。
//
// 守りたい不変条件:
// - content-addressed（同じ hash = 同じ素材）なので、複数ノートに貼られていても 1 行
// - 題名が無い blob でも行が識別できる（hash 先頭 12 桁）
// - 種別は拡張子から推定し、分からなければ "other"（素材一覧から消えない）

import { describe, it, expect } from "vitest";
import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import {
  blobMediaType,
  blobRowTitle,
  buildSharedBlobRows,
  readEntryBlobs,
  shortBlobHash,
} from "./shared-blob-rows";

const blob = (hash: string, filename?: string): BlobRef => ({
  provider: "local-folder",
  uri: `file:///blobs/${hash}`,
  hash,
  size: 100,
  ...(filename ? { filename } : {}),
});

const note = (id: string, blobs: unknown[]): SharedEntry => ({
  id,
  type: "note",
  author: { name: "Ada", email: "ada@example.com" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  hash: `sha256:${id}`,
  prov: { derived_from: [] },
  version: 1,
  extra: { title: id, blobs },
});

describe("readEntryBlobs", () => {
  it("extra.blobs が無い / 配列でない / hash を持たない要素は落とす", () => {
    expect(readEntryBlobs({ ...note("n", []), extra: { title: "n" } })).toEqual([]);
    expect(readEntryBlobs({ ...note("n", []), extra: { blobs: "x" } })).toEqual([]);
    expect(readEntryBlobs(note("n", [null, { uri: "file:///x" }, blob("sha256:a")]))).toHaveLength(1);
  });
});

describe("buildSharedBlobRows", () => {
  it("同じ hash の blob は 1 行に集約し、親ノートを全部持つ", () => {
    const rows = buildSharedBlobRows([
      note("n1", [blob("sha256:aaa", "spectrum.png")]),
      note("n2", [blob("sha256:aaa", "spectrum.png"), blob("sha256:bbb", "data.csv")]),
    ]);
    expect(rows).toHaveLength(2);
    const shared = rows.find((r) => r.blob.hash === "sha256:aaa")!;
    expect(shared.parents.map((p) => p.id)).toEqual(["n1", "n2"]);
    // 代表の親は最初に見つかったノート（呼び出し側で updated_at 降順に並べてある）
    expect(shared.parent.id).toBe("n1");
    expect(rows.find((r) => r.blob.hash === "sha256:bbb")!.parents.map((p) => p.id)).toEqual(["n2"]);
  });

  it("同じノートが同じ hash を 2 回持っていても親を二重に数えない", () => {
    const rows = buildSharedBlobRows([
      note("n1", [blob("sha256:aaa", "a.png"), blob("sha256:aaa", "a.png")]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].parents).toHaveLength(1);
  });

  it("代表の BlobRef は題名を持つ方を選ぶ", () => {
    const rows = buildSharedBlobRows([
      note("n1", [blob("sha256:aaa")]),
      note("n2", [blob("sha256:aaa", "named.png")]),
    ]);
    expect(rows[0].blob.filename).toBe("named.png");
  });

  it("行のキーは hash 由来（同じ素材は同じキー）", () => {
    const rows = buildSharedBlobRows([note("n1", [blob("sha256:aaa", "a.png")])]);
    expect(rows[0].key).toBe("blob:sha256:aaa");
  });
});

describe("blobRowTitle / shortBlobHash", () => {
  it("filename があればそれを題名にする", () => {
    expect(blobRowTitle({ blob: blob("sha256:aaa", "spectrum.png") })).toBe("spectrum.png");
  });

  it("filename が無ければ hash の先頭 12 桁（アルゴリズム接頭辞は落とす）", () => {
    expect(blobRowTitle({ blob: blob("sha256:0123456789abcdef") })).toBe("0123456789ab");
    expect(shortBlobHash("0123456789abcdef")).toBe("0123456789ab");
  });
});

describe("blobMediaType", () => {
  it("拡張子から種別を推定する", () => {
    expect(blobMediaType(blob("sha256:a", "x.png"))).toBe("image");
    expect(blobMediaType(blob("sha256:a", "x.MP4"))).toBe("video");
    expect(blobMediaType(blob("sha256:a", "x.m4a"))).toBe("audio");
    expect(blobMediaType(blob("sha256:a", "paper.pdf"))).toBe("pdf");
    expect(blobMediaType(blob("sha256:a", "measure.csv"))).toBe("data");
    expect(blobMediaType(blob("sha256:a", "report.docx"))).toBe("document");
  });

  it("題名が無い / 未知の拡張子は other に落とす", () => {
    expect(blobMediaType(blob("sha256:a"))).toBe("other");
    expect(blobMediaType(blob("sha256:a", "archive.xyz"))).toBe("other");
  });
});
