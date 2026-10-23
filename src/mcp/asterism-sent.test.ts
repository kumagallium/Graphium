// asterism-sent.ts（「Asterism に送った」台帳）の回帰テスト。

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markAsterismSent, readSentLedger, SentLedgerCorruptError, sentLedgerPath } from "./asterism-sent";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "asterism-sent-"));
  mkdirSync(join(root, "notes"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";

describe("asterism-sent", () => {
  it("台帳が無ければ空", () => {
    expect(readSentLedger(root)).toEqual({ version: 1, sent: {} });
  });

  it("記録して読み戻せる（exportedAt 省略は null）", async () => {
    const r = await markAsterismSent({ ids: ["a", "b"], datasetId: "ds1", exportedAt: T1 }, T2, root);
    expect(r).toEqual({ marked: 2, alreadySent: 0, ledger: sentLedgerPath(root) });
    expect(sentLedgerPath(root)).toBe(join(root, "appdata", "asterism-sent.json"));
    const file = JSON.parse(readFileSync(sentLedgerPath(root), "utf8"));
    expect(file.version).toBe(1);
    expect(file.sent.a).toEqual({ datasetId: "ds1", sentAt: T2, exportedAt: T1 });
    await markAsterismSent({ ids: ["c"], datasetId: "ds1" }, T2, root);
    expect(readSentLedger(root).sent.c.exportedAt).toBeNull();
  });

  it("2 回目は alreadySent に数え、元の記録を上書きしない", async () => {
    await markAsterismSent({ ids: ["a"], datasetId: "ds1" }, T1, root);
    const r = await markAsterismSent({ ids: ["a", "b", "b"], datasetId: "ds2" }, T2, root);
    expect(r).toMatchObject({ marked: 1, alreadySent: 1 });
    const l = readSentLedger(root);
    expect(l.sent.a).toMatchObject({ datasetId: "ds1", sentAt: T1 });
    expect(l.sent.b.datasetId).toBe("ds2");
  });

  it("全部記録済みなら書き込まない", async () => {
    const r = await markAsterismSent({ ids: [], datasetId: "ds1" }, T1, root);
    expect(r.marked).toBe(0);
    expect(existsSync(sentLedgerPath(root))).toBe(false);
  });

  it("並行して 2 件呼んでも両方残る", async () => {
    const [a, b] = await Promise.all([
      markAsterismSent({ ids: ["a"], datasetId: "ds1" }, T1, root),
      markAsterismSent({ ids: ["b"], datasetId: "ds1" }, T2, root),
    ]);
    expect(a.marked + b.marked).toBe(2);
    expect(Object.keys(readSentLedger(root).sent).sort()).toEqual(["a", "b"]);
    expect(existsSync(join(root, "appdata", "mcp-write-lock.json"))).toBe(false);
  });

  it("壊れた台帳は例外にし、上書きしない", async () => {
    mkdirSync(join(root, "appdata"), { recursive: true });
    const bad = [
      "{not json",
      JSON.stringify({ version: 1, sent: [] }),
      JSON.stringify({ version: 2, sent: {} }),
      JSON.stringify({ version: 1 }),
    ];
    for (const body of bad) {
      writeFileSync(sentLedgerPath(root), body);
      expect(() => readSentLedger(root)).toThrow(SentLedgerCorruptError);
      await expect(markAsterismSent({ ids: ["a"], datasetId: "ds1" }, T1, root)).rejects.toThrow("台帳が壊れています");
      expect(readFileSync(sentLedgerPath(root), "utf8")).toBe(body);
    }
  });
});
