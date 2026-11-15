import { describe, expect, it } from "vitest";
import { isSafeStorageId } from "./safe-id";

describe("isSafeStorageId", () => {
  it("実際に生成される形の id は通す", () => {
    for (const id of [
      "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "note_1-a",
      "m1.docx",
      "日本語のid",
    ]) {
      expect(isSafeStorageId(id), id).toBe(true);
    }
  });

  it("相対・絶対パス・UNC・ドライブ指定・制御文字は断る", () => {
    for (const id of [
      "",
      "../../.ssh/id_rsa",
      "..",
      "a/b",
      "/Users/x/.ssh/id_rsa",
      "\\\\attacker.example\\share\\a.png",
      "C:\\Windows\\win.ini",
      "a:b",
      ".hidden",
      "a\u0000b",
      "a\nb",
    ]) {
      expect(isSafeStorageId(id), JSON.stringify(id)).toBe(false);
    }
  });
});
