import { describe, expect, it } from "vitest";
import {
  applyLiveBodyWidth,
  applyLiveExternalDoc,
  applyLiveExternalDocDetailed,
  applyLiveMentionRename,
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

/**
 * registerLivePeek に渡す偽のピーク。flush でその時点の doc と write を列に並べる。
 * 保存に失敗したら「未保存」に戻す（SidePeek の doSave の catch と同じ）
 */
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
      void queuePeekSave(noteId, peek.doc, peek.write).catch(() => {
        peek.unsaved = true;
      });
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

  it("保存に失敗したら書き出させ直さない（保存先が落ちている間ずっと回り続けない）", async () => {
    // 書き込みは 1 回ごとにイベントループへ返す。書き出させ直す不具合が戻っても、テストが
    // マイクロタスクだけで回り続けて止まらず、タイムアウトで落ちるように
    const peek = fakeLivePeek("n-offline", makeDoc("v2"), async () => {
      await new Promise((r) => setTimeout(r, 0));
      throw new Error("offline");
    });
    const unregister = registerLivePeek("n-offline", peek);
    await expect(flushPeekSaves("n-offline")).resolves.toEqual({ doc: peek.doc, saved: false });
    expect(peek.flushes).toBe(1);
    // 書けなかった編集は未保存のまま（ピークがアンマウント時にもう一度書き出す）
    expect(peek.unsaved).toBe(true);
    unregister();
  });

  it("別のノートのピークには書き出させない", () => {
    const other = fakeLivePeek("n-other", makeDoc("v2"), async () => {});
    const unregister = registerLivePeek("n-other", other);
    expect(flushPeekSaves("n-mine")).toBeNull();
    expect(other.flushes).toBe(0);
    unregister();
  });
});

describe("applyLiveMentionRename（mention-live: 開いているエディタにラベルの書き換えを試みさせる）", () => {
  it("誰も開いていなければ false", () => {
    expect(applyLiveMentionRename("n-nobody", "note-B", "旧", "新", false)).toBe(false);
  });

  it("登録されたピークが true を返せば true（呼び出し側はファイルを直接書き換えない）", () => {
    const apply = (renamedId: string, oldT: string, newT: string, wiki: boolean) => {
      expect(renamedId).toBe("note-B");
      expect(oldT).toBe("旧");
      expect(newT).toBe("新");
      expect(wiki).toBe(false);
      return true;
    };
    const unregister = registerLivePeek("n-r", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: apply,
    });
    expect(applyLiveMentionRename("n-r", "note-B", "旧", "新", false)).toBe(true);
    unregister();
  });

  it("applyMentionRename を持たないピークは無視される（false）", () => {
    const unregister = registerLivePeek("n-no-port", { hasUnsaved: () => false, flush: () => {} });
    expect(applyLiveMentionRename("n-no-port", "note-B", "旧", "新", false)).toBe(false);
    unregister();
  });

  it("見つからなかった（false を返した）場合も false", () => {
    const unregister = registerLivePeek("n-not-found", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => false,
    });
    expect(applyLiveMentionRename("n-not-found", "note-B", "旧", "新", false)).toBe(false);
    unregister();
  });

  it("同じノートに複数のエディタが開いていれば、すべてに呼ぶ（すべて true なら true）", () => {
    const calls: string[] = [];
    const u1 = registerLivePeek("n-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => {
        calls.push("a");
        return true;
      },
    });
    const u2 = registerLivePeek("n-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => {
        calls.push("b");
        return true;
      },
    });
    expect(applyLiveMentionRename("n-multi", "note-B", "旧", "新", false)).toBe(true);
    expect(calls.sort()).toEqual(["a", "b"]);
    u1();
    u2();
  });

  it("同じノートに複数のエディタが開いていて、片方が失敗したら false（取りこぼしを作らない）", () => {
    // 1 つでも書き換えられなかったら、呼び出し側にファイルへの直接書き換えも
    // させる。書き換えに成功した側は自分の自動保存で同じ新ラベルを書くので、
    // 直接書き換えと食い違わない（片方だけ成功して OR で true を返すと、失敗した
    // 側が古いラベルを持ったまま残り、次の自動保存で新ラベルを巻き戻してしまう）。
    const calls: string[] = [];
    const u1 = registerLivePeek("n-mixed", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => {
        calls.push("a");
        return false;
      },
    });
    const u2 = registerLivePeek("n-mixed", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => {
        calls.push("b");
        return true;
      },
    });
    expect(applyLiveMentionRename("n-mixed", "note-B", "旧", "新", false)).toBe(false);
    // すべての口は呼ばれる（成功した側もラベルは直っている）
    expect(calls.sort()).toEqual(["a", "b"]);
    u1();
    u2();
  });

  it("別のノートのピークには呼ばない", () => {
    let called = false;
    const unregister = registerLivePeek("n-other-2", {
      hasUnsaved: () => false,
      flush: () => {},
      applyMentionRename: () => {
        called = true;
        return true;
      },
    });
    expect(applyLiveMentionRename("n-mine-2", "note-B", "旧", "新", false)).toBe(false);
    expect(called).toBe(false);
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

describe("applyLiveBodyWidth（本文の幅が外から変わった）", () => {
  it("誰も開いていなければ 0 件（何も呼ばない）", () => {
    expect(applyLiveBodyWidth("w-nobody", { fullWidth: false, paperSize: "a4" }, makeDoc("x"))).toBe(0);
  });

  it("開いているエディタ（メイン・サイドピーク）すべてに、新しい幅と書いた doc を渡す。口の無いものは数えない", () => {
    const got: string[] = [];
    const saved = makeDoc("書いた");
    const u1 = registerLivePeek("w-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyBodyWidth: (w, d) => got.push(`main:${w.paperSize}:${d.title}`),
    });
    const u2 = registerLivePeek("w-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyBodyWidth: (w, d) => got.push(`peek:${w.paperSize}:${d.title}`),
    });
    const u3 = registerLivePeek("w-multi", { hasUnsaved: () => false, flush: () => {} });
    expect(applyLiveBodyWidth("w-multi", { fullWidth: false, paperSize: "a4" }, saved)).toBe(2);
    expect(got.sort()).toEqual(["main:a4:書いた", "peek:a4:書いた"]);
    u1();
    u2();
    u3();
  });

  it("ほかのノートのエディタには届かない", () => {
    let called = 0;
    const u = registerLivePeek("w-other", {
      hasUnsaved: () => false,
      flush: () => {},
      applyBodyWidth: () => {
        called++;
      },
    });
    applyLiveBodyWidth("w-target", { fullWidth: false, paperSize: undefined }, makeDoc("x"));
    expect(called).toBe(0);
    u();
  });
});

