import { describe, it, expect } from "vitest";
import { computeFolderDrop, readDraggedNoteIds } from "./folder-drop";
import { UNFILED_PATH } from "./folder-tree-model";

describe("computeFolderDrop", () => {
  it("フォルダを開いた状態の移動は、そこから出て落とし先に入る", () => {
    expect(computeFolderDrop(["Sourdough"], "Kiln", "Sourdough", "move")).toEqual(["Kiln"]);
  });

  it("移動でも、開いていたフォルダ以外は剥がさない", () => {
    expect(computeFolderDrop(["Sourdough", "Recipes"], "Kiln", "Sourdough", "move")).toEqual([
      "Recipes",
      "Kiln",
    ]);
  });

  it("すべてのノートからの移動は、出るべき場所が無いので足すだけ", () => {
    expect(computeFolderDrop(["Recipes"], "Kiln", null, "move")).toEqual(["Recipes", "Kiln"]);
  });

  it("未分類からの移動も足すだけ", () => {
    expect(computeFolderDrop([], "Kiln", UNFILED_PATH, "move")).toEqual(["Kiln"]);
  });

  it("コピーは開いていたフォルダから出ない", () => {
    expect(computeFolderDrop(["Sourdough"], "Kiln", "Sourdough", "copy")).toEqual([
      "Sourdough",
      "Kiln",
    ]);
  });

  it("親フォルダを開いていたら、その子からも出る", () => {
    expect(computeFolderDrop(["Sourdough/Day 7"], "Kiln", "Sourdough", "move")).toEqual(["Kiln"]);
  });

  it("似た名前のフォルダは巻き込まない（Sourdough で Sourdoughs を剥がさない）", () => {
    expect(computeFolderDrop(["Sourdoughs"], "Kiln", "Sourdough", "move")).toEqual([
      "Sourdoughs",
      "Kiln",
    ]);
  });

  it("既に落とし先に入っているなら何もしない", () => {
    expect(computeFolderDrop(["Kiln"], "Kiln", null, "copy")).toBeNull();
  });

  it("同じフォルダへ移動しても変化なしとみなす", () => {
    expect(computeFolderDrop(["Kiln"], "Kiln", "Kiln", "move")).toBeNull();
  });

  it("未分類は落とし先にできない", () => {
    expect(computeFolderDrop(["Kiln"], UNFILED_PATH, null, "move")).toBeNull();
    expect(computeFolderDrop(["Kiln"], "  ", null, "move")).toBeNull();
  });

  it("表記ゆれは落とし先の表記に畳む", () => {
    expect(computeFolderDrop(["kiln"], "Kiln", null, "copy")).toBeNull();
  });
});

describe("readDraggedNoteIds", () => {
  it("JSON 配列から id を取り出す", () => {
    expect(readDraggedNoteIds('["a","b"]')).toEqual(["a", "b"]);
  });

  it("壊れた値・空・配列以外は空配列", () => {
    expect(readDraggedNoteIds("not json")).toEqual([]);
    expect(readDraggedNoteIds("")).toEqual([]);
    expect(readDraggedNoteIds(null)).toEqual([]);
    expect(readDraggedNoteIds('{"a":1}')).toEqual([]);
    expect(readDraggedNoteIds('["a", 1, null, ""]')).toEqual(["a"]);
  });
});
