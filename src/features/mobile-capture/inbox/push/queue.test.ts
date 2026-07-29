// 捕獲履歴（store-and-forward）のテスト。IndexedDB は fake-indexeddb。
//
// 環境は node（既定）を使う: fake-indexeddb は環境の structuredClone で値を
// 複製するが、jsdom の Blob は Node の structuredClone が中身を運べない
// （プレーンオブジェクト化して内容が消える）。node 環境なら Node ネイティブの
// Blob/File が使われ、Blob の中身まで往復できる（実測済み）。DOM は不要。
//
// 対象の不変条件（最重要 = 捕獲物を失わない）:
// - enqueue は名前を graphium-<日時>-<連番>.<ext> に正規化し、Blob ごと永続化する
// - drain は enqueuedAt（同時なら連番名）順の直列。1 件の失敗は attempts++ して
//   次のアイテムへ続行。リトライ上限で "failed" に落として drain 対象から外す
// - **送信成功でレコードは消えない**（status="sent" + sentAt の履歴として残り、
//   blob だけ捨てる）。サムネ・プレビューは残るので行の見た目は保たれる
// - 保持ポリシー: sent は直近 100 件 / 30 日。pending・failed は刈らない
// - PushAuthError（トークン失効）は drain 全体を中断し、残りは pending のまま
//   attempts も消費しない — 再接続後にそのまま再送できる
// - 失敗にはバックオフが付き、次回 drain では期限まで deferred 扱いになる
// - 状態購読で draining/activeId/items が流れる
// - v1（未送信キュー）の DB を v2（捕獲履歴）で開いても既存レコードが生き残る

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  HISTORY_MAX_SENT,
  clearPushQueue,
  drainPushQueue,
  enqueuePushFiles,
  getPushQueueFiles,
  getPushQueueSnapshot,
  getPushQueueThumbnail,
  prunePushQueueHistory,
  removePushQueueItem,
  retryFailedPushItems,
  subscribePushQueue,
} from "./queue";
import { formatCaptureTimestamp } from "./naming";
import { buildMemoCaptureFile, buildUrlCaptureFile } from "../capture-file";
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
  it("pushes serially in capture order and keeps the items as sent history", async () => {
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
    // 送っても消えない — 撮った 3 件が履歴として時系列に残る
    const items = (await getPushQueueSnapshot()).items;
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.status === "sent")).toBe(true);
  });

  it("keeps the record but drops the blob when a push succeeds", async () => {
    const [meta] = await enqueuePushFiles([
      new File(["hello"], "a.jpg", { type: "image/jpeg" }),
    ]);

    await drainPushQueue(stubPusher(okPush));

    const [item] = (await getPushQueueSnapshot()).items;
    expect(item.id).toBe(meta.id);
    expect(item.status).toBe("sent");
    expect(item.sentAt).toBeTruthy();
    expect(item.name).toBe(meta.name);
    expect(item.bytes).toBe(5); // 表示用のメタは残る
    // 実体は捨てている（容量対策）— 復元 API からも消える
    expect(await getPushQueueFiles([meta.id])).toHaveLength(0);
    // 送信済みは二度と送らない
    const again = await drainPushQueue(stubPusher(okPush));
    expect(again.pushed).toHaveLength(0);
  });

  it("keeps the memo / URL preview after the blob is discarded", async () => {
    await enqueuePushFiles([
      buildMemoCaptureFile("queued thought\nsecond line"),
      buildUrlCaptureFile({ url: "https://example.com/read", title: "Example Read" }),
    ]);
    await drainPushQueue(stubPusher(okPush));

    const items = (await getPushQueueSnapshot()).items;
    expect(items.map((i) => i.status)).toEqual(["sent", "sent"]);
    // blob を捨てた後も行に出す文字が残る（ファイル名に落ちない）
    expect(items[0].preview).toBe("queued thought");
    expect(items[1].preview).toBe("Example Read");
    expect(items[1].previewUrl).toBe("https://example.com/read");
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
    const unsent = snapshot.items.filter((item) => item.status !== "sent");
    expect(unsent).toHaveLength(1);
    expect(unsent[0].status).toBe("pending");
    expect(unsent[0].attempts).toBe(1);
    expect(unsent[0].lastError).toBe("network hiccup");
    expect(unsent[0].nextAttemptAt).toBeGreaterThan(Date.now());
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
    const unsent = snapshot.items.filter((item) => item.status !== "sent");
    expect(snapshot.items).toHaveLength(3); // 送れた 1 件は履歴として残る
    expect(unsent).toHaveLength(2);
    for (const item of unsent) {
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
      expect(last.count).toBe(1); // 送信後も履歴として残る（画面から消えない）
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

describe("getPushQueueFiles", () => {
  it("restores queued blobs as Files under their normalized names (Web Share fallback)", async () => {
    const metas = await enqueuePushFiles([
      new File(["hello"], "image.jpg", { type: "image/jpeg" }),
      new File(["clip!"], "video.bin", { type: "video/quicktime" }),
    ]);

    const restored = await getPushQueueFiles();

    expect(restored.map((r) => r.id)).toEqual(metas.map((m) => m.id));
    // 一覧（snapshot）に見せた名前・MIME のまま共有シートへ渡せる
    expect(restored[0].file.name).toBe(metas[0].name);
    expect(restored[0].file.type).toBe("image/jpeg");
    expect(await restored[0].file.text()).toBe("hello");
    expect(restored[1].file.name).toBe(metas[1].name);
    expect(await restored[1].file.text()).toBe("clip!");
  });

  it("restores only the requested ids, keeping enqueue order", async () => {
    const metas = await enqueuePushFiles([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
      new File(["c"], "c.jpg", { type: "image/jpeg" }),
    ]);

    // 逆順で要求しても enqueue 順で返る（共有シートには撮った順で渡す）
    const restored = await getPushQueueFiles([metas[2].id, metas[0].id]);

    expect(restored.map((r) => r.id)).toEqual([metas[0].id, metas[2].id]);
  });
});

// ── サムネイル（送信後も履歴の行に絵を残す） ──
// node 環境には canvas が無いので、createImageBitmap / OffscreenCanvas を最小の
// フェイクで代用する（実装が「縮小して JPEG に焼く」経路を通ることだけ見る）。

describe("履歴サムネイル", () => {
  function stubCanvas(): { sizes: Array<[number, number]> } {
    const sizes: Array<[number, number]> = [];
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 1200,
      height: 800,
      close: () => {},
    }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          sizes.push([width, height]);
        }
        getContext() {
          return { drawImage: () => {} };
        }
        async convertToBlob(opts: { type: string }) {
          return new Blob(["jpeg-bytes"], { type: opts.type });
        }
      },
    );
    return { sizes };
  }

  it("stores a downscaled JPEG at enqueue and serves it after the blob is gone", async () => {
    const { sizes } = stubCanvas();
    const [meta] = await enqueuePushFiles([
      new File(["original-bytes"], "photo.jpg", { type: "image/jpeg" }),
    ]);
    // 長辺 200px に縮小して焼く（1200x800 → 200x133）
    expect(sizes).toEqual([[200, 133]]);

    await drainPushQueue(stubPusher(okPush));

    // 実体は捨てたのにサムネは残る = 送信済みの行にも絵が出る
    expect(await getPushQueueFiles([meta.id])).toHaveLength(0);
    const thumb = await getPushQueueThumbnail(meta.id);
    expect(thumb?.type).toBe("image/jpeg");
    expect(await thumb!.text()).toBe("jpeg-bytes");
  });

  it("falls back to the pending blob for images without a thumbnail, and null otherwise", async () => {
    // canvas が無い環境（node のまま）ではサムネは焼かれない
    const [image, audio] = await enqueuePushFiles([
      new File(["raw"], "photo.jpg", { type: "image/jpeg" }),
      new File(["snd"], "voice.m4a", { type: "audio/mp4" }),
    ]);

    expect(await (await getPushQueueThumbnail(image.id))!.text()).toBe("raw");
    expect(await getPushQueueThumbnail(audio.id)).toBeNull();

    // 送信後は実体が無いのでアイコン表示に倒れる（null）
    await drainPushQueue(stubPusher(okPush));
    expect(await getPushQueueThumbnail(image.id)).toBeNull();
    expect(await getPushQueueThumbnail("missing-id")).toBeNull();
  });
});

