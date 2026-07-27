// モバイル送信キューの UI 配線フック（MobileCaptureView 用）。
//
// push/（gsi 動的ロード・IndexedDB キュー）は **動的 import** で引く — push/index.ts の
// 注記どおり、起動時バンドルに gsi を入れないための境界。このフック自体は起動時
// バンドルに入るので、push/ から値 import してはいけない（type import のみ可）。
//
// 自動 drain のトリガは離散イベントに限る:
//   マウント直後 / enqueue 直後 / visibilitychange（復帰）/ online 復帰 /
//   connect 成功直後 / 明示の「送信」/ 再試行直後
// **snapshot 購読からは drain を起動しない**（drain → emit → 購読 → drain の
// ループになるため）。多重呼び出しは queue 側の draining ガードが busy で吸収する。
// バックオフ待ち（deferred）のアイテムはタイマーでは追わず、次の自然なトリガに任せる。

import { useCallback, useEffect, useRef, useState } from "react";
import { PUSH_STATUS_EVENT } from "./push-events";
import { canShareFilesToInbox, shareFilesToInbox, type ShareToInboxOutcome } from "./share-to-inbox";
import type {
  InboxPusher,
  PushProgress,
  PushQueueItemMeta,
  PushQueueSnapshot,
} from "./push";

type PushModule = typeof import("./push");

export type PushQueueUi = {
  /**
   * push モジュールのロードが済んだか。false の間は configured/connected は暫定値。
   * enabled=false（実験フラグ OFF）の間は false のまま。
   */
  ready: boolean;
  /** client_id が解決できるか（同梱 or 自前上書き）。 */
  configured: boolean;
  /** 有効期限内のトークンがあるか。 */
  connected: boolean;
  /** connect() のポップアップ進行中か。 */
  connecting: boolean;
  /** 直近の接続エラー（表示用）。 */
  connectError: string | null;
  /** Web Share フォールバックが使える環境か。 */
  canWebShare: boolean;
  /** キューのアイテム（enqueue 順）。 */
  items: PushQueueItemMeta[];
  draining: boolean;
  activeId: string | null;
  /** アイテム別のアップロード進捗。 */
  progress: Record<string, PushProgress>;
  /**
   * 撮影ファイルをキューへ積む。キュー経路が使えない環境
   * （Google 未設定かつ Web Share 不可、または IndexedDB 不可）では false を返し、
   * 呼び出し側が従来のローカル保存へフォールバックする。
   */
  enqueueForSend: (files: File[]) => Promise<boolean>;
  /** 明示の「送信」。接続が生きていればキューを直列送信する。 */
  drainNow: () => void;
  /**
   * Google Drive へ接続 → 成功したら即 drain。
   * **click ハンドラから同期的に呼ぶこと**（内部で await を挟まず connect() に到達する）。
   */
  connectAndDrain: () => void;
  /** アイテムを 1 件取り下げる。 */
  removeItem: (id: string) => void;
  /** failed を pending に戻し、接続が生きていれば再送する。 */
  retryFailed: () => void;
  /**
   * キューの中身を OS 共有シートで送る（Google 未設定環境のフォールバック）。
   * **click ハンドラから同期的に呼ぶこと**。事前復元済みの File を最初の await より
   * 前に navigator.share へ渡す。成功したら該当アイテムをキューから消す。
   * 復元がまだ（直後に撮った等）なら null を返す。
   */
  shareViaWebShare: () => Promise<ShareToInboxOutcome | null>;
  /**
   * キューアイテム 1 件を File として復元する（ホームのキュー一覧の画像サムネイル用）。
   * 見つからない・フラグ OFF・IndexedDB 不可は null（呼び出し側はアイコン表示に倒す）。
   */
  getItemFile: (id: string) => Promise<File | null>;
  /** configured/connected を localStorage から読み直す（設定画面から戻った時など）。 */
  refreshStatus: () => void;
};

/**
 * @param enabled モバイル連携 実験フラグ（既定 true）。false の間はこのフックを
 *   完全に不活性にする — push モジュールのロード・キュー購読・自動 drain を行わず、
 *   enqueueForSend は false を返して呼び出し側を従来のローカル保存へ落とす。
 *   フラグが ON に切り替わると（useMobileInboxFlag 経由の再レンダリングで）
 *   その場でロードから立ち上がる。
 */
