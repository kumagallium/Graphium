import { describe, expect, it } from "vitest";
import { pdfExportHref } from "./export-href";

describe("pdfExportHref（監査 #37 書き出し HTML）", () => {
  it("危険なスキームは通さない", () => {
    for (const u of ["javascript:alert(1)", "JaVa\tScRiPt:alert(1)", "vbscript:x", "data:text/html,x", "file:///etc/passwd"]) {
      expect(pdfExportHref(u)).toBeUndefined();
    }
  });
  it("http(s) とアプリ内の素材参照は通す", () => {
    expect(pdfExportHref("https://example.com/a.pdf")).toBe("https://example.com/a.pdf");
    expect(pdfExportHref("local-media://abc")).toBe("local-media://abc");
    expect(pdfExportHref("file-media://abc")).toBe("file-media://abc");
    expect(pdfExportHref("media-server://abc")).toBe("media-server://abc");
  });
  it("data: / blob: / shared-blob: は href にしない", () => {
    for (const u of ["data:application/pdf;base64,AAAA", "data:image/png;base64,AAAA", "blob:https://x/1", "shared-blob:abc"]) {
      expect(pdfExportHref(u)).toBeUndefined();
    }
  });
  it("mailto: は通さない", () => {
    expect(pdfExportHref("mailto:a@example.com")).toBeUndefined();
  });
});
