import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDir } from "../config/models.js";
import { managedCopilotCliPath } from "./copilot-cli-location.js";
import {
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

    expect(resolveCopilotBinary("/explicit/copilot")).toEqual({ path: "/explicit/copilot", source: "configured" });
    process.env.GRAPHIUM_COPILOT_CLI_PATH = "/env/copilot";
    expect(resolveCopilotBinary()).toEqual({ path: "/env/copilot", source: "configured" });
    delete process.env.GRAPHIUM_COPILOT_CLI_PATH;
    const r = resolveCopilotBinary();
    // 自動検出の候補（実機の homebrew 等）が動けばそちらが先。無ければ取得した CLI
    expect(["detected", "managed"]).toContain(r?.source);
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
