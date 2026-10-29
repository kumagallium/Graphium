import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCaptureIndex } from "./captures";

describe("readCaptureIndex", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "captures-"));
    mkdirSync(join(root, "appdata"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("captures.json を読める", () => {
    writeFileSync(join(root, "appdata", "captures.json"), JSON.stringify({ captures: [{ id: "a", text: "x" }] }));
    expect(readCaptureIndex(root)?.captures?.[0]?.id).toBe("a");
  });
  it("無いとき null", () => {
    expect(readCaptureIndex(root)).toBeNull();
  });
  it("壊れているとき null", () => {
    writeFileSync(join(root, "appdata", "captures.json"), "{broken");
    expect(readCaptureIndex(root)).toBeNull();
  });
});
