// 送信キュー（store-and-forward）のテスト。IndexedDB は fake-indexeddb。
//
// 環境は node（既定）を使う: fake-indexeddb は環境の structuredClone で値を
// 複製するが、jsdom の Blob は Node の structuredClone が中身を運べない
// （プレーンオブジェクト化して内容が消える）。node 環境なら Node ネイティブの
// Blob/File が使われ、Blob の中身まで往復できる（実測済み）。DOM は不要。
//
// 対象の不変条件（最重要 = キューのアイテムを失わない）:
// - enqueue は名前を graphium-<日時>-<連番>.<ext> に正規化し、Blob ごと永続化する
// - drain は enqueuedAt（同時なら連番名）順の直列。1 件の失敗は attempts++ して
//   次のアイテムへ続行。リトライ上限で "failed" に落として drain 対象から外す
// - PushAuthError（トークン失効）は drain 全体を中断し、残りは pending のまま
//   attempts も消費しない — 再接続後にそのまま再送できる
// - 失敗にはバックオフが付き、次回 drain では期限まで deferred 扱いになる
// - 状態購読で draining/activeId/items が流れる

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  clearPushQueue,
  drainPushQueue,
  enqueuePushFiles,
  getPushQueueSnapshot,
  removePushQueueItem,
  retryFailedPushItems,
  subscribePushQueue,
} from "./queue";
import { formatCaptureTimestamp } from "./naming";
import { PushAuthError, type InboxPusher, type PushOptions, type PushResult } from "./types";

/** 常時接続のスタブプッシャー。push の実装だけ差し替える。 */
function stubPusher(
  push: (file: File, opts?: PushOptions) => Promise<PushResult>,
  overrides?: Partial<InboxPusher>,
): InboxPusher & { pushMock: ReturnType<typeof vi.fn> } {
  const pushMock = vi.fn(push);
  return {
    kind: "google-drive",
    isConfigured: () => true,
    prepare: async () => {},
    isConnected: () => true,
    connect: async () => {},
    disconnect: () => {},
    push: pushMock as InboxPusher["push"],
    ...overrides,
    pushMock,
  };
}

const okPush = async (file: File): Promise<PushResult> => ({
  fileId: `drive-${file.name}`,
  name: file.name,
});

