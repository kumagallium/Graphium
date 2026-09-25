import { describe, expect, it } from "vitest";
import {
  flushPeekSaves,
  hasPendingPeekEdits,
  pendingPeekSave,
  queuePeekSave,
  registerLivePeek,
  releaseUnsavedPeekDoc,
  unsavedPeekDoc,
} from "./peek-save-queue";
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

/** registerLivePeek に渡す偽のピーク。flush でその時点の doc と write を列に並べる */
function fakeLivePeek(noteId: string, doc: GraphiumDocument, write: () => Promise<void>) {
  const peek = {
    unsaved: true,
    flushes: 0,
    doc,
    write,
    hasUnsaved: () => peek.unsaved,
    flush: () => {
      peek.flushes += 1;
      peek.unsaved = false;
      void queuePeekSave(noteId, peek.doc, peek.write).catch(() => {});
    },
  };
  return peek;
}

describe("開いているピーク（registerLivePeek / hasPendingPeekEdits / flushPeekSaves）", () => {
  it("未保存のピークがあれば hasPendingPeekEdits は true。登録を外せば false", () => {
    const peek = fakeLivePeek("n-live", makeDoc("v2"), async () => {});
    const unregister = registerLivePeek("n-live", peek);
    expect(hasPendingPeekEdits("n-live")).toBe(true);
    peek.unsaved = false;
    expect(hasPendingPeekEdits("n-live")).toBe(false);
    peek.unsaved = true;
    unregister();
    expect(hasPendingPeekEdits("n-live")).toBe(false);
  });

  it("書き込み中の保存があれば、開いているピークが無くても true", async () => {
    const w = deferredWrite();
    const run = queuePeekSave("n-inflight", makeDoc("v2"), w.write);
    expect(hasPendingPeekEdits("n-inflight")).toBe(true);
    w.resolve();
    await run;
    await flush();
    expect(hasPendingPeekEdits("n-inflight")).toBe(false);
  });

  it("flushPeekSaves はピークに今すぐ書き出させ、書き終わってから解決する", async () => {
    const w = deferredWrite();
    const doc = makeDoc("v2");
    const peek = fakeLivePeek("n-flush", doc, w.write);
    const unregister = registerLivePeek("n-flush", peek);
    const settled = flushPeekSaves("n-flush");
    expect(settled).not.toBeNull();
    // 呼んだその場で書き始める（自動保存の 3 秒を待たない）
    expect(peek.flushes).toBe(1);
    expect(w.started()).toBe(true);
    let done = false;
    void settled!.then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);
    w.resolve();
    await expect(settled).resolves.toEqual({ doc, saved: true });
    expect(pendingPeekSave("n-flush")).toBeNull();
    unregister();
  });

  it("待つものが無ければ null（ピークが無い・未保存が無い）", () => {
    expect(flushPeekSaves("n-none")).toBeNull();
    const peek = fakeLivePeek("n-clean", makeDoc("v1"), async () => {});
    peek.unsaved = false;
    const unregister = registerLivePeek("n-clean", peek);
    expect(flushPeekSaves("n-clean")).toBeNull();
    expect(peek.flushes).toBe(0);
    unregister();
  });

  it("待つ間にピークにまた打たれたら、その分も書き出させて待つ", async () => {
    const first = deferredWrite();
    const second = deferredWrite();
    const docV3 = makeDoc("v3");
    const peek = fakeLivePeek("n-again", makeDoc("v2"), first.write);
    const unregister = registerLivePeek("n-again", peek);
    const settled = flushPeekSaves("n-again")!;
    let done = false;
    void settled.then(() => {
      done = true;
    });
    // 1 本目の書き込み中に、もう一度打たれた
    peek.unsaved = true;
    peek.doc = docV3;
    peek.write = second.write;
    first.resolve();
    await flush();
    // 1 本目が書き終わった時点で、もう一度書き出させている
    expect(peek.flushes).toBe(2);
    expect(second.started()).toBe(true);
    expect(done).toBe(false);
    second.resolve();
    await expect(settled).resolves.toEqual({ doc: docV3, saved: true });
    unregister();
  });

  it("待つ間に列に並んだ保存（閉じたピークの書き出しなど）も待つ", async () => {
    const first = deferredWrite();
    const second = deferredWrite();
    const docV3 = makeDoc("v3");
    void queuePeekSave("n-queued", makeDoc("v2"), first.write);
    const settled = flushPeekSaves("n-queued")!;
    let done = false;
    void settled.then(() => {
      done = true;
    });
    void queuePeekSave("n-queued", docV3, second.write);
    first.resolve();
    await flush();
    expect(done).toBe(false);
    second.resolve();
    await expect(settled).resolves.toEqual({ doc: docV3, saved: true });
  });

  it("別のノートのピークには書き出させない", () => {
    const other = fakeLivePeek("n-other", makeDoc("v2"), async () => {});
    const unregister = registerLivePeek("n-other", other);
    expect(flushPeekSaves("n-mine")).toBeNull();
    expect(other.flushes).toBe(0);
    unregister();
  });
});

describe("保存できなかった doc（unsavedPeekDoc / releaseUnsavedPeekDoc）", () => {
  it("失敗した保存の doc を残し、同じノートの後の保存が成功したら消す", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    const docA = makeDoc("A");
    const runA = queuePeekSave("n-unsaved", docA, a.write).catch(() => {});
    a.reject(new Error("offline"));
    await runA;
    await flush();
    expect(unsavedPeekDoc("n-unsaved")).toBe(docA);
    const runB = queuePeekSave("n-unsaved", makeDoc("B"), b.write);
    b.resolve();
    await runB;
    await flush();
    expect(unsavedPeekDoc("n-unsaved")).toBeNull();
  });

  it("引き取ると消える。別の失敗で差し替わっていれば残す", async () => {
    const a = deferredWrite();
    const b = deferredWrite();
    const docA = makeDoc("A");
    const docB = makeDoc("B");
    const runA = queuePeekSave("n-release", docA, a.write).catch(() => {});
    a.reject(new Error("offline"));
    await runA;
    await flush();
    const runB = queuePeekSave("n-release", docB, b.write).catch(() => {});
    b.reject(new Error("offline"));
    await runB;
    await flush();
    releaseUnsavedPeekDoc("n-release", docA);
    expect(unsavedPeekDoc("n-release")).toBe(docB);
    releaseUnsavedPeekDoc("n-release", docB);
    expect(unsavedPeekDoc("n-release")).toBeNull();
  });
});
