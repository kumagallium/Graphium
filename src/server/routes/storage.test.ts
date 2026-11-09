// /api/storage/appdata の一覧・削除（キー・prefix の検証を含む）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "./storage.js";
import { appDataFileName, appDataKeyFromFileName } from "../app-data-file-name.js";

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

describe("appdata のファイル名（: を含むキー）", () => {
  const ad = () => join(dir, "appdata");

  it("PUT は符号化した名前で書き、GET で読める", async () => {
    const put = await app.request("/appdata/snapshot-index:abc", { method: "PUT", body: '{"v":1}' });
    expect(put.status).toBe(200);
    expect(existsSync(join(ad(), "snapshot-index%3Aabc.json"))).toBe(true);
    expect(existsSync(join(ad(), "snapshot-index:abc.json"))).toBe(false);
    const res = await app.request("/appdata/snapshot-index:abc");
    expect(await res.json()).toEqual({ v: 1 });
  });

  it("新しい名前が無ければ旧来の名前から読み、新しい名前へ移す（旧ファイルは残す）", async () => {
    // Windows の ADS は再現できないので、旧来名は `%` を含むキーで代用する
    writeFileSync(join(ad(), "a%b.json"), '{"old":1}');
    const res = await app.request("/appdata/a%25b");
    expect(await res.json()).toEqual({ old: 1 });
    expect(readFileSync(join(ad(), "a%25b.json"), "utf-8")).toBe('{"old":1}');
    expect(existsSync(join(ad(), "a%b.json"))).toBe(true);
  });

  it("新しい名前があればそちらを優先する", async () => {
    writeFileSync(join(ad(), "a%b.json"), '{"old":1}');
    writeFileSync(join(ad(), "a%25b.json"), '{"new":1}');
    const res = await app.request("/appdata/a%25b");
    expect(await res.json()).toEqual({ new: 1 });
  });

  it("どちらも無ければ null", async () => {
    expect(await (await app.request("/appdata/x:y")).json()).toBeNull();
  });

  it("一覧は規則に合わないキーを従来どおり除外する", async () => {
    writeFileSync(join(ad(), "snapshot%3Aabc.json"), "{}");
    writeFileSync(join(ad(), "k-1.json"), "{}");
    const res = await app.request("/appdata?prefix=k-");
    expect(((await res.json()) as { keys: string[] }).keys).toEqual(["k-1"]);
    const none = await app.request("/appdata?prefix=snapshot");
    expect(((await none.json()) as { keys: string[] }).keys).toEqual([]);
  });
});

describe("appDataFileName の往復", () => {
  it("a:b%c は a%3Ab%25c.json になり、戻せる", () => {
    expect(appDataFileName("a:b%c")).toBe("a%3Ab%25c.json");
    expect(appDataKeyFromFileName("a%3Ab%25c")).toBe("a:b%c");
    for (const k of ["plain", "snapshot:abc", "x%3Ay", "%25", "a%:b"]) {
      expect(appDataKeyFromFileName(appDataFileName(k).slice(0, -5))).toBe(k);
    }
  });
});

describe("GET /media/:id の本体探し", () => {
  const meta = (name: string, mimeType: string) => JSON.stringify({ name, mimeType, createdTime: "2026-10-29T00:00:00Z" });

  beforeEach(() => {
    mkdirSync(join(dir, "media"), { recursive: true });
  });

  it(".txt のデータ素材は本体として返す（以前は 404 だった）", async () => {
    const md = join(dir, "media");
    writeFileSync(join(md, "d1.txt"), "min\ttemp\n0\t25\n");
    writeFileSync(join(md, "d1.meta.json"), meta("oven-preheat.txt", "text/plain"));
    const res = await app.request("/media/d1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("min\ttemp\n0\t25\n");
  });

  it("本体があれば、横の <id>.txt（デスクトップの抽出テキスト）ではなく本体を返す", async () => {
    const md = join(dir, "media");
    writeFileSync(join(md, "p1.txt"), "extracted text");
    writeFileSync(join(md, "p1.pdf"), "%PDF-1.7");
    writeFileSync(join(md, "p1.meta.json"), meta("paper.pdf", "application/pdf"));
    const res = await app.request("/media/p1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("テキストでない素材の <id>.txt だけが残っていても本体とはみなさない", async () => {
    const md = join(dir, "media");
    writeFileSync(join(md, "i1.txt"), "ocr text");
    writeFileSync(join(md, "i1.meta.json"), meta("photo.png", "image/png"));
    expect((await app.request("/media/i1")).status).toBe(404);
    // メタデータが無いもの（URL ブックマークの原文など）も同じ
    writeFileSync(join(md, "u1.txt"), "reader text");
    expect((await app.request("/media/u1")).status).toBe(404);
  });
});
