// @vitest-environment jsdom
// usePendingMemoQuoteInsert（メモ一覧の「挿入」の依頼を本文に入れるフック）のテスト。
//
// 対象の不変条件:
// - 初期データの復元（restoreSnapshot = Map の置き換え）と同じ commit に並んでも、挿入した紐づけが
//   復元に上書きされて消えない（復元の effect を先に宣言し、フックを後ろに置く）。既存の紐づけも残る
// - 復元が済む前（restored() が false）は何も入れない。済んで store が変わったら入れる
// - 同じ依頼は 1 度しか入れない（再描画しても二重にならない）
// - エディタがまだ無い間は入れず、届いたら入れる

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { MemoQuoteProvider, useMemoQuoteStore } from "./store";
import { usePendingMemoQuoteInsert, type PendingMemoInsert } from "./use-pending-memo-quote-insert";
import type { MemoQuoteRef } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wrapper = ({ children }: { children: ReactNode }) => <MemoQuoteProvider>{children}</MemoQuoteProvider>;
const ref = (id: string): MemoQuoteRef => ({ captureId: id, quotedAt: "2026-10-30T00:00:00.000Z", quotedText: "既存" });
const makeEditor = () =>
  BlockNoteEditor.create({ initialContent: [{ id: "a", type: "paragraph", content: "A" }] } as any) as any;
const pending = (): PendingMemoInsert => ({ captureId: "cap_new", text: "挿入するメモ" });

/** note-app と同じ並び: 復元の effect を先に宣言し、その後ろにフックを置く */
function useNoteLike(opts: {
  pending: PendingMemoInsert | null;
  editor: any;
  snapshot: Record<string, MemoQuoteRef> | undefined;
  onInserted?: () => void;
  restoredOverride?: () => boolean;
}) {
  const store = useMemoQuoteStore();
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    store.restoreSnapshot(opts.snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  usePendingMemoQuoteInsert({
    pending: opts.pending,
    editor: opts.editor,
    restored: opts.restoredOverride ?? (() => initializedRef.current),
    store,
    onInserted: opts.onInserted,
  });
  return store;
}

describe("usePendingMemoQuoteInsert", () => {
  it("復元と同じ commit で挿入しても、紐づけは復元に上書きされず、既存の紐づけも残る", () => {
    const editor = makeEditor();
    const req = pending();
    const onInserted = vi.fn();
    const { result } = renderHook(
      () => useNoteLike({ pending: req, editor, snapshot: { existing: ref("c0") }, onInserted }),
      { wrapper },
    );
    const snapshot = result.current.getSnapshot();
    const inserted = editor.document[editor.document.length - 1];
    expect(inserted.type).toBe("quote");
    expect(snapshot[inserted.id]?.captureId).toBe("cap_new");
    expect(snapshot.existing?.captureId).toBe("c0");
    expect(onInserted).toHaveBeenCalledTimes(1);
  });

  it("既存の紐づけが無いノートでも紐づけが残る", () => {
    const editor = makeEditor();
    const req = pending();
    const { result } = renderHook(() => useNoteLike({ pending: req, editor, snapshot: undefined }), { wrapper });
    const inserted = editor.document[editor.document.length - 1];
    expect(Object.keys(result.current.getSnapshot())).toEqual([inserted.id]);
  });

  it("同じ依頼は 1 度だけ。再描画しても二重に入らない", () => {
    const editor = makeEditor();
    const req = pending();
    const { rerender } = renderHook(() => useNoteLike({ pending: req, editor, snapshot: undefined }), { wrapper });
    rerender();
    rerender();
    expect(editor.document).toHaveLength(2);
  });

  it("復元が済む前は入れず、済んで store が変わったら入れる", () => {
    const editor = makeEditor();
    const req = pending();
    let restored = false;
    const { result, rerender } = renderHook(
      () => useNoteLike({ pending: req, editor, snapshot: undefined, restoredOverride: () => restored }),
      { wrapper },
    );
    expect(editor.document).toHaveLength(1);
    restored = true;
    // 復元が終わると store が変わる（復元は Map の置き換え）→ effect が再実行される
    act(() => result.current.restoreSnapshot({ existing: ref("c0") }));
    rerender();
    expect(editor.document).toHaveLength(2);
    expect(Object.keys(result.current.getSnapshot())).toHaveLength(2);
  });

  it("エディタが届くまで待ち、届いたら入れる", () => {
    const editor = makeEditor();
    const req = pending();
    let current: any = null;
    const { rerender } = renderHook(() => useNoteLike({ pending: req, editor: current, snapshot: undefined }), {
      wrapper,
    });
    expect(editor.document).toHaveLength(1);
    current = editor;
    rerender();
    expect(editor.document).toHaveLength(2);
  });
});
