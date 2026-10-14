// downloadBlob の戻り値（Tauri のキャンセル判別）を検証する。
import { describe, it, expect, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./platform", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { downloadBlob } from "./download-file";

describe("downloadBlob (Tauri)", () => {
  it("ダイアログをキャンセルすると false を返す", async () => {
    invoke.mockResolvedValueOnce(false);
    expect(await downloadBlob(new Blob(["x"]), "a.json")).toBe(false);
  });
  it("保存できたら true を返す", async () => {
    invoke.mockResolvedValueOnce(true);
    expect(await downloadBlob(new Blob(["x"]), "a.json")).toBe(true);
  });
});
