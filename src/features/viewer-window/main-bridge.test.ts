import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  flushPeekSaves,
  hasPendingPeekEdits,
  localLivePeekIds,
  queuePeekSave,
  registerLivePeek,
  releaseUnsavedPeekDoc,
  unsavedPeekDoc,
} from "../../lib/peek-save-queue";
import type { MainToViewerMessage, ViewerToMainMessage } from "../../lib/viewer-window";
import { installViewerMainBridge, type ViewerMainBridgeDeps } from "./main-bridge";

function docOf(title: string): GraphiumDocument {
  return { title, pages: [{ blocks: [] }], modifiedAt: "2026-11-12T00:00:00.000Z" } as unknown as GraphiumDocument;
}

function setup(flushAckTimeoutMs = 50, extra: Partial<ViewerMainBridgeDeps> = {}) {
  const sent: MainToViewerMessage[] = [];
  let fromViewer: (msg: ViewerToMainMessage) => void = () => {};
  const onSaved = vi.fn();
  const dispose = installViewerMainBridge({
    onSaved,
    send: (msg) => sent.push(msg),
    subscribe: (fn) => {
      fromViewer = fn;
      return () => {};
    },
    flushAckTimeoutMs,
    flushDoneTimeoutMs: 500,
    ...extra,
  });
  const holds = () =>
    sent.filter((m): m is Extract<MainToViewerMessage, { type: "holds" }> => m.type === "holds");
  return { sent, onSaved, dispose, holds, viewer: (msg: ViewerToMainMessage) => fromViewer(msg) };
}

const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const localPeek = () => ({ hasUnsaved: () => false, flush: () => {} });

