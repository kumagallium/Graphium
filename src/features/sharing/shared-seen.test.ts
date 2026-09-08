// @vitest-environment jsdom
// 「最後に見た」控えのテスト。
//
// 検証の軸:
//   - 控えが無いうちは印を出さない（未読を全部「更新あり」にしない）
//   - 自分が作ったエントリには「更新あり」を出さない
//   - コメントの増分だけを新着として数える
//   - 壊れた localStorage の値で落ちない

import { describe, it, expect, beforeEach } from "vitest";
import {
  SHARED_SEEN_KEY,
  __clearSharedSeenForTest,
  getSeen,
  isUpdatedSince,
  markSeen,
  newCommentCount,
  parseSeenStore,
  readSeenStore,
} from "./shared-seen";
import type { SharedEntry } from "../../lib/storage/shared";

const entry = (overrides: Partial<SharedEntry> = {}): SharedEntry => ({
  id: "n1",
  type: "note",
  author: { name: "Gakusei", email: "s@lab.jp" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  hash: "sha256:v2",
  prov: { derived_from: [] },
  ...overrides,
});

beforeEach(() => {
  __clearSharedSeenForTest();
});

describe("markSeen / getSeen", () => {
  it("hash とコメント件数を控える", () => {
    markSeen("n1", "sha256:v1", 3);
    expect(getSeen("n1")).toMatchObject({ hash: "sha256:v1", comments: 3 });
    expect(getSeen("n2")).toBeNull();
    expect(localStorage.getItem(SHARED_SEEN_KEY)).toContain("sha256:v1");
  });
});

describe("isUpdatedSince", () => {
  it("控えが無ければ「更新あり」を出さない", () => {
    expect(isUpdatedSince(entry(), "t@lab.jp")).toBe(false);
  });

  it("控えの hash と違えば「更新あり」", () => {
    markSeen("n1", "sha256:v1", 0);
    expect(isUpdatedSince(entry(), "t@lab.jp")).toBe(true);
    markSeen("n1", "sha256:v2", 0);
    expect(isUpdatedSince(entry(), "t@lab.jp")).toBe(false);
  });

  it("自分が作ったエントリには出さない", () => {
    markSeen("n1", "sha256:v1", 0);
    expect(isUpdatedSince(entry(), "s@lab.jp")).toBe(false);
  });

  it("store を渡せば localStorage を読み直さない", () => {
    const store = { n1: { hash: "sha256:v1", comments: 0, at: "" } };
    expect(isUpdatedSince(entry(), null, store)).toBe(true);
  });
});

describe("newCommentCount", () => {
  it("控えからの増分だけを数える", () => {
    markSeen("n1", "sha256:v2", 2);
    expect(newCommentCount("n1", 5)).toBe(3);
    expect(newCommentCount("n1", 2)).toBe(0);
    // 消されて減ったときも 0（負の数を出さない）
    expect(newCommentCount("n1", 1)).toBe(0);
  });

  it("控えが無ければ 0（未読を全部新着にしない）", () => {
    expect(newCommentCount("n9", 4)).toBe(0);
  });
});

describe("parseSeenStore", () => {
  it("壊れた値・形の違う値は捨てて読めるところだけ拾う", () => {
    expect(parseSeenStore(null)).toEqual({});
    expect(parseSeenStore("{{{")).toEqual({});
    expect(parseSeenStore("[1,2]")).toEqual({});
    expect(
      parseSeenStore('{"a":{"hash":"h","comments":-1,"at":1},"b":{"comments":2},"c":3}'),
    ).toEqual({ a: { hash: "h", comments: 0, at: "" } });
  });

  it("読み出しは localStorage の中身をそのまま反映する", () => {
    localStorage.setItem(SHARED_SEEN_KEY, '{"x":{"hash":"h1","comments":1,"at":"2026-01-01"}}');
    expect(readSeenStore()).toEqual({ x: { hash: "h1", comments: 1, at: "2026-01-01" } });
  });
});
