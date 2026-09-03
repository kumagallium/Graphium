import { describe, it, expect } from "vitest";
import { buildNoteFolderLookup, resolveAssetFolders, assetFolderValues } from "./asset-folders";

const lookup = buildNoteFolderLookup([
  { noteId: "n1", noteContexts: ["材料X"] },
  { noteId: "n2", noteContexts: ["材料X", "実験A"] },
  { noteId: "n3", noteContexts: [] },
  { noteId: "n4" },
]);

const usage = (noteId: string) => ({ noteId, noteTitle: noteId, blockId: "b" });

describe("buildNoteFolderLookup", () => {
  it("フォルダを持つノートだけ載せる", () => {
    expect(lookup.get("n1")).toEqual(["材料X"]);
    expect(lookup.get("n3")).toBeUndefined();
    expect(lookup.get("n4")).toBeUndefined();
  });
});

describe("resolveAssetFolders", () => {
  it("使われているノートのフォルダを導出する", () => {
    const r = resolveAssetFolders({ usedIn: [usage("n1")] }, lookup);
    expect(r).toEqual([{ value: "材料X", derived: true }]);
  });

  it("複数のノートで使われていれば全部集める（重複は畳む）", () => {
    const r = resolveAssetFolders({ usedIn: [usage("n1"), usage("n2")] }, lookup);
    expect(r.map((f) => f.value)).toEqual(["材料X", "実験A"]);
    expect(r.every((f) => f.derived)).toBe(true);
  });

  it("自分で付けたものが先に並び、derived ではない", () => {
    const r = resolveAssetFolders({ noteContexts: ["下書き"], usedIn: [usage("n1")] }, lookup);
    expect(r).toEqual([
      { value: "下書き", derived: false },
      { value: "材料X", derived: true },
    ]);
  });

  it("同じ名前が両方にあるときは「自分で付けた」を優先する", () => {
    const r = resolveAssetFolders({ noteContexts: ["材料x"], usedIn: [usage("n1")] }, lookup);
    expect(r).toEqual([{ value: "材料x", derived: false }]);
  });

  it("どのノートにも貼られていない素材は、自分で付けたものだけ", () => {
    expect(resolveAssetFolders({ noteContexts: ["下書き"], usedIn: [] }, lookup)).toEqual([
      { value: "下書き", derived: false },
    ]);
  });

  it("どこにも属していなければ空", () => {
    expect(resolveAssetFolders({ usedIn: [usage("n3")] }, lookup)).toEqual([]);
    expect(resolveAssetFolders({ usedIn: [] }, lookup)).toEqual([]);
  });

  it("消えたノートを指す usedIn は無視する", () => {
    expect(resolveAssetFolders({ usedIn: [usage("消えたノート")] }, lookup)).toEqual([]);
  });
});

describe("assetFolderValues", () => {
  it("出どころを問わず名前だけ返す（絞り込み用）", () => {
    expect(
      assetFolderValues({ noteContexts: ["下書き"], usedIn: [usage("n2")] }, lookup),
    ).toEqual(["下書き", "材料X", "実験A"]);
  });
});