describe("installViewerMainBridge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("別ウィンドウが起きたら、開いているノートの一覧を知らせる", () => {
    const off = registerLivePeek("n1", localPeek());
    const b = setup();
    b.viewer({ type: "hello" });
    expect(last(b.holds())?.ids).toEqual(["n1"]);
    b.dispose();
    off();
  });

  it("ノートを開いた・閉じたら知らせ直す", async () => {
    const b = setup();
    const off = registerLivePeek("n2", localPeek());
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual(["n2"]);
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual([]);
    b.dispose();
    expect(last(b.sent)?.type).toBe("bye");
  });

  it("閉じるときの書き出しが終わるまでは、開いている扱いのままにする", async () => {
    const b = setup();
    const off = registerLivePeek("n3", localPeek());
    await vi.advanceTimersByTimeAsync(0);
    let finish: () => void = () => {};
    void queuePeekSave("n3", docOf("a"), () => new Promise<void>((res) => (finish = res)));
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual(["n3"]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual([]);
    b.dispose();
  });

  it("別ウィンドウで編集中のノートは代理として登録し、開いているノートには数えない", async () => {
    const b = setup();
    b.viewer({ type: "editing", id: "n4", doc: docOf("a") });
    expect(localLivePeekIds()).not.toContain("n4");
    expect(hasPendingPeekEdits("n4")).toBe(false);
    b.viewer({ type: "dirty", id: "n4", unsaved: true });
    expect(hasPendingPeekEdits("n4")).toBe(true);
    b.viewer({ type: "editing-stopped", id: "n4" });
    expect(hasPendingPeekEdits("n4")).toBe(false);
    b.dispose();
  });

  it("開く前の書き出し待ちが、別ウィンドウの返事を待つ", async () => {
    const b = setup();
    b.viewer({ type: "editing", id: "n5", doc: docOf("old") });
    b.viewer({ type: "dirty", id: "n5", unsaved: true });
    const saves = flushPeekSaves("n5");
    expect(saves).not.toBeNull();
    const flush = b.sent.find((m) => m.type === "flush");
    expect(flush).toMatchObject({ type: "flush", id: "n5" });
    const saved = docOf("new");
    b.viewer({ type: "saved", id: "n5", doc: saved });
    expect(b.onSaved).toHaveBeenCalledWith("n5", saved);
    b.viewer({ type: "flushed", nonce: (flush as { nonce: string }).nonce, id: "n5", saved: true, doc: saved });
    const outcome = await saves!;
    expect(outcome).toEqual({ doc: saved, saved: true });
    // 書き出し終えたので、もう待つものは無い
    expect(flushPeekSaves("n5")).toBeNull();
    b.dispose();
  });

  it("把握している編集中のノートを一緒に知らせる（別ウィンドウが名乗り直すかの判断に使う）", () => {
    const b = setup();
    b.viewer({ type: "hello" });
    expect(last(b.holds())?.remotes).toEqual([]);
    b.viewer({ type: "editing", id: "n10", doc: docOf("a") });
    b.viewer({ type: "hello" });
    expect(last(b.holds())?.remotes).toEqual(["n10"]);
    b.dispose();
  });

  it("受け取ったと返ってきたら、書き終わりを長めに待つ", async () => {
    const b = setup(50);
    b.viewer({ type: "editing", id: "n7", doc: docOf("old") });
    b.viewer({ type: "dirty", id: "n7", unsaved: true });
    const saves = flushPeekSaves("n7");
    const flush = b.sent.find((m) => m.type === "flush") as { nonce: string };
    b.viewer({ type: "flush-ack", nonce: flush.nonce });
    let settled = false;
    void saves!.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    const saved = docOf("new");
    b.viewer({ type: "flushed", nonce: flush.nonce, id: "n7", saved: true, doc: saved });
    expect(await saves!).toEqual({ doc: saved, saved: true });
    b.dispose();
  });

  it("別ウィンドウが書けなかったら失敗として扱い、書けなかった編集を引き取れるようにする", async () => {
    const b = setup();
    b.viewer({ type: "editing", id: "n8", doc: docOf("old") });
    b.viewer({ type: "dirty", id: "n8", unsaved: true });
    const saves = flushPeekSaves("n8");
    const flush = b.sent.find((m) => m.type === "flush") as { nonce: string };
    const unsaved = docOf("typed but not written");
    b.viewer({ type: "flushed", nonce: flush.nonce, id: "n8", saved: false, doc: unsaved });
    expect(await saves!).toEqual({ doc: unsaved, saved: false });
    expect(unsavedPeekDoc("n8")).toBe(unsaved);
    releaseUnsavedPeekDoc("n8", unsaved);
    b.dispose();
  });

  it("閉じた時点で書き込み中だった自動保存が終わるまでは、開いている扱いのままにする", async () => {
    const b = setup();
    let finish: () => void = () => {};
    const saving = new Promise<void>((res) => (finish = res));
    const off = registerLivePeek("n9", { ...localPeek(), pendingSaves: () => saving });
    await vi.advanceTimersByTimeAsync(0);
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual(["n9"]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(last(b.holds())?.ids).toEqual([]);
    b.dispose();
  });

  it("別ウィンドウから返事が無ければ、最後に知っている形で進めて代理を外す", async () => {
    const b = setup(50);
    const last = docOf("last");
    b.viewer({ type: "editing", id: "n6", doc: last });
    b.viewer({ type: "dirty", id: "n6", unsaved: true });
    const saves = flushPeekSaves("n6");
    await vi.advanceTimersByTimeAsync(60);
    expect(await saves!).toEqual({ doc: last, saved: true });
    expect(hasPendingPeekEdits("n6")).toBe(false);
    b.dispose();
  });
});