beforeEach(() => {
  // テストごとに素の IndexedDB（fake-indexeddb は Blob を含めて structured clone できる）
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("enqueuePushFiles", () => {
  it("normalizes names (timestamp + sequence, MIME-first extension) and persists blobs", async () => {
    const files = [
      new File(["hello"], "image.jpg", { type: "image/jpeg" }),
      // iOS が汎用名 + 正しい MIME を返すケース: 拡張子は MIME を信じて mov
      new File(["world!"], "capture.bin", { type: "video/quicktime" }),
    ];
    const metas = await enqueuePushFiles(files);
    const stamp = formatCaptureTimestamp(new Date());

    expect(metas).toHaveLength(2);
    expect(metas[0].name).toMatch(/^graphium-\d{8}-\d{6}-01\.jpg$/);
    expect(metas[1].name).toMatch(/^graphium-\d{8}-\d{6}-02\.mov$/);
    expect(metas[0].name).toBe(`graphium-${stamp}-01.jpg`);
    expect(metas[0].status).toBe("pending");
    expect(metas[0].attempts).toBe(0);
    expect(metas[0].bytes).toBe(5);

    // 永続化されている（enqueue が resolve した時点で PWA が殺されても残る）
    const snapshot = await getPushQueueSnapshot();
    expect(snapshot.items.map((i) => i.name)).toEqual([metas[0].name, metas[1].name]);
  });

  it("delivers the persisted blob content back to the pusher on drain", async () => {
    await enqueuePushFiles([new File(["hello"], "image.jpg", { type: "image/jpeg" })]);
    let received: { name: string; type: string; text: string } | null = null;
    const pusher = stubPusher(async (file) => {
      received = { name: file.name, type: file.type, text: await file.text() };
      return okPush(file);
    });

    await drainPushQueue(pusher);

    expect(received).not.toBeNull();
    expect(received!.text).toBe("hello");
    expect(received!.type).toBe("image/jpeg");
    expect(received!.name).toMatch(/^graphium-.*-01\.jpg$/);
  });

  it("returns [] for an empty list without touching the DB", async () => {
    expect(await enqueuePushFiles([])).toEqual([]);
  });
});

describe("drainPushQueue", () => {
  it("pushes serially in capture order and removes items on success", async () => {
    await enqueuePushFiles([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
      new File(["c"], "c.jpg", { type: "image/jpeg" }),
    ]);
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const pusher = stubPusher(async (file) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push(file.name);
      active -= 1;
      return okPush(file);
    });

    const result = await drainPushQueue(pusher);

    expect(result.aborted).toBeNull();
    expect(result.pushed).toHaveLength(3);
    expect(maxActive).toBe(1); // 直列（並行しない）
    expect(order.map((n) => n.slice(-6))).toEqual(["01.jpg", "02.jpg", "03.jpg"]);
    expect((await getPushQueueSnapshot()).items).toHaveLength(0);
  });

  it("continues with the remaining items when one fails, and records the attempt", async () => {
    await enqueuePushFiles([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);
    const pusher = stubPusher(async (file) => {
      if (file.name.endsWith("-01.jpg")) throw new Error("network hiccup");
      return okPush(file);
    });

    const result = await drainPushQueue(pusher);

    expect(result.failed).toHaveLength(1);
    expect(result.pushed).toHaveLength(1); // 失敗しても他は送られる
    const snapshot = await getPushQueueSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].status).toBe("pending");
    expect(snapshot.items[0].attempts).toBe(1);
    expect(snapshot.items[0].lastError).toBe("network hiccup");
    expect(snapshot.items[0].nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("defers a failed item until its backoff expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    await enqueuePushFiles([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    const failing = stubPusher(async () => {
      throw new Error("boom");
    });

    await drainPushQueue(failing); // attempts=1, バックオフ 5 秒
    const retry = stubPusher(okPush);

    // バックオフ中: push は呼ばれず deferred 扱い
    const during = await drainPushQueue(retry);
    expect(during.deferred).toHaveLength(1);
    expect(retry.pushMock).not.toHaveBeenCalled();

    // バックオフ明け: 再送される
    vi.setSystemTime(new Date("2026-07-26T12:00:06Z"));
    const after = await drainPushQueue(retry);
    expect(after.pushed).toHaveLength(1);
    expect(retry.pushMock).toHaveBeenCalledTimes(1);
  });

  it("marks an item failed at the retry cap and excludes it from later drains", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let now = new Date("2026-07-26T12:00:00Z").getTime();
    vi.setSystemTime(now);
    await enqueuePushFiles([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    const failing = stubPusher(async () => {
      throw new Error("always fails");
    });

    // 上限 5 回まで失敗させる（バックオフを跨ぐため毎回時計を進める）
    for (let i = 0; i < 5; i += 1) {
      await drainPushQueue(failing);
      now += 10 * 60 * 1000;
      vi.setSystemTime(now);
    }
    expect(failing.pushMock).toHaveBeenCalledTimes(5);

    const snapshot = await getPushQueueSnapshot();
    expect(snapshot.items[0].status).toBe("failed");
    expect(snapshot.items[0].attempts).toBe(5);

    // failed は drain 対象外（push は呼ばれず、deferred でもない）
    const later = await drainPushQueue(failing);
    expect(failing.pushMock).toHaveBeenCalledTimes(5);
    expect(later.deferred).toHaveLength(0);
    expect(later.failed).toHaveLength(0);

    // 明示 retry で pending に戻り、送れる
    await retryFailedPushItems();
    const revived = await getPushQueueSnapshot();
    expect(revived.items[0].status).toBe("pending");
    expect(revived.items[0].attempts).toBe(0);
    const ok = stubPusher(okPush);
    const final = await drainPushQueue(ok);
    expect(final.pushed).toHaveLength(1);
  });

  it("aborts on token expiry mid-drain, preserving the rest of the queue untouched", async () => {
    await enqueuePushFiles([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
      new File(["c"], "c.jpg", { type: "image/jpeg" }),
    ]);
    const pusher = stubPusher(async (file) => {
      if (file.name.endsWith("-01.jpg")) return okPush(file);
      throw new PushAuthError("token expired");
    });

    const result = await drainPushQueue(pusher);

    expect(result.aborted).toBe("auth");
    expect(result.pushed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(pusher.pushMock).toHaveBeenCalledTimes(2); // 3 件目には進まない
    // 残り 2 件は pending のまま、attempts も消費しない（認証切れはアイテムの責任ではない）
    const snapshot = await getPushQueueSnapshot();
    expect(snapshot.items).toHaveLength(2);
    for (const item of snapshot.items) {
      expect(item.status).toBe("pending");
      expect(item.attempts).toBe(0);
      expect(item.lastError).toBeUndefined();
    }
  });

  it("aborts before pushing anything when the pusher is not connected", async () => {
    await enqueuePushFiles([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    const pusher = stubPusher(okPush, { isConnected: () => false });

    const result = await drainPushQueue(pusher);

    expect(result.aborted).toBe("auth");
    expect(pusher.pushMock).not.toHaveBeenCalled();
    expect((await getPushQueueSnapshot()).items).toHaveLength(1);
  });

  it("returns busy for a concurrent drain instead of double-sending", async () => {
    await enqueuePushFiles([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = stubPusher(async (file) => {
      await gate;
      return okPush(file);
    });

    const first = drainPushQueue(slow);
    const second = await drainPushQueue(slow); // 進行中に呼ぶ
    expect(second.aborted).toBe("busy");
    expect(second.pushed).toHaveLength(0);

    release();
    const firstResult = await first;
    expect(firstResult.pushed).toHaveLength(1);
    expect(slow.pushMock).toHaveBeenCalledTimes(1); // 二重送信しない
  });
});

describe("状態購読と操作", () => {
  it("streams snapshots through enqueue and drain (draining/activeId visible)", async () => {
    const snapshots: Array<{ draining: boolean; activeId: string | null; count: number }> = [];
    const unsubscribe = subscribePushQueue((snapshot) => {
      snapshots.push({
        draining: snapshot.draining,
        activeId: snapshot.activeId,
        count: snapshot.items.length,
      });
    });
    try {
      const [meta] = await enqueuePushFiles([
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
      ]);
      await drainPushQueue(stubPusher(okPush));

      expect(snapshots.some((s) => s.count === 1)).toBe(true); // enqueue 後
      expect(snapshots.some((s) => s.draining && s.activeId === meta.id)).toBe(true); // 送信中
      const last = snapshots[snapshots.length - 1];
      expect(last.draining).toBe(false);
      expect(last.count).toBe(0); // 送信済みで空
    } finally {
      unsubscribe();
    }
  });

  it("supports removing a single item and clearing the queue", async () => {
    const metas = await enqueuePushFiles([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);
    await removePushQueueItem(metas[0].id);
    let snapshot = await getPushQueueSnapshot();
    expect(snapshot.items.map((i) => i.id)).toEqual([metas[1].id]);

    await clearPushQueue();
    snapshot = await getPushQueueSnapshot();
    expect(snapshot.items).toHaveLength(0);
  });
});
