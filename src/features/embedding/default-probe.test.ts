import { describe, it, expect } from "vitest";
import { versionsImplyApiUse } from "./default-probe";

describe("versionsImplyApiUse", () => {
  it("is false for an empty store, text-only rows and local versions", () => {
    expect(versionsImplyApiUse(new Map())).toBe(false);
    expect(versionsImplyApiUse(new Map([["text-only", 3], ["", 1]]))).toBe(false);
    expect(versionsImplyApiUse(new Map([["local:bge-m3-q8", 120]]))).toBe(false);
  });

  it("is true when any API-made vectors remain", () => {
    expect(versionsImplyApiUse(new Map([["local:bge-m3-q8", 120], ["multilingual-e5-large", 1]]))).toBe(true);
    expect(versionsImplyApiUse(new Map([["text-embedding-3-small", 40]]))).toBe(true);
  });

  it("ignores versions with zero rows", () => {
    expect(versionsImplyApiUse(new Map([["text-embedding-3-small", 0]]))).toBe(false);
  });
});
