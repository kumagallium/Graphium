import { describe, expect, it } from "vitest";
import { safeExternalHref } from "./safe-href";

describe("safeExternalHref", () => {
  it("http / https / mailto を通す", () => {
    expect(safeExternalHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
    expect(safeExternalHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("危険なスキームは undefined（大文字・空白・制御文字の混ぜ込みも）", () => {
    for (const u of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "file:///etc/passwd",
      "smb://host/share",
      "//evil.example/x",
      "/relative",
      "",
      null,
      undefined,
    ]) {
      expect(safeExternalHref(u as string), String(u)).toBeUndefined();
    }
  });
});
