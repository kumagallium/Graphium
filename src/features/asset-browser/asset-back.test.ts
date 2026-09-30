// 素材画面の「戻る」の行き先の判定

import { describe, expect, it, vi } from "vitest";
import { resolveAssetBackAction, runFullExit, stepsBackTo, stepsBackToNote } from "./asset-back";

describe("stepsBackTo", () => {
  it("いまから目標の連番までの差を返す", () => {
    expect(stepsBackTo(5, 3)).toBe(2);
    expect(stepsBackTo(3, 3)).toBe(0);
  });

  it("不明・先・負なら戻らない。履歴の深さは超えない", () => {
    expect(stepsBackTo(5, null)).toBe(0);
    expect(stepsBackTo(2, 4)).toBe(0);
    expect(stepsBackTo(2, -1)).toBe(0);
    expect(stepsBackTo(2, 0)).toBe(2);
  });
});

describe("resolveAssetBackAction（素材一覧の ← 戻る）", () => {
  it("一覧に入った直後なら 1 段戻る（ブラウザの戻ると同じ）", () => {
    expect(resolveAssetBackAction({ currentSeq: 3, entrySeq: 3, activeFileId: "n1" })).toEqual({
      kind: "history",
      steps: 1,
    });
  });

  it("一覧の上でピークを開閉して履歴が積まれていても、一覧に入る前まで戻る", () => {
    expect(resolveAssetBackAction({ currentSeq: 6, entrySeq: 3, activeFileId: "n1" })).toEqual({
      kind: "history",
      steps: 4,
    });
  });

  it("入った時点が不明なら 1 段だけ戻る", () => {
    expect(resolveAssetBackAction({ currentSeq: 4, entrySeq: null, activeFileId: null })).toEqual({
      kind: "history",
      steps: 1,
    });
  });

  it("戻れず、ノートを開いていれば URL をそのノートに揃える", () => {
    expect(resolveAssetBackAction({ currentSeq: 0, entrySeq: null, activeFileId: "n1" })).toEqual({
      kind: "replace",
      route: { view: "editor", fileId: "n1" },
    });
    // Knowledge ノートも wiki: 付きのまま本文ルートで表せる
    expect(resolveAssetBackAction({ currentSeq: 0, entrySeq: 0, activeFileId: "wiki:k1" })).toEqual({
      kind: "replace",
      route: { view: "editor", fileId: "wiki:k1" },
    });
  });

  it("戻れず、ノートが無ければ home に揃える", () => {
    expect(resolveAssetBackAction({ currentSeq: 0, entrySeq: null, activeFileId: null })).toEqual({
      kind: "replace",
      route: { view: "home" },
    });
  });

  it("skill: は本文ルートで復元できないので home に落とす", () => {
    expect(resolveAssetBackAction({ currentSeq: 0, entrySeq: null, activeFileId: "skill:s1" })).toEqual({
      kind: "replace",
      route: { view: "home" },
    });
  });
});

describe("stepsBackToNote（ノートから開いた全画面を閉じる）", () => {
  it("開いた直後なら 1 段でノートに戻る", () => {
    expect(stepsBackToNote(4, 3)).toBe(1);
  });

  it("全画面の最中に素材の切り替えやノートのピークで履歴が積まれても、ノートまでまとめて戻る", () => {
    expect(stepsBackToNote(6, 3)).toBe(3);
  });

  it("開いても履歴が積まれなかった（ノートの連番が不明）ときは戻らない", () => {
    expect(stepsBackToNote(4, null)).toBe(0);
  });
});

describe("runFullExit（全画面を閉じる操作の手順）", () => {
  it("ノートから開いていて戻れたら、印を先に下ろし、fallback は呼ばない", () => {
    const calls: string[] = [];
    runFullExit({
      fromNote: true,
      clearFromNote: () => calls.push("clear"),
      exitToNote: () => {
        calls.push("exit");
        return true;
      },
      fallback: () => calls.push("fallback"),
    });
    expect(calls).toEqual(["clear", "exit"]);
  });

  it("戻れなかったら印を下ろしたうえで fallback（一覧に戻る）", () => {
    const calls: string[] = [];
    runFullExit({
      fromNote: true,
      clearFromNote: () => calls.push("clear"),
      exitToNote: () => {
        calls.push("exit");
        return false;
      },
      fallback: () => calls.push("fallback"),
    });
    expect(calls).toEqual(["clear", "exit", "fallback"]);
  });

  it("一覧の中から開いた全画面は、ノートへ戻る処理を呼ばず fallback だけ", () => {
    const exitToNote = vi.fn(() => true);
    const clearFromNote = vi.fn();
    const fallback = vi.fn();
    runFullExit({ fromNote: false, clearFromNote, exitToNote, fallback });
    expect(exitToNote).not.toHaveBeenCalled();
    expect(clearFromNote).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
