import { describe, it, expect } from "vitest";
import { isIncomingDocNewer } from "./doc-recency";
import type { GraphiumDocument } from "../lib/document-types";

// handleOpenFile が呼び出し元（サイドピーク等）から渡されたスナップショットで
// docCacheRef を上書きしてよいかの判定。古いスナップショットでの上書きは
// 本文エディタの巻き戻り（書いた文章が消える）を招くため拒否する。
function doc(modifiedAt: string | undefined): GraphiumDocument {
  return {
    version: 2,
    title: "t",
    pages: [{ id: "main", title: "t", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: modifiedAt as string,
  };
}

describe("isIncomingDocNewer", () => {
  it("キャッシュ未登録なら受け入れる", () => {
    expect(isIncomingDocNewer(doc("2026-06-29T10:00:00.000Z"), undefined)).toBe(true);
  });

  it("incoming が新しければ受け入れる", () => {
    const existing = doc("2026-06-29T10:00:00.000Z");
    const incoming = doc("2026-06-29T10:05:00.000Z");
    expect(isIncomingDocNewer(incoming, existing)).toBe(true);
  });

  it("incoming が古ければ拒否する（巻き戻り防止の本体）", () => {
    const existing = doc("2026-06-29T10:05:00.000Z");
    const incoming = doc("2026-06-29T10:00:00.000Z");
    expect(isIncomingDocNewer(incoming, existing)).toBe(false);
  });

  it("同時刻なら既存キャッシュを守る（拒否）", () => {
    const t = "2026-06-29T10:00:00.000Z";
    expect(isIncomingDocNewer(doc(t), doc(t))).toBe(false);
  });

  it("incoming の modifiedAt が不正なら拒否する", () => {
    const existing = doc("2026-06-29T10:00:00.000Z");
    expect(isIncomingDocNewer(doc(undefined), existing)).toBe(false);
    expect(isIncomingDocNewer(doc("not-a-date"), existing)).toBe(false);
  });

  it("既存の modifiedAt が不正なら incoming を優先する", () => {
    const incoming = doc("2026-06-29T10:00:00.000Z");
    expect(isIncomingDocNewer(incoming, doc(undefined))).toBe(true);
  });
});
