import { describe, expect, it, vi } from "vitest";
import { settleFirstSave } from "./settle-first-save";

describe("settleFirstSave", () => {
  it("ID のあるノートでは何もしない（保存も始めない）", async () => {
    const saveNow = vi.fn();
    await settleFirstSave({
      getFileId: () => "note-1",
      hasUnsaved: () => true,
      saveNow,
      pendingSaves: () => new Promise(() => {}),
      getLiveEditor: () => ({}),
    });
    expect(saveNow).not.toHaveBeenCalled();
  });

  it("まっさらな新規ノート（未保存も書き込み中も無い）はすぐ戻る", async () => {
    const saveNow = vi.fn();
    await settleFirstSave({
      getFileId: () => null,
      hasUnsaved: () => false,
      saveNow,
      pendingSaves: () => null,
      getLiveEditor: () => ({}),
    });
    expect(saveNow).not.toHaveBeenCalled();
  });

  it("未保存があれば保存を始め、ID が付いてエディタが作り直されるまで待つ", async () => {
    let fileId: string | null = null;
    const first = { name: "first" };
    const second = { name: "second" };
    let live: unknown = first;
    let finishSave: () => void = () => {};
    let pending: Promise<void> | null = null;
    const saveNow = vi.fn(() => {
      pending = new Promise<void>((resolve) => {
        finishSave = resolve;
      });
    });
    let settled = false;
    const done = settleFirstSave({
      getFileId: () => fileId,
      hasUnsaved: () => true,
      saveNow,
      pendingSaves: () => pending,
      getLiveEditor: () => live,
    }).then(() => {
      settled = true;
    });
    expect(saveNow).toHaveBeenCalledTimes(1);

    // 保存は済んだが、まだ作り直されていない
    fileId = "note-1";
    finishSave();
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    // 作り直された
    live = second;
    await done;
    expect(settled).toBe(true);
  });

  it("書き込み中の保存だけがある（未保存は下ろし済み）ときも、済むまで待つ", async () => {
    let fileId: string | null = null;
    let live: unknown = { name: "first" };
    let finishSave: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const saveNow = vi.fn();
    const done = settleFirstSave({
      getFileId: () => fileId,
      hasUnsaved: () => false,
      saveNow,
      pendingSaves: () => pending,
      getLiveEditor: () => live,
    });
    expect(saveNow).not.toHaveBeenCalled();
    fileId = "note-1";
    live = { name: "second" };
    finishSave();
    await done;
  });

  it("保存に失敗して ID が付かなければ、上限で諦めて戻る", async () => {
    const t0 = Date.now();
    await settleFirstSave({
      getFileId: () => null,
      hasUnsaved: () => true,
      saveNow: () => {},
      pendingSaves: () => Promise.resolve(),
      getLiveEditor: () => ({}),
      timeoutMs: 60,
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });
});
