import { describe, expect, it } from "vitest";
import { applyNewNoteWidth, buildNewNoteDraft, newNoteWidthDocFields } from "./new-note-draft";

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

describe("applyNewNoteWidth", () => {
  it("OFF なら元の doc をそのまま返す", () => {
    const doc = { title: "t" };
    expect(applyNewNoteWidth(doc, false)).toBe(doc);
  });

  it("ON で幅の項目が無ければ paperSize: a4 を足す（元の doc は書き換えない）", () => {
    const doc = { title: "t" };
    expect(applyNewNoteWidth(doc, true)).toEqual({ title: "t", paperSize: "a4" });
    expect(doc).toEqual({ title: "t" });
  });

  it("doc が fullWidth: true を持てばそれを優先する", () => {
    const doc = { title: "t", fullWidth: true };
    expect(applyNewNoteWidth(doc, true)).toBe(doc);
  });

  it("doc が paperSize を持てばそのまま", () => {
    const doc = { title: "t", paperSize: "a4" as const };
    expect(applyNewNoteWidth(doc, true)).toBe(doc);
  });

  it("fullWidth: false の明示は幅を選んでいないものとして扱う（ON なら A4）", () => {
    expect(applyNewNoteWidth({ fullWidth: false }, true)).toEqual({ fullWidth: false, paperSize: "a4" });
  });
});
