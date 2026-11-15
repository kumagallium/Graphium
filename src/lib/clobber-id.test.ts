import { describe, expect, it } from "vitest";
import { isClobberingId } from "./clobber-id";

describe("isClobberingId", () => {
  it("存在確認に使われる名前の id は true", () => {
    for (const id of ["__TAURI_INTERNALS__", "__TAURI__", "process", "module", "Buffer"]) {
      expect(isClobberingId(id)).toBe(true);
    }
  });
  it("脚注・見出しの id は false", () => {
    for (const id of ["fn1", "cite_note-1", "ref-3", "section-2", "History", "Origin", "Location", "Name", "Images", "Links", "Open", "Top", ""]) {
      expect(isClobberingId(id)).toBe(false);
    }
  });
});
