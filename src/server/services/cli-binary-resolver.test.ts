import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDir } from "../config/models.js";
import { managedCopilotCliPath } from "./copilot-cli-location.js";
import {
  copilotCliPathProblem,
  copilotBinaryRuns,
  resetCopilotCliCache,
  resolveCopilotBinary,
} from "./cli-binary-resolver.js";

let work: string;
const savedEnv = { ...process.env };

function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "resolver-"));
  setDataDir(join(work, "data"));
  delete process.env.GRAPHIUM_COPILOT_CLI_PATH;
  resetCopilotCliCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(work, { recursive: true, force: true });
  resetCopilotCliCache();
});

describe("resolveCopilotBinary の優先順", () => {
  it("明示パス → 環境変数 → 取得した CLI の順", () => {
    // PATH からも既知の場所からも検出されない環境にする
    process.env.PATH = join(work, "empty");
    process.env.SHELL = "/usr/bin/false";
    const managed = managedCopilotCliPath();
    mkdirSync(join(managed, ".."), { recursive: true });
    script(managed, "exit 0");

    mkdirSync(join(work, "explicit"), { recursive: true });
    mkdirSync(join(work, "env"), { recursive: true });
    const explicit = script(join(work, "explicit", "copilot"), "exit 0");
    const fromEnv = script(join(work, "env", "copilot"), "exit 0");
    expect(resolveCopilotBinary(explicit)).toEqual({ path: explicit, source: "configured" });
    process.env.GRAPHIUM_COPILOT_CLI_PATH = fromEnv;
    expect(resolveCopilotBinary()).toEqual({ path: fromEnv, source: "configured" });
    delete process.env.GRAPHIUM_COPILOT_CLI_PATH;
    const r = resolveCopilotBinary();
    // 自動検出の候補（実機の homebrew 等）が動けばそちらが先。無ければ取得した CLI
    expect(["detected", "managed"]).toContain(r?.source);
  });

  it("指定パスの検査: 相対・UNC・スクリプト・データフォルダ内・実在しないものは採用しない", () => {
    process.env.PATH = join(work, "empty");
    process.env.SHELL = "/usr/bin/false";
    mkdirSync(join(work, "data", "media"), { recursive: true });
    const inData = script(join(work, "data", "media", "x"), "exit 0");
    const js = script(join(work, "loader.js"), "exit 0");
    for (const p of ["copilot", "\\\\host\\share\\copilot.exe", "//host/share/copilot", js, inData, join(work, "missing")]) {
      expect(copilotCliPathProblem(p), p).not.toBeNull();
      expect(resolveCopilotBinary(p)?.source, p).not.toBe("configured");
    }
    process.env.GRAPHIUM_COPILOT_CLI_PATH = inData;
    expect(resolveCopilotBinary()?.source).not.toBe("configured");
    // 通常の場所の実行ファイルは通る
    expect(copilotCliPathProblem(script(join(work, "ok-copilot"), "exit 0"))).toBeNull();
  });

  it("npm 版 copilot（bin/copilot が .js への symlink）は通る", () => {
    mkdirSync(join(work, "lib", "node_modules", "@github", "copilot"), { recursive: true });
    const loader = script(join(work, "lib", "node_modules", "@github", "copilot", "npm-loader.js"), "exit 0");
    const bin = join(work, "bin2", "copilot");
    mkdirSync(join(work, "bin2"), { recursive: true });
    symlinkSync(loader, bin);
    expect(copilotCliPathProblem(bin)).toBeNull();
    // 渡されたパス自体が .js なら従来どおり拒否
    expect(copilotCliPathProblem(loader)).toBe("script");
  });

  it("データフォルダ内は大文字小文字を変えても拒否する（大文字小文字を区別しない FS）", () => {
    if (process.platform !== "win32" && process.platform !== "darwin") return;
    mkdirSync(join(work, "data", "media"), { recursive: true });
    const inData = script(join(work, "data", "media", "y"), "exit 0");
    expect(copilotCliPathProblem(inData.replace("/data/", "/DATA/"))).not.toBeNull();
  });

  it("動かない CLI は動作確認で落とす", () => {
    const broken = script(join(work, "broken"), "exit 1");
    const fine = script(join(work, "fine"), 'echo "1.0.101"');
    expect(copilotBinaryRuns(broken)).toBe(false);
    expect(copilotBinaryRuns(fine)).toBe(true);
    expect(copilotBinaryRuns(join(work, "missing"))).toBe(false);
  });

  it("PATH 上の動かない copilot は採用せず、取得した CLI へ落ちる", () => {
    const bin = join(work, "bin");
    mkdirSync(bin);
    script(join(bin, "copilot"), "exit 1");
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    process.env.SHELL = "/usr/bin/false";
    const managed = managedCopilotCliPath();
    mkdirSync(join(managed, ".."), { recursive: true });
    script(managed, "exit 0");
    const r = resolveCopilotBinary();
    expect(r?.path).not.toBe(join(bin, "copilot"));
  });
});
