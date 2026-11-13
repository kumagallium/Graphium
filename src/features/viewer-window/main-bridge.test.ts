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
import { installViewerMainBridge } from "./main-bridge";

function docOf(title: string): GraphiumDocument {
  return { title, pages: [{ blocks: [] }], modifiedAt: "2026-11-12T00:00:00.000Z" } as unknown as GraphiumDocument;
}

function setup(flushAckTimeoutMs = 50) {
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
