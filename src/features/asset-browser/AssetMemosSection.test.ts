// filterMemosByAsset の挙動を担保する。
// PR3-a で「sourceAsset.fileId 一致」を加えた一方、旧仕様の「テキスト末尾の
// 出典ラベル一致」も後方互換として残している。両方の経路でメモが拾えること、
// および無関係なメモが混入しないことを確認する。

import { describe, it, expect } from "vitest";
import { filterMemosByAsset } from "./AssetMemosSection";
import type { CaptureIndex } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";

const ASSET: MediaIndexEntry = {
  fileId: "drive:abc123",
  name: "paper.pdf",
  type: "pdf",
  mimeType: "application/pdf",
  url: "drive://drive:abc123",
  thumbnailUrl: "",
  uploadedAt: "2026-05-22T10:00:00.000Z",
  usedIn: [],
};

function makeIndex(captures: CaptureIndex["captures"]): CaptureIndex {
  return { version: 1, updatedAt: "2026-05-22T10:00:00.000Z", captures };
}

describe("filterMemosByAsset", () => {
  it("captureIndex が null のとき空配列を返す", () => {
    expect(filterMemosByAsset(null, ASSET)).toEqual([]);
  });

  it("sourceAsset.fileId が一致するメモを拾う", () => {
    const index = makeIndex([
      {
        id: "cap_struct",
        text: "selection text",
        createdAt: "2026-05-22T10:00:00.000Z",
        sourceAsset: { fileId: "drive:abc123", type: "pdf", pageNumber: 3 },
      },
    ]);
    const result = filterMemosByAsset(index, ASSET);
    expect(result.map((c) => c.id)).toEqual(["cap_struct"]);
  });

  it("旧仕様のテキスト末尾ラベル一致でも拾う（後方互換）", () => {
    const index = makeIndex([
      {
        id: "cap_legacy",
        text: "selection text\n\n— paper.pdf · p.3",
        createdAt: "2026-05-22T10:00:00.000Z",
        // sourceAsset 未設定
      },
    ]);
    const result = filterMemosByAsset(index, ASSET);
    expect(result.map((c) => c.id)).toEqual(["cap_legacy"]);
  });

  it("無関係な fileId / 別ファイル名のメモは除外する", () => {
    const index = makeIndex([
      {
        id: "cap_other_id",
        text: "selection text",
        createdAt: "2026-05-22T10:00:00.000Z",
        sourceAsset: { fileId: "drive:other", type: "pdf" },
      },
      {
        id: "cap_other_name",
        text: "memo\n\n— other.pdf · p.1",
        createdAt: "2026-05-22T10:00:00.000Z",
      },
    ]);
    expect(filterMemosByAsset(index, ASSET)).toEqual([]);
  });

  it("構造化メモと旧仕様メモの両方が混在しても両方拾う", () => {
    const index = makeIndex([
      {
        id: "cap_struct",
        text: "new style memo",
        createdAt: "2026-05-22T12:00:00.000Z",
        sourceAsset: { fileId: "drive:abc123", type: "pdf" },
      },
      {
        id: "cap_legacy",
        text: "old style\n\n— paper.pdf · p.1",
        createdAt: "2026-05-22T11:00:00.000Z",
      },
      {
        id: "cap_unrelated",
        text: "unrelated memo",
        createdAt: "2026-05-22T13:00:00.000Z",
      },
    ]);
    const ids = filterMemosByAsset(index, ASSET).map((c) => c.id);
    expect(ids).toContain("cap_struct");
    expect(ids).toContain("cap_legacy");
    expect(ids).not.toContain("cap_unrelated");
  });

  it("createdAt の新しい順に並ぶ", () => {
    const index = makeIndex([
      {
        id: "older",
        text: "memo\n\n— paper.pdf",
        createdAt: "2026-05-20T10:00:00.000Z",
      },
      {
        id: "newer",
        text: "memo\n\n— paper.pdf",
        createdAt: "2026-05-22T10:00:00.000Z",
      },
    ]);
    expect(filterMemosByAsset(index, ASSET).map((c) => c.id)).toEqual(["newer", "older"]);
  });
});
