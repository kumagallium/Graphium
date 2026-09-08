// 提案の基準版（base）の選び方のテスト（§25 A-3）。
//
// 対象の不変条件:
// - 派生した時点の控えがあればそれを使う（作り直さない文字列のまま）
// - 控えが別のノート由来なら使わない（他人の版を基準にしない）
// - 控えが無くても、元が派生時点から変わっていなければ現在の本文で代用できる
// - 元が更新されていたら現在の本文を base に流用しない（作者の変更まで
//   提案者の変更として数えてしまうため）

import { describe, it, expect, vi } from "vitest";
import type { SharedEntry } from "../../lib/storage/shared";
import { isTargetUpdatedSinceFork, resolveProposalBase } from "./proposal-base";
import type { ForkBase } from "./fork-base";

const TARGET: SharedEntry = {
  id: "note-1",
  type: "note",
  author: { name: "山田", email: "yamada@example.ac.jp" },
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
  hash: "sha256:current",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

const forkBase = (partial: Partial<ForkBase> = {}): ForkBase => ({
  sharedId: "note-1",
  hash: "sha256:forked",
  body: '{"title":"forked base"}',
  savedAt: "2026-09-01T00:00:00.000Z",
  ...partial,
});

describe("resolveProposalBase", () => {
  it("派生した時点の控えがあればそれを基準版にする", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:forked" },
      loadBase: async () => forkBase(),
      readTargetBody: async () => '{"title":"current"}',
    });
    expect(result.origin).toBe("fork");
    // 読んだままの文字列（作り直すと content-addressed な blob が畳まれない）
    expect(result.body).toBe('{"title":"forked base"}');
  });

  it("控えが別のノート由来なら使わない", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:other" },
      loadBase: async () => forkBase({ sharedId: "note-9" }),
    });
    expect(result.origin).toBe("none");
    expect(result.body).toBeUndefined();
  });

  it("控えが無くても、元が派生時点から変わっていなければ現在の本文で代用する", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:current" },
      loadBase: async () => null,
      readTargetBody: async () => '{"title":"current"}',
    });
    expect(result.origin).toBe("current");
    expect(result.body).toBe('{"title":"current"}');
  });

  it("元が更新されていたら現在の本文を基準版にしない（2 者比較に落とす）", async () => {
    const readTargetBody = vi.fn(async () => '{"title":"current"}');
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:forked" },
      loadBase: async () => null,
      readTargetBody,
    });
    expect(result.origin).toBe("none");
    expect(readTargetBody).not.toHaveBeenCalled();
  });

  it("元エントリが読めていなければ基準版なし", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: null,
      forkedFrom: { sharedId: "note-1", hash: "sha256:current" },
      loadBase: async () => forkBase(),
    });
    expect(result.origin).toBe("none");
  });

  it("控えの読み出しが失敗しても止まらず、代用の判定に進む", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:current" },
      loadBase: async () => {
        throw new Error("appData unreachable");
      },
      readTargetBody: async () => '{"title":"current"}',
    });
    expect(result.origin).toBe("current");
  });

  it("現在の本文が読めなければ基準版なし（提案そのものは止めない）", async () => {
    const result = await resolveProposalBase({
      noteId: "local-1",
      target: TARGET,
      forkedFrom: { sharedId: "note-1", hash: "sha256:current" },
      loadBase: async () => null,
      readTargetBody: async () => {
        throw new Error("unreadable");
      },
    });
    expect(result.origin).toBe("none");
  });
});

describe("isTargetUpdatedSinceFork", () => {
  it("hash が違えば更新されている", () => {
    expect(isTargetUpdatedSinceFork(TARGET, { hash: "sha256:forked" })).toBe(true);
  });

  it("hash が同じなら更新されていない", () => {
    expect(isTargetUpdatedSinceFork(TARGET, { hash: "sha256:current" })).toBe(false);
  });

  it("hash が分からないときは「更新された」と言わない", () => {
    expect(isTargetUpdatedSinceFork(TARGET, undefined)).toBe(false);
    expect(isTargetUpdatedSinceFork(TARGET, { hash: "" })).toBe(false);
    expect(isTargetUpdatedSinceFork(null, { hash: "sha256:forked" })).toBe(false);
  });
});
