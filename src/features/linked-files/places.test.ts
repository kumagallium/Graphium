import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const isTauri = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../lib/platform", () => ({ isTauri: () => isTauri() }));

import { listPlaces, registerPlace, renamePlace, removePlace, pickPlaceFile, statLinks, openLinkedFile, revealLinkedFile } from "./places";

beforeEach(() => {
  invoke.mockReset();
  isTauri.mockReset();
});

describe("デスクトップ版", () => {
  beforeEach(() => isTauri.mockReturnValue(true));

  it("コマンド名と引数名（camelCase）", async () => {
    invoke.mockResolvedValue(null);
    await listPlaces();
    await registerPlace();
    await renamePlace("p", "名前");
    await removePlace("p");
    await pickPlaceFile();
    await openLinkedFile("p", "a/b");
    await revealLinkedFile("p", "a/b");
    expect(invoke.mock.calls).toEqual([
      ["place_list"],
      ["place_register"],
      ["place_rename", { id: "p", name: "名前" }],
      ["place_remove", { id: "p" }],
      ["place_pick_file"],
      ["place_open", { placeId: "p", relPath: "a/b" }],
      ["place_reveal", { placeId: "p", relPath: "a/b" }],
    ]);
  });

  it("statLinks は 2000 件ごとに分けて呼び、元の順につなぐ", async () => {
    const items = Array.from({ length: 4500 }, (_, i) => ({ placeId: "p", relPath: `f${i}` }));
    invoke.mockImplementation(async (_c: string, a: { items: { relPath: string }[] }) =>
      a.items.map((it) => ({ state: "ok", size: Number(it.relPath.slice(1)) })),
    );
    const out = await statLinks(items);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map((c) => c[1].items.length)).toEqual([2000, 2000, 500]);
    expect(out).toHaveLength(4500);
    expect(out.map((s) => s.size)).toEqual(items.map((_, i) => i));
  });

  it("statLinks は 0 件なら呼ばない", async () => {
    expect(await statLinks([])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("デスクトップ版でない", () => {
  beforeEach(() => isTauri.mockReturnValue(false));

  it("listPlaces は []、statLinks は全件 unregistered", async () => {
    expect(await listPlaces()).toEqual([]);
    expect(await statLinks([{ placeId: "p", relPath: "a" }, { placeId: "p", relPath: "b" }])).toEqual([
      { state: "unregistered" },
      { state: "unregistered" },
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ほかは desktop only を投げる", async () => {
    await expect(registerPlace()).rejects.toThrow("desktop only");
    await expect(renamePlace("p", "n")).rejects.toThrow("desktop only");
    await expect(removePlace("p")).rejects.toThrow("desktop only");
    await expect(pickPlaceFile()).rejects.toThrow("desktop only");
    await expect(openLinkedFile("p", "a")).rejects.toThrow("desktop only");
    await expect(revealLinkedFile("p", "a")).rejects.toThrow("desktop only");
  });
});
