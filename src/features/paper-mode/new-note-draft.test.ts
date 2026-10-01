import { describe, expect, it } from "vitest";
import { buildNewNoteDraft, newNoteWidthDocFields } from "./new-note-draft";

describe("newNoteWidthDocFields", () => {
  it("OFF なら何も足さない（標準は項目なし）", () => {
    expect(newNoteWidthDocFields(false)).toEqual({});
  });

  it("ON なら paperSize: a4 だけを足す（fullWidth は足さない）", () => {
    expect(newNoteWidthDocFields(true)).toEqual({ paperSize: "a4" });
  });
});

describe("buildNewNoteDraft", () => {
  it("フォルダが無ければ種は作らない（設定が ON でも。エディタが設定を読む）", () => {
    expect(buildNewNoteDraft(undefined, false)).toBeNull();
    expect(buildNewNoteDraft(undefined, true)).toBeNull();
  });

  it("フォルダ付き・OFF: noteContexts だけの種", () => {
    expect(buildNewNoteDraft(["実験"], false)).toEqual({ title: "", pages: [], noteContexts: ["実験"] });
  });

  it("フォルダ付き・ON: noteContexts と paperSize: a4 の種", () => {
    expect(buildNewNoteDraft(["実験"], true)).toEqual({
      title: "",
      pages: [],
      noteContexts: ["実験"],
      paperSize: "a4",
    });
  });
});
