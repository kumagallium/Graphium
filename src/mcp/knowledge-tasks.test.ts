import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addTask,
  lookupTask,
  markTaskDone,
  readTaskLedger,
  TASK_PURGE_GRACE_MS,
  TASK_TTL_MS,
  TaskLedgerCorruptError,
  tasksLedgerPath,
  type KnowledgeTask,
} from "./knowledge-tasks";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "knowledge-tasks-"));
  mkdirSync(join(root, "appdata"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const task = (id: string, createdAt: Date): KnowledgeTask => ({
  taskId: id,
  kind: "claims",
  noteId: "n",
  inputHash: "h",
  language: "ja",
  createdAt: createdAt.toISOString(),
});

describe("課題の台帳", () => {
  it("台帳が無ければ空。足して照合できる", async () => {
    expect(readTaskLedger(root).tasks).toEqual({});
    expect(lookupTask(root, "a")).toEqual({ ok: false, code: "TASK_NOT_FOUND" });
    expect(await addTask(root, task("a", new Date()))).toEqual({ ok: true });
    expect(lookupTask(root, "a")).toMatchObject({ ok: true, task: { taskId: "a" } });
  });

  it("期限（24 時間）の境目と done", async () => {
    const created = new Date("2026-10-26T00:00:00.000Z");
    await addTask(root, task("a", created), created);
    expect(lookupTask(root, "a", new Date(created.getTime() + TASK_TTL_MS)).ok).toBe(true);
    expect(lookupTask(root, "a", new Date(created.getTime() + TASK_TTL_MS + 1))).toEqual({
      ok: false,
      code: "TASK_EXPIRED",
    });
    await markTaskDone(root, "a", created);
    expect(lookupTask(root, "a", created)).toEqual({ ok: false, code: "TASK_DONE" });
  });

  it("期限切れは猶予のあと、書き込むときに掃除される", async () => {
    const old = new Date("2026-10-01T00:00:00.000Z");
    await addTask(root, task("old", old), old);
    const later = new Date(old.getTime() + TASK_TTL_MS + TASK_PURGE_GRACE_MS - 1);
    await addTask(root, task("b", later), later);
    expect(Object.keys(readTaskLedger(root).tasks).sort()).toEqual(["b", "old"]);
    const muchLater = new Date(old.getTime() + TASK_TTL_MS + TASK_PURGE_GRACE_MS + 1);
    await addTask(root, task("c", muchLater), muchLater);
    expect(Object.keys(readTaskLedger(root).tasks).sort()).toEqual(["b", "c"]);
  });

  it("壊れた台帳は黙って空にしない（読むのも書くのも例外）", async () => {
    writeFileSync(tasksLedgerPath(root), "{broken");
    expect(() => readTaskLedger(root)).toThrow(TaskLedgerCorruptError);
    await expect(addTask(root, task("a", new Date()))).rejects.toBeInstanceOf(TaskLedgerCorruptError);
    expect(readFileSync(tasksLedgerPath(root), "utf8")).toBe("{broken");
    writeFileSync(tasksLedgerPath(root), JSON.stringify({ version: 2, tasks: {} }));
    expect(() => readTaskLedger(root)).toThrow(TaskLedgerCorruptError);
  });
});
