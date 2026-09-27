// @vitest-environment jsdom
// ウィンドウを閉じる・アプリを終える・リロードするときの書き出し（lib/flush-on-exit.ts）。
//
// 対象の不変条件:
// - デスクトップの終了要求は 書き出し → sidecar 停止 → ACK の順。書き終わるまで sidecar を止めない
// - 書き出しが返らなくても、上限で諦めて終了できる。sidecar の停止が返らなくても同じ
// - 開いているすべてのエディタ（メイン・サイドピーク・複数ノート）を回る
// - 既存の保存の列に乗る: 書き込み中の保存が終わってから書く（追い越さない）
// - StrictMode（main.tsx と同じ）で二重に登録・書き出ししない
// - Web: pagehide / visibilitychange(hidden) で書き出しを始める。確認は未保存があるときだけ

import { StrictMode, useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import {
  createCloseRequestHandler,
  flushEditorsBeforeExit,
  installPageExitFlush,
} from "./flush-on-exit";
import {
  flushAllEditorSaves,
  hasUnsavedEditorWork,
  queuePeekSave,
  registerLivePeek,
} from "./peek-save-queue";
import { useAutoSave } from "../hooks/use-auto-save";
import type { GraphiumDocument } from "./document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeDoc(title: string): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [],
    createdAt: "2026-09-27T00:00:00.000Z",
    modifiedAt: "2026-09-27T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 開いているエディタの代わり。未保存があれば flush で保存の列に並べる */
function openEditor(noteId: string, order: string[], hold?: Promise<void>) {
  const state = { unsaved: false, flushes: 0 };
  const unregister = registerLivePeek(noteId, {
    hasUnsaved: () => state.unsaved,
    flush: () => {
      state.unsaved = false;
      state.flushes += 1;
      void queuePeekSave(noteId, makeDoc(noteId), async () => {
        order.push(`write-start:${noteId}`);
        if (hold) await hold;
        order.push(`write-end:${noteId}`);
      }).catch(() => {});
    },
  });
  return { state, unregister };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createCloseRequestHandler: 終了要求 → 書き出し → sidecar 停止 → ACK", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("書き終わってから sidecar を止め、その後で ACK を返す", async () => {
    const order: string[] = [];
    const hold = deferred();
    const editor = openEditor("exit-order", order, hold.promise);
    cleanups.push(editor.unregister);
    editor.state.unsaved = true;

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    const done = handler();
    await vi.advanceTimersByTimeAsync(1000);
    // 書き込み中は sidecar を止めない
    expect(order).toEqual(["write-start:exit-order"]);

    hold.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(order).toEqual(["write-start:exit-order", "write-end:exit-order", "stop-sidecar", "ack"]);
  });

  it("未保存が無ければ待たずに sidecar 停止 → ACK", async () => {
    const order: string[] = [];
    const editor = openEditor("exit-clean", order);
    cleanups.push(editor.unregister);

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    const done = handler();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(order).toEqual(["stop-sidecar", "ack"]);
    expect(editor.state.flushes).toBe(0);
  });

  it("書き出しが返らなくても、上限で諦めて ACK を返す", async () => {
    const order: string[] = [];
    // 返らない保存先の代わり。列はモジュールに残るので、テストの最後に解いて空に戻す
    const stuck = deferred();
    const editor = openEditor("exit-hang", order, stuck.promise);
    editor.state.unsaved = true;

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
      flushTimeoutMs: 5000,
    });
    const done = handler();
    await vi.advanceTimersByTimeAsync(4999);
    expect(order).toEqual(["write-start:exit-hang"]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(order).toEqual(["write-start:exit-hang", "stop-sidecar", "ack"]);
    editor.unregister();
    stuck.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(hasUnsavedEditorWork()).toBe(false);
  });

  it("sidecar の停止が返らない・失敗しても ACK を返す", async () => {
    const order: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hang = createCloseRequestHandler({
      stopSidecar: () => new Promise<void>(() => {}),
      ack: async () => void order.push("ack"),
      sidecarTimeoutMs: 2000,
    });
    const done = hang();
    await vi.advanceTimersByTimeAsync(1999);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(order).toEqual(["ack"]);

    const fail = createCloseRequestHandler({
      stopSidecar: () => {
        throw new Error("kill failed");
      },
      ack: async () => void order.push("ack-2"),
    });
    const done2 = fail();
    await vi.advanceTimersByTimeAsync(0);
    await done2;
    expect(order).toEqual(["ack", "ack-2"]);
  });

  it("待っている間にもう一度閉じる操作が来ても、書き出しも ACK も 1 回", async () => {
    const order: string[] = [];
    const hold = deferred();
    const editor = openEditor("exit-twice", order, hold.promise);
    cleanups.push(editor.unregister);
    editor.state.unsaved = true;

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    const first = handler();
    await vi.advanceTimersByTimeAsync(100);
    const second = handler();
    hold.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
    expect(editor.state.flushes).toBe(1);
    expect(order.filter((o) => o === "ack")).toHaveLength(1);
  });

  it("保存に失敗しても ACK を返す", async () => {
    const order: string[] = [];
    const unregister = registerLivePeek("exit-fail", {
      hasUnsaved: () => unsaved,
      flush: () => {
        unsaved = false;
        void queuePeekSave("exit-fail", makeDoc("x"), async () => {
          // 同期で失敗させない（flushPeekSaves の待ちがマイクロタスクで回り続ける）
          await new Promise((r) => setTimeout(r, 0));
          unsaved = true; // エディタは書けなかった編集を未保存に戻す
          throw new Error("disk full");
        }).catch(() => {});
      },
    });
    let unsaved = true;
    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    const done = handler();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(order).toEqual(["stop-sidecar", "ack"]);
    unregister();
    // 後のテストに書けなかった doc を残さない
    await queuePeekSave("exit-fail", makeDoc("x"), async () => {});
  });
});

