import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// rename だけ差し替えられるようにする（他は本物）
const renameMock = vi.hoisted(() => ({ fn: null as null | ((a: string, b: string) => Promise<void>) }));
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return { ...real, rename: (a: string, b: string) => (renameMock.fn ?? real.rename)(a, b) };
});

import { writeFileAtomic } from "./atomic-write";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atomic-"));
});
afterEach(() => {
  renameMock.fn = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("内容を書き、親ディレクトリも作り、一時ファイルを残さない", async () => {
    const p = join(dir, "sub", "note-index.json");
    await writeFileAtomic(p, '{"a":1}');
    expect(readFileSync(p, "utf8")).toBe('{"a":1}');
    expect(readdirSync(join(dir, "sub"))).toEqual(["note-index.json"]);
  });

  it("rename が失敗したら一時ファイルを消して throw する", async () => {
    renameMock.fn = async () => {
      throw Object.assign(new Error("boom"), { code: "EACCES" });
    };
    const p = join(dir, "x.json");
    await expect(writeFileAtomic(p, "{}")).rejects.toThrow("boom");
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("EBUSY は再試行して成功する", async () => {
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let n = 0;
    renameMock.fn = async (a, b) => {
      if (n++ < 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return real.rename(a, b);
    };
    const p = join(dir, "y.json");
    await writeFileAtomic(p, "{}");
    expect(n).toBe(3);
    expect(readFileSync(p, "utf8")).toBe("{}");
  });
});
