// 旧 ~/Documents/Graphium/server-data → 新 dataDir 移行の挙動テスト
//
// 実機の ~/Documents/Graphium/server-data に依存しないよう、legacyDir を
// 引数で差し替えて隔離した tmpdir で検証する。本番呼び出し（index.ts）は
// 引数を省略して LEGACY_DATA_DIR を使う。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyDataDir } from "./migration.js";

let legacyDir: string;
let newDir: string;

beforeEach(() => {
  legacyDir = mkdtempSync(join(tmpdir(), "graphium-mig-legacy-"));
  newDir = mkdtempSync(join(tmpdir(), "graphium-mig-new-"));
});

afterEach(() => {
  rmSync(legacyDir, { recursive: true, force: true });
  rmSync(newDir, { recursive: true, force: true });
});

describe("migrateLegacyDataDir", () => {
  it("noops when src === dst", () => {
    const result = migrateLegacyDataDir(legacyDir, legacyDir);
    expect(result.copied).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("noops when legacy dir does not exist", () => {
    // 一度作った legacy をすぐ消す → 旧 path が無い状態を再現
    rmSync(legacyDir, { recursive: true, force: true });
    const result = migrateLegacyDataDir(newDir, legacyDir);
    expect(result.copied).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(newDir, "models.json"))).toBe(false);
  });

  it("copies models.json + profiles.json from legacy to new", () => {
    writeFileSync(
      join(legacyDir, "models.json"),
      '[{"id":"m1","name":"x","provider":"anthropic","modelId":"x","apiBase":null,"createdAt":"2026-05-28T00:00:00Z"}]',
      "utf-8",
    );
    writeFileSync(
      join(legacyDir, "profiles.json"),
      '[{"id":"p1","name":"general","description":"","content":""}]',
      "utf-8",
    );
    const result = migrateLegacyDataDir(newDir, legacyDir);
    expect(result.copied.sort()).toEqual(["models.json", "profiles.json"]);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(newDir, "models.json"), "utf-8")).toContain('"m1"');
    expect(readFileSync(join(newDir, "profiles.json"), "utf-8")).toContain(
      '"p1"',
    );
    // 元ファイルは残す（rollback / 人手復元のため）
    expect(existsSync(join(legacyDir, "models.json"))).toBe(true);
  });

  it("recursively copies the usage subdirectory", () => {
    mkdirSync(join(legacyDir, "usage"), { recursive: true });
    writeFileSync(
      join(legacyDir, "usage", "2026-05.json"),
      '{"events":[]}',
      "utf-8",
    );
    const result = migrateLegacyDataDir(newDir, legacyDir);
    expect(result.copied).toContain("usage");
    expect(
      readFileSync(join(newDir, "usage", "2026-05.json"), "utf-8"),
    ).toBe('{"events":[]}');
  });

  it("does not overwrite when the target file already exists in new dir", () => {
    writeFileSync(
      join(legacyDir, "models.json"),
      '[{"id":"legacy"}]',
      "utf-8",
    );
    writeFileSync(join(newDir, "models.json"), '[{"id":"already"}]', "utf-8");
    const result = migrateLegacyDataDir(newDir, legacyDir);
    expect(result.copied).not.toContain("models.json");
    expect(result.skipped).toContain("models.json");
    // 既存の中身が温存される
    expect(readFileSync(join(newDir, "models.json"), "utf-8")).toBe(
      '[{"id":"already"}]',
    );
  });

  it("is idempotent: running twice has no additional effect", () => {
    writeFileSync(join(legacyDir, "models.json"), '[{"id":"x"}]', "utf-8");
    const r1 = migrateLegacyDataDir(newDir, legacyDir);
    expect(r1.copied).toContain("models.json");
    const r2 = migrateLegacyDataDir(newDir, legacyDir);
    expect(r2.copied).toEqual([]);
    expect(r2.errors).toEqual([]);
  });
});

// readModels のサイレント失敗修正に対する回帰テスト。
// 「ENOENT は静か、それ以外は warn を出して [] を返す」が崩れないことを
// console.warn のスパイで確認する。これは Documents TCC 拒否のような
// 「ファイルはあるが読めない」状況での silent failure を防ぐためのもの。
describe("models.readRawStored silent-fail policy", () => {
  it("does not warn when models.json is simply absent (ENOENT path)", async () => {
    const { listModels, setDataDir, setServerMode } = await import(
      "./models.js"
    );
    const fresh = mkdtempSync(join(tmpdir(), "graphium-models-enoent-"));
    setDataDir(fresh);
    setServerMode("node");
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
    };
    try {
      expect(listModels()).toEqual([]);
      expect(warns.filter((m) => m.includes("[models]"))).toEqual([]);
    } finally {
      console.warn = orig;
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("warns once when models.json is corrupted JSON", async () => {
    const { listModels, setDataDir, setServerMode } = await import(
      "./models.js"
    );
    const broken = mkdtempSync(join(tmpdir(), "graphium-models-broken-"));
    writeFileSync(join(broken, "models.json"), "{ this is not json", "utf-8");
    setDataDir(broken);
    setServerMode("node");
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
    };
    try {
      expect(listModels()).toEqual([]);
      expect(warns.some((m) => m.includes("[models] failed to read"))).toBe(
        true,
      );
    } finally {
      console.warn = orig;
      rmSync(broken, { recursive: true, force: true });
    }
  });
});