describe("flushAllEditorSaves: 開いているすべてのエディタを既存の列に乗せる", () => {
  it("複数のノート（メイン・サイドピーク）をすべて書き出す", async () => {
    const order: string[] = [];
    const main = openEditor("all-main", order);
    const peek = openEditor("wiki:all-peek", order);
    const clean = openEditor("all-clean", order);
    cleanups.push(main.unregister, peek.unregister, clean.unregister);
    main.state.unsaved = true;
    peek.state.unsaved = true;

    expect(hasUnsavedEditorWork()).toBe(true);
    await flushAllEditorSaves();
    expect(order).toContain("write-end:all-main");
    expect(order).toContain("write-end:wiki:all-peek");
    expect(clean.state.flushes).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(hasUnsavedEditorWork()).toBe(false);
    expect(flushAllEditorSaves()).toBeNull();
  });

  it("列に残っている保存（閉じたばかりのピークの書き出し）も待つ", async () => {
    const hold = deferred();
    let written = false;
    void queuePeekSave("all-tail", makeDoc("t"), async () => {
      await hold.promise;
      written = true;
    });
    const saves = flushAllEditorSaves();
    expect(saves).not.toBeNull();
    expect(hasUnsavedEditorWork()).toBe(true);
    hold.resolve();
    await saves;
    expect(written).toBe(true);
  });

  it("列に並ばない書き込み中の保存（メインの自動保存）があれば、その完了も待つ", async () => {
    const hold = deferred();
    let saving: Promise<void> | null = hold.promise.then(() => {
      saving = null;
    });
    cleanups.push(
      registerLivePeek("all-inflight", {
        hasUnsaved: () => false,
        flush: () => {},
        pendingSaves: () => saving,
      }),
    );
    expect(hasUnsavedEditorWork()).toBe(true);
    let done = false;
    const saves = flushAllEditorSaves()!.then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    hold.resolve();
    await saves;
    expect(done).toBe(true);
    expect(hasUnsavedEditorWork()).toBe(false);
  });

  it("同じノートをメインとピークで開いているとき、ピークの書き出しはメインの書き込み中の保存を追い越さない", async () => {
    const order: string[] = [];
    const hold = deferred();
    let saving: Promise<void> | null = hold.promise.then(() => {
      order.push("main-autosave-end");
      saving = null;
    });
    cleanups.push(
      registerLivePeek("all-both", {
        hasUnsaved: () => false,
        flush: () => {},
        pendingSaves: () => saving,
      }),
    );
    const peek = openEditor("all-both", order);
    cleanups.push(peek.unregister);
    peek.state.unsaved = true;

    const saves = flushAllEditorSaves()!;
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]); // メインの保存が終わるまでピークは書き始めない
    hold.resolve();
    await saves;
    expect(order).toEqual(["main-autosave-end", "write-start:all-both", "write-end:all-both"]);
  });

  it("上限つきの待ち: 終われば true、終わらなければ false", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await flushEditorsBeforeExit(50)).toBe(true); // 待つものが無い
    const order: string[] = [];
    const stuck = deferred();
    const editor = openEditor("all-cap", order, stuck.promise);
    editor.state.unsaved = true;
    expect(await flushEditorsBeforeExit(20)).toBe(false);
    editor.unregister();
    stuck.resolve();
    await flushAllEditorSaves();
  });
});