// ── 保持ポリシー（直近 100 件 / 30 日。未処理は消さない） ──

describe("prunePushQueueHistory", () => {
  it("keeps only the newest 100 sent items, dropping the oldest first", async () => {
    const files = Array.from(
      { length: HISTORY_MAX_SENT + 5 },
      (_, i) => new File([`x${i}`], `p${i}.jpg`, { type: "image/jpeg" }),
    );
    const metas = await enqueuePushFiles(files);
    await drainPushQueue(stubPusher(okPush)); // drain 後に自動で刈られる

    const items = (await getPushQueueSnapshot()).items;
    expect(items).toHaveLength(HISTORY_MAX_SENT);
    // 消えたのは古い順（連番名の先頭 5 件）
    const surviving = new Set(items.map((i) => i.id));
    expect(metas.slice(0, 5).some((m) => surviving.has(m.id))).toBe(false);
    expect(surviving.has(metas[metas.length - 1].id)).toBe(true);
  });

  it("drops sent items older than 30 days but never touches pending or failed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));
    const [old] = await enqueuePushFiles([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    await drainPushQueue(stubPusher(okPush));

    // 31 日後: 新しい捕獲物を送る + リトライ上限で failed に落ちるものを作る
    let now = new Date("2026-07-02T09:00:00Z").getTime();
    vi.setSystemTime(now);
    const [fresh] = await enqueuePushFiles([new File(["b"], "b.jpg", { type: "image/jpeg" })]);
    await drainPushQueue(stubPusher(okPush));
    now += 60 * 1000; // 名前（秒単位のタイムスタンプ）を分けるため 1 分進める
    vi.setSystemTime(now);
    const [broken] = await enqueuePushFiles([new File(["c"], "c.jpg", { type: "image/jpeg" })]);
    const failing = stubPusher(async () => {
      throw new Error("nope");
    });
    for (let i = 0; i < 5; i += 1) {
      await drainPushQueue(failing);
      now += 10 * 60 * 1000;
      vi.setSystemTime(now);
    }
    // まだ送っていない捕獲物（pending）
    const [waiting] = await enqueuePushFiles([new File(["d"], "d.jpg", { type: "image/jpeg" })]);

    // drain 後の自動 prune で 30 日超の送信済みだけが落ちている
    const byId = new Map(
      (await getPushQueueSnapshot()).items.map((item) => [item.id, item]),
    );
    expect(byId.has(old.id)).toBe(false);
    expect(byId.get(fresh.id)?.status).toBe("sent");
    expect(byId.get(broken.id)?.status).toBe("failed");
    expect(byId.get(waiting.id)?.status).toBe("pending");

    // さらに時間が経てば残りの送信済みも落ちるが、pending / failed は何日経っても残る
    const removed = await prunePushQueueHistory({ now: Date.parse("2027-01-01T00:00:00Z") });

    expect(removed).toBe(1);
    const survivors = (await getPushQueueSnapshot()).items;
    expect(survivors.map((item) => item.status).sort()).toEqual(["failed", "pending"]);
  });
});

// ── v1 → v2 マイグレーション（既存端末の残キューを壊さない） ──

describe("IndexedDB マイグレーション", () => {
  /** 旧バージョン（v1 = 未送信キュー）の DB を直接作って 1 件書き込む。 */
  function seedLegacyDb(record: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("graphium-push-queue", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("items", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("items", "readwrite");
        tx.objectStore("items").put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  }

  it("preserves v1 pending / failed records when the store opens at v2", async () => {
    await seedLegacyDb({
      id: "legacy-1",
      name: "graphium-20260701-101010-01.jpg",
      mime: "image/jpeg",
      bytes: 3,
      blob: new Blob(["old"], { type: "image/jpeg" }),
      enqueuedAt: "2026-07-01T10:10:10.000Z",
      status: "pending",
      attempts: 0,
    });

    // v2 で開く（onupgradeneeded 経由）
    const snapshot = await getPushQueueSnapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].id).toBe("legacy-1");
    expect(snapshot.items[0].status).toBe("pending"); // 未送信のまま温存
    expect(snapshot.items[0].sentAt).toBeUndefined();
    // 実体も生きていて、そのまま送れる
    const restored = await getPushQueueFiles(["legacy-1"]);
    expect(await restored[0].file.text()).toBe("old");
    const result = await drainPushQueue(stubPusher(okPush));
    expect(result.pushed).toHaveLength(1);
    expect((await getPushQueueSnapshot()).items[0].status).toBe("sent");
  });

  it("normalizes an unknown legacy status instead of hiding the record", async () => {
    await seedLegacyDb({
      id: "legacy-2",
      name: "graphium-20260701-101010-02.jpg",
      mime: "image/jpeg",
      bytes: 3,
      blob: new Blob(["old"], { type: "image/jpeg" }),
      enqueuedAt: "2026-07-01T10:10:10.000Z",
      status: "uploading", // 旧実装が残しうる想定外の値
      attempts: 1,
    });

    const snapshot = await getPushQueueSnapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].status).toBe("pending"); // 送り直せる状態に正す
  });
});
