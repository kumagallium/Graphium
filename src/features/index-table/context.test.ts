import { describe, expect, it, vi } from "vitest";
import {
  openEditorSidePeek,
  setEditorSidePeekCallback,
} from "./context";

describe("editor Side Peek callback", () => {
  it("エディタごとに参照元ノートの遷移先を分離する", () => {
    const firstEditor = {};
    const secondEditor = {};
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    setEditorSidePeekCallback(firstEditor, first);
    setEditorSidePeekCallback(secondEditor, second);

    expect(openEditorSidePeek(firstEditor, "note-1")).toBe(true);
    expect(first).toHaveBeenCalledWith("note-1");
    expect(second).not.toHaveBeenCalled();

    setEditorSidePeekCallback(firstEditor, null);
    expect(openEditorSidePeek(firstEditor, "note-2")).toBe(false);
  });
});
