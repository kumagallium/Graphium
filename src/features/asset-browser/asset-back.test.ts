// 素材画面の「戻る」の行き先の判定

import { describe, expect, it } from "vitest";
import { resolveAssetBackAction, shouldReturnToNoteOnFullExit } from "./asset-back";

describe("resolveAssetBackAction（素材一覧の ← 戻る）", () => {
  it("戻れるならブラウザの戻ると同じく履歴を戻す", () => {
    expect(resolveAssetBackAction({ canGoBack: true, activeFileId: "n1" })).toEqual({ kind: "history" });
    expect(resolveAssetBackAction({ canGoBack: true, activeFileId: null })).toEqual({ kind: "history" });
  });

  it("戻れず、ノートを開いていれば URL をそのノートに揃える", () => {
    expect(resolveAssetBackAction({ canGoBack: false, activeFileId: "n1" })).toEqual({
      kind: "replace",
      route: { view: "editor", fileId: "n1" },
    });
    // Knowledge ノートも wiki: 付きのまま本文ルートで表せる
    expect(resolveAssetBackAction({ canGoBack: false, activeFileId: "wiki:k1" })).toEqual({
      kind: "replace",
      route: { view: "editor", fileId: "wiki:k1" },
    });
  });

  it("戻れず、ノートが無ければ home に揃える", () => {
    expect(resolveAssetBackAction({ canGoBack: false, activeFileId: null })).toEqual({
      kind: "replace",
      route: { view: "home" },
    });
  });

  it("skill: は本文ルートで復元できないので home に落とす", () => {
    expect(resolveAssetBackAction({ canGoBack: false, activeFileId: "skill:s1" })).toEqual({
      kind: "replace",
      route: { view: "home" },
    });
  });
});

describe("shouldReturnToNoteOnFullExit（全画面を閉じる）", () => {
  it("ノートから開いていて戻れるときだけ、ノートへ戻る", () => {
    expect(shouldReturnToNoteOnFullExit({ openedFromNote: true, canGoBack: true })).toBe(true);
  });

  it("一覧の中から全画面にしたときは今までどおり（一覧に戻る）", () => {
    expect(shouldReturnToNoteOnFullExit({ openedFromNote: false, canGoBack: true })).toBe(false);
  });

  it("戻れないときは今までどおり", () => {
    expect(shouldReturnToNoteOnFullExit({ openedFromNote: true, canGoBack: false })).toBe(false);
    expect(shouldReturnToNoteOnFullExit({ openedFromNote: false, canGoBack: false })).toBe(false);
  });
});