describe("applyLiveExternalDoc（開いているページが外から書き換わった）", () => {
  it("誰も開いていなければ 0 件", () => {
    expect(applyLiveExternalDoc("x-nobody", makeDoc("新"))).toBe(0);
  });

  it("applyExternalDoc を持たないエディタ（メイン）は数えない", () => {
    const u = registerLivePeek("x-main", { hasUnsaved: () => false, flush: () => {} });
    expect(applyLiveExternalDoc("x-main", makeDoc("新"))).toBe(0);
    u();
  });

  it("未保存などで差し替えを断った（false）エディタは数えない", () => {
    const u = registerLivePeek("x-refuse", {
      hasUnsaved: () => true,
      flush: () => {},
      applyExternalDoc: () => false,
    });
    expect(applyLiveExternalDoc("x-refuse", makeDoc("新"))).toBe(0);
    u();
  });

  it("開いているエディタすべてに同じ doc を渡し、差し替えた数を返す（口の無いものは飛ばす）", () => {
    const got: string[] = [];
    const doc = makeDoc("戻した");
    const u1 = registerLivePeek("x-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyExternalDoc: (d) => {
        got.push(`a:${d.title}`);
        return true;
      },
    });
    const u2 = registerLivePeek("x-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyExternalDoc: (d) => {
        got.push(`b:${d.title}`);
        return true;
      },
    });
    const u3 = registerLivePeek("x-multi", { hasUnsaved: () => false, flush: () => {} });
    const u4 = registerLivePeek("x-multi", {
      hasUnsaved: () => false,
      flush: () => {},
      applyExternalDoc: () => false,
    });
    expect(applyLiveExternalDoc("x-multi", doc)).toBe(2);
    expect(got.sort()).toEqual(["a:戻した", "b:戻した"]);
    u1();
    u2();
    u3();
    u4();
  });

  it("ほかのノートのエディタには届かない", () => {
    let called = 0;
    const u = registerLivePeek("x-other", {
      hasUnsaved: () => false,
      flush: () => {},
      applyExternalDoc: () => {
        called++;
        return true;
      },
    });
    applyLiveExternalDoc("x-target", makeDoc("新"));
    expect(called).toBe(0);
    u();
  });
});

describe("applyLiveExternalDocDetailed（断った数も返す）", () => {
  it("成功と断りを別に数え、口の無いエディタは数えない", () => {
    const un1 = registerLivePeek("x-detail", { hasUnsaved: () => false, flush: () => {}, applyExternalDoc: () => true });
    const un2 = registerLivePeek("x-detail", { hasUnsaved: () => false, flush: () => {}, applyExternalDoc: () => false });
    const un3 = registerLivePeek("x-detail", { hasUnsaved: () => false, flush: () => {} });
    expect(applyLiveExternalDocDetailed("x-detail", makeDoc("新"))).toEqual({ applied: 1, refused: 1 });
    expect(applyLiveExternalDocDetailed("x-none", makeDoc("新"))).toEqual({ applied: 0, refused: 0 });
    un1();
    un2();
    un3();
  });
});