export function usePushQueue(enabled = true): PushQueueUi {
  const moduleRef = useRef<Promise<PushModule> | null>(null);
  const pusherRef = useRef<InboxPusher | null>(null);
  const snapshotRef = useRef<PushQueueSnapshot | null>(null);
  /** Web Share フォールバック用に事前復元した File（未設定モードのみ維持）。 */
  const webShareFilesRef = useRef<Array<{ id: string; file: File }>>([]);

  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PushQueueSnapshot | null>(null);
  const [progress, setProgress] = useState<Record<string, PushProgress>>({});
  // 共有可否はマウント時に一度だけ判定（UA でなく canShare の実プローブ）
  const [canWebShare] = useState(() => canShareFilesToInbox());

  /** push モジュールを一度だけロードする（gsi はここでは読まれない — prepare 時のみ）。 */
  const loadModule = useCallback((): Promise<PushModule> => {
    if (!moduleRef.current) {
      moduleRef.current = import("./push").then((mod) => {
        if (!pusherRef.current) pusherRef.current = new mod.GoogleDrivePusher();
        return mod;
      });
    }
    return moduleRef.current;
  }, []);

  /** configured/connected を読み直し、新たに configured なら prepare を先回りする。 */
  const refreshStatus = useCallback(() => {
    const pusher = pusherRef.current;
    if (!pusher) return;
    const isConfigured = pusher.isConfigured();
    setConfigured(isConfigured);
    setConnected(pusher.isConnected());
    if (isConfigured) {
      // 契約: connect() をジェスチャ内で同期的に呼べるよう、prepare は事前に済ませる
      void pusher.prepare().catch((err) => {
        console.warn("push prepare failed:", err instanceof Error ? err.message : err);
      });
    }
  }, []);

  /**
   * 接続が生きていて pending があれば drain。force は明示操作（送信ボタン・接続直後・
   * 再試行直後）用で、pending の有無を見ずに必ず試す。
   */
  const maybeDrain = useCallback(
    (opts?: { force?: boolean }) => {
      void (async () => {
        const mod = await loadModule();
        const pusher = pusherRef.current;
        if (!pusher) return;
        if (!pusher.isConnected()) {
          setConnected(false);
          return;
        }
        if (!opts?.force) {
          const items = snapshotRef.current?.items ?? [];
          if (!items.some((item) => item.status === "pending")) return;
        }
        const result = await mod.drainPushQueue(pusher, {
          onItemProgress: (id, p) => setProgress((prev) => ({ ...prev, [id]: p })),
        });
        if (result.aborted === "auth") setConnected(false);
        else setConnected(pusher.isConnected());
        // 送れたアイテムはキューから消えるので進捗表示も畳む
        setProgress({});
      })().catch((err) => {
        console.error("push queue drain failed:", err instanceof Error ? err.message : err);
      });
    },
    [loadModule],
  );

  // マウント時: モジュールロード → 状態初期化 → 購読 → 残キューがあれば drain。
  // 実験フラグ OFF の間は何もロードしない（前回セッションの残キューも触らない —
  // OFF の裏で勝手に送信が走るのを防ぐ）。ON へ切り替わったらここから立ち上がる。
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      snapshotRef.current = null;
      setSnapshot(null);
      return;
    }
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void loadModule()
      .then((mod) => {
        if (cancelled) return;
        setReady(true);
        refreshStatus();
        unsubscribe = mod.subscribePushQueue((snap) => {
          snapshotRef.current = snap;
          setSnapshot(snap);
        });
        // 前回セッションの残り（PWA が殺された等）を拾う
        maybeDrain({ force: true });
      })
      .catch((err) => {
        console.error("push module load failed:", err instanceof Error ? err.message : err);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, loadModule, refreshStatus, maybeDrain]);

  // フォアグラウンド復帰 / オンライン復帰で drain（トークン失効の検知も兼ねる）
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshStatus();
      maybeDrain();
    };
    const onOnline = () => maybeDrain();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, refreshStatus, maybeDrain]);

  // 設定モーダル側での client_id 変更・接続・切断を反映する（push-events 経由）。
  // ホームのキューは常時見えているので「シートを開き直したら読み直す」という
  // かつての契機が無い — 変更点イベントが唯一の同期手段。設定画面で接続が生きたら
  // 残キューをその場で流す（離散イベント起点なので、snapshot 購読から drain を
  // 起動しない不変条件には抵触しない）。
  useEffect(() => {
    if (!enabled) return;
    const onStatusChanged = () => {
      refreshStatus();
      maybeDrain();
    };
    window.addEventListener(PUSH_STATUS_EVENT, onStatusChanged);
    return () => window.removeEventListener(PUSH_STATUS_EVENT, onStatusChanged);
  }, [enabled, refreshStatus, maybeDrain]);

  // Web Share フォールバック用の事前復元。
  // ジェスチャ内で IndexedDB を await すると iOS で user activation を失うため、
  // 未設定モードの間はキューが変わるたびに File を復元してリファレンスに保持する。
  useEffect(() => {
    if (!canWebShare || configured || !ready) {
      webShareFilesRef.current = [];
      return;
    }
    let stale = false;
    void loadModule()
      .then((mod) => mod.getPushQueueFiles())
      .then((files) => {
        if (!stale) webShareFilesRef.current = files;
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [canWebShare, configured, ready, snapshot, loadModule]);

  const enqueueForSend = useCallback(
    async (files: File[]): Promise<boolean> => {
      // フラグ OFF は常にローカル保存へフォールバック（キューにもモジュールにも触らない）
      if (!enabled) return false;
      if (files.length === 0) return false;
      const mod = await loadModule();
      const pusher = pusherRef.current;
      if (!pusher) return false;
      const isConfigured = pusher.isConfigured();
      setConfigured(isConfigured);
      if (!isConfigured && !canWebShare) return false; // ローカル保存へフォールバック
      try {
        await mod.enqueuePushFiles(files);
      } catch (err) {
        // IndexedDB 不可（プライベートモード等）→ ローカル保存へフォールバック
        console.warn("push enqueue failed:", err instanceof Error ? err.message : err);
        return false;
      }
      maybeDrain();
      return true;
    },
    [enabled, canWebShare, loadModule, maybeDrain],
  );

  const drainNow = useCallback(() => maybeDrain({ force: true }), [maybeDrain]);

  const connectAndDrain = useCallback(() => {
    const pusher = pusherRef.current;
    if (!pusher || connecting) return;
    setConnecting(true);
    setConnectError(null);
    // 契約: connect() はこの同期呼び出しの中でトークン要求まで到達する。
    // ここより前に await を置かないこと（iOS がポップアップをブロックする）。
    pusher
      .connect()
      .then(() => {
        setConnected(true);
        maybeDrain({ force: true });
      })
      .catch((err) => {
        setConnected(pusher.isConnected());
        setConnectError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setConnecting(false));
  }, [connecting, maybeDrain]);

  const removeItem = useCallback(
    (id: string) => {
      void loadModule()
        .then((mod) => mod.removePushQueueItem(id))
        .catch((err) => {
          console.error("push queue remove failed:", err instanceof Error ? err.message : err);
        });
    },
    [loadModule],
  );

  const retryFailed = useCallback(() => {
    void loadModule()
      .then(async (mod) => {
        await mod.retryFailedPushItems();
        maybeDrain({ force: true });
      })
      .catch((err) => {
        console.error("push queue retry failed:", err instanceof Error ? err.message : err);
      });
  }, [loadModule, maybeDrain]);

  const getItemFile = useCallback(
    async (id: string): Promise<File | null> => {
      if (!enabled) return null;
      try {
        const mod = await loadModule();
        const files = await mod.getPushQueueFiles([id]);
        return files[0]?.file ?? null;
      } catch {
        // IndexedDB 不可・並行削除などはサムネイル無しに倒す（非致命的）
        return null;
      }
    },
    [enabled, loadModule],
  );

  const shareViaWebShare = useCallback((): Promise<ShareToInboxOutcome | null> => {
    const staged = webShareFilesRef.current;
    if (staged.length === 0) return Promise.resolve(null);
    // 最初の await より前に share を開始する（user activation を保つ）
    const sharePromise = shareFilesToInbox(staged.map((s) => s.file));
    return sharePromise.then(async (outcome) => {
      if (outcome.status === "shared") {
        // 共有シートに渡った時点で手離れ — キューから消す
        const mod = await loadModule();
        for (const s of staged) {
          await mod.removePushQueueItem(s.id);
        }
      }
      return outcome;
    });
  }, [loadModule]);

  return {
    ready,
    configured,
    connected,
    connecting,
    connectError,
    canWebShare,
    items: snapshot?.items ?? [],
    draining: snapshot?.draining ?? false,
    activeId: snapshot?.activeId ?? null,
    progress,
    enqueueForSend,
    drainNow,
    connectAndDrain,
    removeItem,
    retryFailed,
    shareViaWebShare,
    getItemFile,
    refreshStatus,
  };
}
