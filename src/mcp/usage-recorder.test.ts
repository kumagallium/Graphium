// ユーザーの実 vault には触らず、mkdtempSync で作った一時ディレクトリに書き込む。
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpUsageRecorder } from "./usage-recorder";
import type { AiUsageFile } from "../features/ai-usage/usage-log";

describe("createMcpUsageRecorder", () => {
  let dir: string;
  const at = new Date("2026-11-08T06:00:00Z");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-usage-"));
    mkdirSync(join(dir, "wiki"), { recursive: true });
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "wiki", "w1.json"), "{}");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (session: string): AiUsageFile =>
    JSON.parse(readFileSync(join(dir, "appdata", `ai-usage-20261108-mcp-${session}.json`), "utf8"));

  it("wiki にあるものは wiki:、無ければ note: として、このプロセスのファイルに積む", async () => {
    const rec = createMcpUsageRecorder({ root: () => dir, session: "p1", getClientName: () => "claude-code" });
    await Promise.all([rec.recordRead("w1", { at }), rec.recordRead("n1", { at })]);
    const f = read("p1");
    expect(f.writer).toBe("mcp");
    expect(f.client).toBe("claude-code");
    expect(f.events.map((e) => [e.ref, e.ev, e.g])).toEqual([
      ["wiki:w1", "read", "mcp-p1"],
      ["note:n1", "read", "mcp-p1"],
    ]);
  });

  it("2 つのプロセスは別のファイルに書く", async () => {
    const a = createMcpUsageRecorder({ root: () => dir, session: "pa" });
    const b = createMcpUsageRecorder({ root: () => dir, session: "pb" });
    await Promise.all([a.recordRead("w1", { at }), b.recordRead("w1", { at })]);
    expect(read("pa").events).toHaveLength(1);
    expect(read("pb").events).toHaveLength(1);
    // 一時ファイルが残っていない
    expect(readdirSync(join(dir, "appdata")).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("壊れたファイルは作り直す", async () => {
    mkdirSync(join(dir, "appdata"), { recursive: true });
    writeFileSync(join(dir, "appdata", "ai-usage-20261108-mcp-pc.json"), "{not json");
    const rec = createMcpUsageRecorder({ root: () => dir, session: "pc" });
    await rec.recordRead("w1", { at });
    expect(read("pc").events).toHaveLength(1);
  });

  it("書けなくても投げない", async () => {
    // appdata をファイルにして、ディレクトリを作れなくする
    writeFileSync(join(dir, "appdata"), "x");
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rec = createMcpUsageRecorder({ root: () => dir, session: "pd" });
    await expect(rec.recordRead("w1", { at })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
