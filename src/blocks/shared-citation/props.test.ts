// SharedEntry → sharedCitation ブロック props 変換のテスト。
// data-manifest（blob 付き）と note（extra 最小）の両形を保証する。

import { describe, it, expect } from "vitest";
import { entryToCachedProps, entryToBlockProps } from "./props";
import type { SharedEntry } from "../../lib/storage/shared";

const baseEntry = (over: Partial<SharedEntry>): SharedEntry =>
  ({
    id: "0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000",
    type: "note",
    author: { name: "田中", email: "tanaka@example.com" },
    created_at: "2026-05-12T10:30:00+09:00",
    updated_at: "2026-05-12T10:30:00+09:00",
    hash: "sha256:abc",
    prov: { derived_from: [] },
    ...over,
  }) as SharedEntry;

describe("entryToCachedProps", () => {
  it("data-manifest: extra の title / original_filename / blob size を反映する", () => {
    const entry = baseEntry({
      type: "data-manifest",
      version: 2,
      extra: {
        title: "NaCl 単結晶 XRD",
        original_filename: "nacl_xrd_scan.csv",
        blobs: [
          {
            provider: "local-folder",
            uri: "file:///blobs/ab/abc",
            hash: "sha256:blob",
            size: 2411725,
            filename: "nacl_xrd_scan.csv",
          },
        ],
      },
    });
    const props = entryToCachedProps(entry);
    expect(props.cachedTitle).toBe("NaCl 単結晶 XRD");
    expect(props.cachedAuthor).toBe("田中");
    expect(props.citedVersion).toBe(2);
    expect(props.fileName).toBe("nacl_xrd_scan.csv");
    expect(props.fileSizeLabel).not.toBe("");
  });

  it("note: extra 最小でも空文字で埋まる（undefined を props に入れない）", () => {
    const entry = baseEntry({ extra: { title: "焼結条件の検討メモ" } });
    const props = entryToCachedProps(entry);
    expect(props.cachedTitle).toBe("焼結条件の検討メモ");
    expect(props.fileName).toBe("");
    expect(props.fileSizeLabel).toBe("");
    expect(props.citedVersion).toBe(1);
  });
});

describe("entryToBlockProps", () => {
  it("参照（id + 引用時 hash + 種別）とスナップショットを両方持つ", () => {
    const entry = baseEntry({ extra: { title: "t" } });
    const props = entryToBlockProps(entry);
    expect(props.sharedId).toBe(entry.id);
    expect(props.citedHash).toBe(entry.hash);
    expect(props.entryType).toBe("note");
    expect(props.citedAt).toBeTruthy();
    expect(props.cachedTitle).toBe("t");
  });
});
