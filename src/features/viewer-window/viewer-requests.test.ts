import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MainToViewerMessage, ViewerToMainMessage } from "../../lib/viewer-window";
import { requestMemoCreate, requestNoteGraph } from "./viewer-requests";

function setup(timeoutMs = 100) {
  const sent: ViewerToMainMessage[] = [];
  let listener: (msg: MainToViewerMessage) => void = () => {};
  const off = vi.fn();
  const deps = {
    send: (m: ViewerToMainMessage) => sent.push(m),
    subscribe: (fn: (msg: MainToViewerMessage) => void) => {
      listener = fn;
      return off;
    },
    timeoutMs,
  };
  return { sent, deps, off, reply: (m: MainToViewerMessage) => listener(m) };
}

describe("viewer-requests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("同じ nonce の返事だけを受け取る（別の nonce は無視する）", async () => {
    const r = setup();
    const p = requestNoteGraph("n1", r.deps);
    const sent = r.sent[0] as Extract<ViewerToMainMessage, { type: "graph-request" }>;
    expect(sent).toMatchObject({ type: "graph-request", id: "n1" });
    r.reply({ type: "graph-data", nonce: "other", id: "n1", data: { nodes: [], edges: [] }, lineageTree: null });
    r.reply({ type: "graph-data", nonce: sent.nonce, id: "n1", data: { nodes: [], edges: [{ id: "e" }] } as never, lineageTree: null });
    const got = await p;
    expect(got?.data.edges).toHaveLength(1);
    expect(r.off).toHaveBeenCalled();
  });

  it("返事が来なければ、グラフは null・メモは false で終わる", async () => {
    const r = setup(100);
    const g = requestNoteGraph("n1", r.deps);
    const m = requestMemoCreate({ noteId: "n1", text: "a" }, setup(100).deps);
    await vi.advanceTimersByTimeAsync(101);
    expect(await g).toBeNull();
    expect(await m).toBe(false);
    expect(r.off).toHaveBeenCalled();
  });
});
