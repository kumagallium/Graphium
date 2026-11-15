// LocalFilesystemProvider.extractFileId: 他人のノートに仕込まれた file-media:// を id として扱わない
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { LocalFilesystemProvider } from "./filesystem";

describe("extractFileId", () => {
  const p = new LocalFilesystemProvider();

  it("通常の素材 id（UUID・拡張子付き）は取り出す", () => {
    expect(p.extractFileId("file-media://3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    expect(p.extractFileId("file-media://m1.png")).toBe("m1.png");
  });

  it("相対パス・絶対パス・UNC・ドライブ指定は null（読みに行かせない）", () => {
    for (const bad of [
      "file-media://../../.ssh/id_rsa",
      "file-media:///Users/x/.ssh/id_rsa",
      "file-media://\\\\attacker.example\\share\\a.png",
      "file-media://C:\\Windows\\win.ini",
      "file-media://a/b",
    ]) {
      expect(p.extractFileId(bad), bad).toBeNull();
    }
  });

  it("別の形式の URL は null のまま", () => {
    expect(p.extractFileId("https://example.com/a.png")).toBeNull();
  });
});
