import { describe, expect, it } from "vitest";
import { getOpenNoteEditor, registerOpenNoteEditor } from "./open-note-editors";

describe("開いているノートのエディタ", () => {
  it("登録したあいだだけ返し、エディタが無ければ返さない。後から開き直した登録は前の解除で消えない", () => {
    const editor = {};
    const a = { getEditor: () => editor, addLink: () => null };
    const offA = registerOpenNoteEditor("n1", a);
    expect(getOpenNoteEditor("n1")).toBe(a);
    const b = { getEditor: () => editor, addLink: () => null };
    const offB = registerOpenNoteEditor("n1", b);
    offA();
    expect(getOpenNoteEditor("n1")).toBe(b);
    offB();
    expect(getOpenNoteEditor("n1")).toBeNull();
    const off = registerOpenNoteEditor("n2", { getEditor: () => null, addLink: () => null });
    expect(getOpenNoteEditor("n2")).toBeNull();
    off();
  });
});