describe("installViewerMainBridge のグラフとメモの依頼", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const graph = { data: { nodes: [], edges: [] }, lineageTree: null };
  const results = (b: ReturnType<typeof setup>) =>
    b.sent.filter((m): m is Extract<MainToViewerMessage, { type: "memo-result" }> => m.type === "memo-result");
  const graphs = (b: ReturnType<typeof setup>) =>
    b.sent.filter((m): m is Extract<MainToViewerMessage, { type: "graph-data" }> => m.type === "graph-data");

  it("graph-request に getNoteGraph の結果を同じ nonce で返す", async () => {
    const getNoteGraph = vi.fn(async () => graph);
    const b = setup(50, { getNoteGraph });
    b.viewer({ type: "graph-request", nonce: "g1", id: "n1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(getNoteGraph).toHaveBeenCalledWith("n1");
    expect(graphs(b)).toEqual([{ type: "graph-data", nonce: "g1", id: "n1", data: graph.data, lineageTree: null }]);
    b.dispose();
  });

  it("graph-request は、依存が無い・reject・null のとき data=null で返す", async () => {
    const none = setup();
    none.viewer({ type: "graph-request", nonce: "a", id: "n1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(graphs(none)[0]).toMatchObject({ nonce: "a", data: null, lineageTree: null });
    none.dispose();

    const rejected = setup(50, { getNoteGraph: () => Promise.reject(new Error("x")) });
    rejected.viewer({ type: "graph-request", nonce: "b", id: "n1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(graphs(rejected)[0]).toMatchObject({ nonce: "b", data: null });
    rejected.dispose();

    const nulled = setup(50, { getNoteGraph: async () => null });
    nulled.viewer({ type: "graph-request", nonce: "c", id: "n1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(graphs(nulled)[0]).toMatchObject({ nonce: "c", data: null });
    nulled.dispose();
  });

  it("memo-create が createMemo を呼び、成否を ok で返す。失敗・依存なしは ok:false", async () => {
    const createMemo = vi.fn(async (req: { text: string }) => req.text !== "ng");
    const b = setup(50, { createMemo });
    b.viewer({ type: "memo-create", nonce: "m1", noteId: "n1", title: "T", text: "ok", block: { blockId: "b1" } });
    b.viewer({ type: "memo-create", nonce: "m2", noteId: "n1", text: "ng" });
    await vi.advanceTimersByTimeAsync(0);
    expect(createMemo).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "n1", title: "T", text: "ok", block: { blockId: "b1" } }),
    );
    expect(results(b)).toEqual([
      { type: "memo-result", nonce: "m1", ok: true },
      { type: "memo-result", nonce: "m2", ok: false },
    ]);
    b.dispose();

    const thrown = setup(50, { createMemo: () => Promise.reject(new Error("x")) });
    thrown.viewer({ type: "memo-create", nonce: "m3", noteId: "n1", text: "a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(results(thrown)).toEqual([{ type: "memo-result", nonce: "m3", ok: false }]);
    thrown.dispose();

    const none = setup();
    none.viewer({ type: "memo-create", nonce: "m4", noteId: "n1", text: "a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(results(none)).toEqual([{ type: "memo-result", nonce: "m4", ok: false }]);
    none.dispose();
  });

  it("memo-delete が deleteMemo を呼ぶ。例外・依存なしは ok:false", async () => {
    const deleteMemo = vi.fn();
    const b = setup(50, { deleteMemo });
    b.viewer({ type: "memo-delete", nonce: "d1", memoId: "c1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteMemo).toHaveBeenCalledWith("c1");
    expect(results(b)).toEqual([{ type: "memo-result", nonce: "d1", ok: true }]);
    b.dispose();

    const thrown = setup(50, { deleteMemo: () => { throw new Error("x"); } });
    thrown.viewer({ type: "memo-delete", nonce: "d2", memoId: "c1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(results(thrown)).toEqual([{ type: "memo-result", nonce: "d2", ok: false }]);
    thrown.dispose();

    const none = setup();
    none.viewer({ type: "memo-delete", nonce: "d3", memoId: "c1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(results(none)).toEqual([{ type: "memo-result", nonce: "d3", ok: false }]);
    none.dispose();
  });

  it("dispose 後は返事を返さない", async () => {
    let resolve: (v: typeof graph) => void = () => {};
    const b = setup(50, { getNoteGraph: () => new Promise((r) => (resolve = r)) });
    b.viewer({ type: "graph-request", nonce: "g9", id: "n1" });
    b.dispose();
    resolve(graph);
    await vi.advanceTimersByTimeAsync(0);
    expect(graphs(b)).toEqual([]);
  });
});
