// メモのフォルダの付け外し（editCapturesContexts）と、索引の保存順（saveCaptureIndex）。
// 「付けてすぐ外す」で、外したはずのフォルダがディスクに残らないことを確かめる。
import { describe, expect, it, vi } from "vitest";

const written: Array<string[] | undefined> = [];
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    // 1 回目の書き込みだけ遅い（付けた保存が、外した保存より後に着く状況を作る）
    writeAppData: async (_key: string, data: { captures: Array<{ noteContexts?: string[] }> }) => {
      const delay = written.length === 0 ? 30 : 1;
      const snapshot = data.captures[0]?.noteContexts;
      await new Promise((r) => setTimeout(r, delay));
      written.push(snapshot);
    },
  }),
}));

import {
  addCapture,
  createEmptyCaptureIndex,
  editCapturesContexts,
  saveCaptureIndex,
  type CaptureEntry,
} from "./capture-store";
import { addNoteContext, removeNoteContext } from "../note-context/context-tags";

const memo = (id: string, folders?: string[]): CaptureEntry => ({
  id,
  text: id,
  createdAt: "2026-10-26T00:00:00.000Z",
  ...(folders ? { noteContexts: folders } : {}),
});

describe("editCapturesContexts", () => {
  it("選んだメモそれぞれの今の値に編集を当てる", () => {
    let index = createEmptyCaptureIndex();
    index = addCapture(index, memo("m1", ["材料X"]));
    index = addCapture(index, memo("m2"));
    index = addCapture(index, memo("m3"));
    const { index: next, changed } = editCapturesContexts(index, ["m1", "m2"], (prev) =>
      addNoteContext(prev, "フォルダA"),
    );
    expect(changed).toBe(2);
    const byId = Object.fromEntries(next.captures.map((c) => [c.id, c.noteContexts]));
    expect(byId).toEqual({ m1: ["材料X", "フォルダA"], m2: ["フォルダA"], m3: undefined });
  });

  it("付けてすぐ外すと元に戻る（直前の結果の上に当たる）", () => {
    let index = addCapture(createEmptyCaptureIndex(), memo("m1"));
    index = editCapturesContexts(index, ["m1"], (p) => addNoteContext(p, "フォルダA")).index;
    index = editCapturesContexts(index, ["m1"], (p) => removeNoteContext(p, "フォルダA")).index;
    expect(index.captures[0]?.noteContexts).toBeUndefined();
  });

  it("何も変わらなければ index ごと据え置く", () => {
    const index = addCapture(createEmptyCaptureIndex(), memo("m1", ["フォルダA"]));
    const result = editCapturesContexts(index, ["m1"], (p) => addNoteContext(p, "フォルダA"));
    expect(result.changed).toBe(0);
    expect(result.index).toBe(index);
  });
});

describe("saveCaptureIndex", () => {
  it("頼んだ順に書く（遅い 1 回目が、後から頼んだ 2 回目を上書きしない）", async () => {
    const base = addCapture(createEmptyCaptureIndex(), memo("m1"));
    const added = editCapturesContexts(base, ["m1"], (p) => addNoteContext(p, "フォルダA")).index;
    const removed = editCapturesContexts(added, ["m1"], (p) => removeNoteContext(p, "フォルダA")).index;
    await Promise.all([saveCaptureIndex(added), saveCaptureIndex(removed)]);
    expect(written).toEqual([["フォルダA"], undefined]);
  });
});