describe("StrictMode のエディタ（useAutoSave + 登録口）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** NoteEditorInner と同じ配線: 未保存を受け取り、先の保存を待ってから列に並べて書く */
  function Editor({
    noteId,
    apiRef,
    order,
    saveHold,
    flushHold,
    store,
  }: {
    noteId: string;
    apiRef: { current: ReturnType<typeof useAutoSave> | null };
    order: string[];
    saveHold?: Promise<void>;
    /** 開いたままの書き出しの書き込みを止める（遅い保存先） */
    flushHold?: Promise<void>;
    /** 本文と、保存先に最後に届いた内容 */
    store?: { text: string; disk: string };
  }) {
    const api = useAutoSave(
      async () => {
        const text = store?.text;
        order.push("autosave-start");
        if (saveHold) await saveHold;
        if (store && text !== undefined) store.disk = text;
        order.push("autosave-end");
        return true;
      },
      () => {},
    );
    apiRef.current = api;
    const apiLive = useRef(api);
    apiLive.current = api;
    useLayoutEffect(
      () =>
        registerLivePeek(noteId, {
          hasUnsaved: () => apiLive.current.hasUnsaved(),
          pendingSaves: () => apiLive.current.pendingSaves(),
          flush: () => {
            const ready = apiLive.current.takeUnsaved();
            if (!ready) return;
            const text = store?.text; // 本文は同期で読む
            void apiLive.current.trackSave(
              queuePeekSave(noteId, makeDoc(noteId), async () => {
                if (!(await ready)) return;
                order.push("exit-write");
                if (flushHold) await flushHold;
                if (store && text !== undefined) store.disk = text;
                if (flushHold) order.push("exit-write-end");
              }),
            );
          },
        }),
      [noteId],
    );
    return null;
  }

  it("直前 3 秒の編集を、終了要求で 1 回だけ書き出してから ACK を返す", async () => {
    const order: string[] = [];
    const apiRef: { current: ReturnType<typeof useAutoSave> | null } = { current: null };
    const { unmount } = render(
      <StrictMode>
        <Editor noteId="strict-exit" apiRef={apiRef} order={order} />
      </StrictMode>,
    );
    await act(async () => {
      apiRef.current!.markDirty();
    });

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    await act(async () => {
      const done = handler();
      await vi.advanceTimersByTimeAsync(0);
      await done;
    });
    expect(order).toEqual(["exit-write", "stop-sidecar", "ack"]);

    // 受け取った分を、残っていたタイマーが二重に書かない
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(order).toEqual(["exit-write", "stop-sidecar", "ack"]);
    unmount();
  });

  it("自動保存の書き込み中に打った分は、その保存が終わってから書く（追い越さない）", async () => {
    const order: string[] = [];
    const hold = deferred();
    const apiRef: { current: ReturnType<typeof useAutoSave> | null } = { current: null };
    const { unmount } = render(
      <StrictMode>
        <Editor noteId="strict-inflight" apiRef={apiRef} order={order} saveHold={hold.promise} />
      </StrictMode>,
    );
    await act(async () => {
      apiRef.current!.markDirty();
      apiRef.current!.saveNow(); // 書き込み中のまま止まる
    });
    await act(async () => {
      apiRef.current!.markDirty(); // 保存中に打った分
    });
    expect(order).toEqual(["autosave-start"]);

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    let done!: Promise<void>;
    await act(async () => {
      done = handler();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(order).toEqual(["autosave-start"]);
    await act(async () => {
      hold.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await done;
    });
    expect(order).toEqual(["autosave-start", "autosave-end", "exit-write", "stop-sidecar", "ack"]);
    unmount();
  });

  it("開いたままの書き出しが書き込み中に打った分の自動保存は、その書き込みが終わってから書く（古い本文が後から届いて残らない）", async () => {
    const order: string[] = [];
    const hold = deferred();
    const store = { text: "A", disk: "" };
    const apiRef: { current: ReturnType<typeof useAutoSave> | null } = { current: null };
    cleanups.push(installPageExitFlush({ confirmWhenUnsaved: false }));
    const { unmount } = render(
      <StrictMode>
        <Editor noteId="strict-hidden" apiRef={apiRef} order={order} flushHold={hold.promise} store={store} />
      </StrictMode>,
    );
    await act(async () => {
      apiRef.current!.markDirty();
    });
    // タブを隠す → 書き出しが A を書き始め、遅い保存先で止まる
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(order).toEqual(["exit-write"]);

    // すぐ戻って打つ → 3 秒後の自動保存
    await act(async () => {
      store.text = "B";
      apiRef.current!.markDirty();
      await vi.advanceTimersByTimeAsync(3000);
    });
    // A の書き込みが終わるまで、B は書き始めない
    expect(order).toEqual(["exit-write"]);

    await act(async () => {
      hold.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(order).toEqual(["exit-write", "exit-write-end", "autosave-start", "autosave-end"]);
    expect(store.disk).toBe("B");
    expect(apiRef.current!.hasUnsaved()).toBe(false);
    unmount();
  });

  it("自動保存が前の書き込みを待つ間にアンマウントされたら、その自動保存は書かず、書き出しに任せる", async () => {
    const order: string[] = [];
    const hold = deferred();
    const flushed: string[] = [];
    let api!: ReturnType<typeof useAutoSave>;
    function Probe() {
      api = useAutoSave(
        () => {
          order.push("autosave");
          return true;
        },
        (ready) => {
          void ready.then((ok) => {
            if (ok) flushed.push("unmount-flush");
          });
        },
      );
      return null;
    }
    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await act(async () => {
      void api.trackSave(hold.promise); // 先に始まった書き込み
      api.markDirty();
      api.saveNow(); // 前の書き込みを待つ
    });
    expect(order).toEqual([]);
    await act(async () => {
      unmount();
    });
    await act(async () => {
      hold.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    // 外されたエディタの本文を読む保存は走らない。未保存はアンマウント時の書き出しが持っていく
    expect(order).toEqual([]);
    expect(flushed).toEqual(["unmount-flush"]);
  });

  it("未保存は無いが書き込み中の保存があれば、終わるのを待ってから ACK を返す", async () => {
    const order: string[] = [];
    const hold = deferred();
    const apiRef: { current: ReturnType<typeof useAutoSave> | null } = { current: null };
    const { unmount } = render(
      <StrictMode>
        <Editor noteId="strict-saving" apiRef={apiRef} order={order} saveHold={hold.promise} />
      </StrictMode>,
    );
    expect(apiRef.current!.pendingSaves()).toBeNull();
    await act(async () => {
      apiRef.current!.markDirty();
      apiRef.current!.saveNow();
    });
    expect(apiRef.current!.pendingSaves()).not.toBeNull();

    const handler = createCloseRequestHandler({
      stopSidecar: async () => void order.push("stop-sidecar"),
      ack: async () => void order.push("ack"),
    });
    let done!: Promise<void>;
    await act(async () => {
      done = handler();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(order).toEqual(["autosave-start"]);
    await act(async () => {
      hold.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await done;
    });
    expect(order).toEqual(["autosave-start", "autosave-end", "stop-sidecar", "ack"]);
    expect(apiRef.current!.pendingSaves()).toBeNull();
    unmount();
  });
});

describe("installPageExitFlush: タブを閉じる・リロードする・隠れる", () => {
  function setVisibility(state: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("pagehide と visibilitychange(hidden) で書き出しを始める。visible では始めない", async () => {
    const order: string[] = [];
    const editor = openEditor("page-hide", order);
    cleanups.push(editor.unregister, installPageExitFlush({ confirmWhenUnsaved: true }));

    editor.state.unsaved = true;
    setVisibility("visible");
    expect(editor.state.flushes).toBe(0);

    setVisibility("hidden");
    expect(editor.state.flushes).toBe(1);

    editor.state.unsaved = true;
    window.dispatchEvent(new Event("pagehide"));
    expect(editor.state.flushes).toBe(2);
    await flushAllEditorSaves();
  });

  it("確認は未保存があるときだけ出し、同時に書き出しも始める", async () => {
    const order: string[] = [];
    const editor = openEditor("page-confirm", order);
    cleanups.push(editor.unregister, installPageExitFlush({ confirmWhenUnsaved: true }));

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    editor.state.unsaved = true;
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    expect(editor.state.flushes).toBe(1);
    await flushAllEditorSaves();
  });

  it("デスクトップ（confirmWhenUnsaved: false）は確認を出さない。外すと何もしない", () => {
    const order: string[] = [];
    const editor = openEditor("page-desktop", order);
    cleanups.push(editor.unregister);
    const uninstall = installPageExitFlush({ confirmWhenUnsaved: false });

    editor.state.unsaved = true;
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(editor.state.flushes).toBe(0);

    uninstall();
    window.dispatchEvent(new Event("pagehide"));
    expect(editor.state.flushes).toBe(0);
    editor.state.unsaved = false;
  });
});
