// /api/storage/appdata の一覧・削除（キー・prefix の検証を含む）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "./storage.js";

let dir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), "graphium-storage-test-"));
  process.env.DATA_DIR = dir;
  mkdirSync(join(dir, "appdata"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /appdata?prefix=", () => {
  it("prefix 一致の .json のキーだけを拡張子なしで返す", async () => {
    const ad = join(dir, "appdata");
    writeFileSync(join(ad, "maint-run-a.json"), "{}");
    writeFileSync(join(ad, "maint-run-b.json"), "{}");
    writeFileSync(join(ad, "maint-copy-a.json"), "{}");
    writeFileSync(join(ad, "maint-run-c.txt"), "x");
    mkdirSync(join(ad, "maint-run-dir.json"));
    const res = await app.request("/appdata?prefix=maint-run-");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: string[] };
    expect(body.keys.sort()).toEqual(["maint-run-a", "maint-run-b"]);
  });

  it("prefix 無し・空・不正は 400", async () => {
    for (const q of ["", "?prefix=", "?prefix=a%2Fb", "?prefix=..", "?prefix=a:b"]) {
      const res = await app.request(`/appdata${q}`);
      expect(res.status).toBe(400);
    }
  });

  it("既存の GET /appdata/:key と共存する", async () => {
    writeFileSync(join(dir, "appdata", "k1.json"), '{"v":1}');
    const res = await app.request("/appdata/k1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 1 });
  });
});

describe("DELETE /appdata/:key", () => {
  it("実ファイルを削除し、無くても 200", async () => {
    const path = join(dir, "appdata", "k1.json");
    writeFileSync(path, "{}");
    expect((await app.request("/appdata/k1", { method: "DELETE" })).status).toBe(200);
    expect(existsSync(path)).toBe(false);
    expect((await app.request("/appdata/k1", { method: "DELETE" })).status).toBe(200);
  });

  it("不正なキーは 400 でファイルを触らない", async () => {
    writeFileSync(join(dir, "appdata", "k1.json"), "{}");
    for (const k of ["a:b", ".x", "a%20b", "a%2Fb"]) {
      const res = await app.request(`/appdata/${k}`, { method: "DELETE" });
      expect(res.status).toBe(400);
    }
    expect(existsSync(join(dir, "appdata", "k1.json"))).toBe(true);
  });
});
