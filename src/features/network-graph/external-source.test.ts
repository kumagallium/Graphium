import { describe, it, expect } from "vitest";
import { parseExternalSource, isExternalSourceId } from "./external-source";

describe("parseExternalSource", () => {
  it("pdf:/url:/document:/chat:/memo: を kind と key に分解する", () => {
    expect(parseExternalSource("pdf:abc")).toEqual({ kind: "pdf", key: "abc" });
    expect(parseExternalSource("url:https://example.com")).toEqual({
      kind: "url",
      key: "https://example.com",
    });
    expect(parseExternalSource("document:file-1")).toEqual({
      kind: "document",
      key: "file-1",
    });
    expect(parseExternalSource("chat:123")).toEqual({ kind: "chat", key: "123" });
    expect(parseExternalSource("memo:cap_1753000000000_ab12")).toEqual({
      kind: "memo",
      key: "cap_1753000000000_ab12",
    });
  });

  it("プレフィックス無しの素 ID は null", () => {
    expect(parseExternalSource("note-1")).toBeNull();
    expect(parseExternalSource("ca30764c-5b71-4dd1-a2c1-923deca08eec")).toBeNull();
  });

  it("isExternalSourceId は外部プレフィックスのみ true", () => {
    expect(isExternalSourceId("document:x")).toBe(true);
    expect(isExternalSourceId("chat:x")).toBe(true);
    expect(isExternalSourceId("memo:cap_1_a")).toBe(true);
    expect(isExternalSourceId("note-1")).toBe(false);
  });
});
