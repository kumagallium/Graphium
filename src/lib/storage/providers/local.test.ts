// LocalStorageProvider の appData 一覧・削除（fake-indexeddb）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { LocalStorageProvider } from "./local";

let provider: LocalStorageProvider;

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  provider = new LocalStorageProvider();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listAppDataKeys / deleteAppData", () => {
  it("prefix で始まるキーだけを接頭辞なしで返す", async () => {
    await provider.writeAppData!("maint-run-a", { a: 1 });
    await provider.writeAppData!("maint-run-b", { b: 1 });
    await provider.writeAppData!("maint-copy-a", { c: 1 });
    await provider.writeAppData!("snapshot:x", { d: 1 });
    const keys = await provider.listAppDataKeys!("maint-run-");
    expect(keys.sort()).toEqual(["maint-run-a", "maint-run-b"]);
  });

  it("該当が無ければ空配列", async () => {
    expect(await provider.listAppDataKeys!("none-")).toEqual([]);
  });

  it("delete で実際に消え、無いキーの削除は成功する", async () => {
    await provider.writeAppData!("k1", { v: 1 });
    await provider.deleteAppData!("k1");
    expect(await provider.readAppData!("k1")).toBeNull();
    expect(await provider.listAppDataKeys!("k")).toEqual([]);
    await expect(provider.deleteAppData!("k1")).resolves.toBeUndefined();
  });

  it("`:` 入りの既存キーは列挙しない", async () => {
    await provider.writeAppData!("snapshot:x", { a: 1 });
    await provider.writeAppData!("snapshot-y", { a: 1 });
    expect(await provider.listAppDataKeys!("snapshot")).toEqual(["snapshot-y"]);
  });

  it("不正なキー・prefix は拒否する（空 prefix を含む）", async () => {
    await expect(provider.listAppDataKeys!("")).rejects.toThrow();
    await expect(provider.listAppDataKeys!("a:b")).rejects.toThrow();
    await expect(provider.deleteAppData!("a/b")).rejects.toThrow();
    await expect(provider.deleteAppData!("")).rejects.toThrow();
  });
});
