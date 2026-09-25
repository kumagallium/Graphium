import { describe, expect, it } from "vitest";
import { pendingPeekSave, queuePeekSave } from "./peek-save-queue";
import type { GraphiumDocument } from "./document-types";

function makeDoc(title: string): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-09-25T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

/** 外から解決・失敗させられる書き込み */
function deferredWrite() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  let started = false;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const write = () => {
    started = true;
    return promise;
  };
  return { write, resolve, reject, started: () => started };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("queuePeekSave / pendingPeekSave", () => {
  it("列が空なら null、並んでいる間は Promise、書き終わると空に戻る", async () => {
    expect(pendingPeekSave("n-empty")).toBeNull();
    const w = deferredWrite();
    const run = queuePeekSave("n-empty", makeDoc("v2"), w.write);
    expect(pendingPeekSave("n-empty")).not.toBeNull();
    w.resolve();
    await run;
    await flush();
    expect(pendingPeekSave("n-empty")).toBeNull();
  });

  it("同じノートの保存は、先の保存が終わるまで書き始めない（追い越さない）", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    const runA = queuePeekSave("n-order", makeDoc("A"), a.write);
    const runB = queuePeekSave("n-order", makeDoc("B"), b.write);
    await flush();
    expect(a.started()).toBe(true);
    expect(b.started()).toBe(false);
    a.resolve();
    await runA;
    await flush();
    expect(b.started()).toBe(true);
    b.resolve();
    await runB;
  });

  it("待っている側には最後の保存の結果（doc と成否）が返る", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    const docB = makeDoc("B");
    void queuePeekSave("n-last", makeDoc("A"), a.write);
    const runB = queuePeekSave("n-last", docB, b.write).catch(() => {});
    const pending = pendingPeekSave("n-last");
    a.resolve();
    await flush();
    b.reject(new Error("disk full"));
    await runB;
    await expect(pending).resolves.toEqual({ doc: docB, saved: false });
  });

  it("先の保存が失敗しても後の保存は書く。失敗は呼び出し側に reject で返る", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    const runA = queuePeekSave("n-fail", makeDoc("A"), a.write);
    const runB = queuePeekSave("n-fail", makeDoc("B"), b.write);
    a.reject(new Error("offline"));
    await expect(runA).rejects.toThrow("offline");
    await flush();
    expect(b.started()).toBe(true);
    b.resolve();
    await expect(runB).resolves.toBeUndefined();
  });

  it("別のノートの保存は待たない", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    void queuePeekSave("n-x", makeDoc("X"), a.write);
    void queuePeekSave("n-y", makeDoc("Y"), b.write);
    await flush();
    expect(a.started()).toBe(true);
    expect(b.started()).toBe(true);
    a.resolve();
    b.resolve();
  });
});
