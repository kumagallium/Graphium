import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFsMaintenanceStorage } from "./fs-storage";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fsst-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("createFsMaintenanceStorage", () => {
  it("書いて読める。無ければ null", async () => {
    const s = createFsMaintenanceStorage(root);
    expect(await s.readAppData("maint-run-a")).toBeNull();
    await s.writeAppData("maint-run-a", { x: 1 });
    expect(await s.readAppData("maint-run-a")).toEqual({ x: 1 });
  });

  it("壊れた JSON は null を返し stderr に出す", async () => {
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(join(root, "appdata", "bad.json"), "{oops");
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const s = createFsMaintenanceStorage(root);
    expect(await s.readAppData("bad")).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("無効なキーは throw する", async () => {
    const s = createFsMaintenanceStorage(root);
    await expect(s.readAppData("../x")).rejects.toThrow();
    await expect(s.writeAppData("a:b", {})).rejects.toThrow();
    await expect(s.listAppDataKeys("a/b")).rejects.toThrow();
    await expect(s.deleteAppData("")).rejects.toThrow();
  });

  it("list は prefix 一致の .json だけ（.tmp- は除く）", async () => {
    const s = createFsMaintenanceStorage(root);
    expect(await s.listAppDataKeys("maint-")).toEqual([]);
    await s.writeAppData("maint-run-1", {});
    await s.writeAppData("maint-copy-1", {});
    await s.writeAppData("other", {});
    writeFileSync(join(root, "appdata", "maint-run-2.json.tmp-1"), "{}");
    expect((await s.listAppDataKeys("maint-")).sort()).toEqual(["maint-copy-1", "maint-run-1"]);
    expect(await s.listAppDataKeys("maint-run-")).toEqual(["maint-run-1"]);
  });

  it("delete は実削除。無くても何もしない", async () => {
    const s = createFsMaintenanceStorage(root);
    await s.writeAppData("k", {});
    await s.deleteAppData("k");
    expect(await s.readAppData("k")).toBeNull();
    await expect(s.deleteAppData("k")).resolves.toBeUndefined();
  });
});
