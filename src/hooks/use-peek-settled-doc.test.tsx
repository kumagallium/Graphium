// @vitest-environment jsdom
// メインエディタの関所（usePeekSettledDoc）。StrictMode で描画する（main.tsx と同じ）。
//
// 対象の不変条件:
// - 同じノートのピークに未保存の編集・書き込み中の保存が無ければ、待たずに initialDoc で開く
// - あれば書き終わるまで waiting を返し、書き出しの onSaved で進んだ initialDoc で開く
// - 開いているピークには、自動保存の 3 秒を待たずに書き出させる
// - 書き出しに失敗していれば、その doc で開いて startUnsaved を立てる。initialDoc の方が
//   新しくなったら initialDoc に戻す
// - 待つかどうかはマウント時に一度だけ決める（開いた後の保存でエディタを外さない）

import { StrictMode, type ReactNode } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePeekSettledDoc } from "./use-peek-settled-doc";
import {
  pendingPeekSave,
  queuePeekSave,
  registerLivePeek,
  unsavedPeekDoc,
} from "../lib/peek-save-queue";
import type { GraphiumDocument } from "../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeDoc(text: string, modifiedAt: string): GraphiumDocument {
  return {
    version: 6,
    title: text,
    pages: [],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt,
  } as unknown as GraphiumDocument;
}

/** 外から解決・失敗させられる書き込み */
function deferredWrite() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { write: () => promise, resolve, reject };
}

function Wrap({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

const V1 = makeDoc("v1", "2026-09-25T01:00:00.000Z");
const V2 = makeDoc("v2", "2026-09-25T02:00:00.000Z");
const V3 = makeDoc("v3", "2026-09-25T03:00:00.000Z");

const cleanups: Array<() => void> = [];
afterEach(async () => {
  cleanups.splice(0).forEach((f) => f());
  await waitFor(() =>
    expect(["h1", "h2", "h3", "h4", "h5", "h6"].every((id) => pendingPeekSave(id) === null)).toBe(true),
  );
});

describe("usePeekSettledDoc", () => {
  it("待つものが無ければ、待たずに initialDoc で開く", () => {
    const { result } = renderHook(() => usePeekSettledDoc("h1", V1), { wrapper: Wrap });
    expect(result.current).toEqual({ waiting: false, doc: V1, startUnsaved: false });
  });

  it("新しいノート（docKey なし）は待たない", () => {
    const { result } = renderHook(() => usePeekSettledDoc(null, null), { wrapper: Wrap });
    expect(result.current).toEqual({ waiting: false, doc: null, startUnsaved: false });
  });

  it("書き込み中の保存があれば書き終わるまで待ち、onSaved で進んだ initialDoc で開く", async () => {
    const w = deferredWrite();
    let activeDoc = V1;
    // 書き出しの onSaved（reindexNoteFromDoc）が activeDoc を進める
    void queuePeekSave("h2", V2, async () => {
      await w.write();
      activeDoc = V2;
    });
    const { result, rerender } = renderHook(() => usePeekSettledDoc("h2", activeDoc), {
      wrapper: Wrap,
    });
    expect(result.current.waiting).toBe(true);

    await act(async () => {
      w.resolve();
    });
    rerender();
    await waitFor(() => expect(result.current.waiting).toBe(false));
    expect(result.current).toEqual({ waiting: false, doc: V2, startUnsaved: false });
  });

  it("開いているピークの未保存は、3 秒を待たずにその場で書き出させる", async () => {
    let activeDoc = V1;
    let unsaved = true;
    let flushes = 0;
    cleanups.push(
      registerLivePeek("h3", {
        hasUnsaved: () => unsaved,
        flush: () => {
          flushes += 1;
          unsaved = false;
          void queuePeekSave("h3", V2, async () => {
            activeDoc = V2;
          });
        },
      }),
    );
    const { result, rerender } = renderHook(() => usePeekSettledDoc("h3", activeDoc), {
      wrapper: Wrap,
    });
    expect(result.current.waiting).toBe(true);
    await waitFor(() => expect(flushes).toBe(1));
    rerender();
    await waitFor(() => expect(result.current.waiting).toBe(false));
    expect(result.current).toEqual({ waiting: false, doc: V2, startUnsaved: false });
  });

  it("書き出しに失敗していれば、その doc で開いて startUnsaved を立てる。initialDoc が新しくなれば戻す", async () => {
    const w = deferredWrite();
    const run = queuePeekSave("h4", V2, w.write).catch(() => {});
    let activeDoc = V1;
    const { result, rerender } = renderHook(() => usePeekSettledDoc("h4", activeDoc), {
      wrapper: Wrap,
    });
    expect(result.current.waiting).toBe(true);

    await act(async () => {
      w.reject(new Error("offline"));
      await run;
    });
    await waitFor(() => expect(result.current.waiting).toBe(false));
    // 保存できなかった編集（V2）を持ち込む。activeDoc（V1）はそれより古い
    expect(result.current).toEqual({ waiting: false, doc: V2, startUnsaved: true });
    // 引き取ったので lib からは消える（二度持ち込まない）
    expect(unsavedPeekDoc("h4")).toBeNull();

    // メインの保存で activeDoc が進んだら、そちらを使う
    activeDoc = V3;
    rerender();
    expect(result.current).toEqual({ waiting: false, doc: V3, startUnsaved: true });
  });

  it("待たずに開いたときも、保存できなかった doc が新しければそれで開く", async () => {
    const w = deferredWrite();
    const run = queuePeekSave("h5", V2, w.write).catch(() => {});
    w.reject(new Error("offline"));
    await run;
    await waitFor(() => expect(pendingPeekSave("h5")).toBeNull());

    const { result } = renderHook(() => usePeekSettledDoc("h5", V1), { wrapper: Wrap });
    expect(result.current).toEqual({ waiting: false, doc: V2, startUnsaved: true });
  });

  it("保存できなかった doc より initialDoc が新しければ、initialDoc で開く", async () => {
    const w = deferredWrite();
    const run = queuePeekSave("h6", V2, w.write).catch(() => {});
    w.reject(new Error("offline"));
    await run;
    await waitFor(() => expect(pendingPeekSave("h6")).toBeNull());

    const { result } = renderHook(() => usePeekSettledDoc("h6", V3), { wrapper: Wrap });
    expect(result.current).toEqual({ waiting: false, doc: V3, startUnsaved: false });
  });

  it("待つかどうかはマウント時に一度だけ決める（開いた後の保存でエディタを外さない）", async () => {
    const { result, rerender } = renderHook(() => usePeekSettledDoc("h1", V1), { wrapper: Wrap });
    expect(result.current.waiting).toBe(false);
    const w = deferredWrite();
    const run = queuePeekSave("h1", V2, w.write);
    rerender();
    expect(result.current.waiting).toBe(false);
    w.resolve();
    await run;
  });
});
