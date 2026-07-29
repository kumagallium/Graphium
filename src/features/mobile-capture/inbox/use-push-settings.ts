// スタンドアロン push 設定フック（最小設定シート用）。
//
// usePushQueue が「キューの配線」なのに対し、こちらは **キューに触れない設定面** —
// 最小設定シート（MobileSettingsSheet）の 接続状態 / 切断 / client_id 上書きだけ。
// 接続（connect）は usePushQueue.connectAndDrain 一本に集約されているので、ここには
// 置かない（成功したら残キューをその場で流す必要があり、キュー配線側の仕事）。
//
// push/（gsi・IndexedDB）は use-push-queue と同じく **動的 import** で引く — この
// フックも起動時バンドルに入るため、push/ から値 import してはいけない（type のみ可）。
// active=false の間は何もロードしない。
//
// ジェスチャ契約の下ごしらえ: active になった時点で prepare() を先回りしておくので、
// 呼び出し側（ストレージ選択ピッカー → usePushQueue.connectAndDrain）は click から
// 同期でトークン要求まで到達できる（iOS のポップアップブロック回避）。
//
// 別面（設定モーダル・ホームのキュー・別タブ）での接続/切断/client_id 変更は
// PUSH_STATUS_EVENT（+ トークン保存側の emit）経由でこのフックにも反映される。

import { useCallback, useEffect, useRef, useState } from "react";
import { PUSH_STATUS_EVENT } from "./push-events";
import type { InboxPusher } from "./push";

type PushModule = typeof import("./push");

export type PushSettingsUi = {
  /** push モジュールのロードが済んだか。false の間は他フィールドは暫定値。 */
  ready: boolean;
  /** client_id が解決できるか（同梱 or 自前上書き）。 */
  configured: boolean;
  /** 有効期限内のトークンがあるか。 */
  connected: boolean;
  /** 同梱 client_id のあるビルドか。 */
  hasBundledId: boolean;
  /** 自前 client_id 上書きの現在値（未設定は空文字）。 */
  clientIdOverride: string;
  /** connect() のポップアップ進行中か。 */
  connecting: boolean;
  /** 直近の接続エラー（表示用）。 */
  connectError: string | null;
  /** 切断（トークン revoke + 破棄）。他の購読面へはイベント経由で伝播する。 */
  disconnect: () => void;
  /** 自前 client_id を保存する（空は不可 — 解除は clearClientId）。 */
  saveClientId: (value: string) => void;
  /** 自前 client_id を解除して同梱デフォルトに戻す。 */
  clearClientId: () => void;
};

/**
 * @param active シート/ピッカーが開いている間だけ true。false の間は push モジュールを
 *   ロードせず不活性（ホームを見ているだけのときは何も読まない）。
 */
export function usePushSettings(active: boolean): PushSettingsUi {
  const moduleRef = useRef<PushModule | null>(null);
  const pusherRef = useRef<InboxPusher | null>(null);

  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasBundledId, setHasBundledId] = useState(true);
  const [clientIdOverride, setClientIdOverride] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  /** configured/connected/上書き値を localStorage から読み直す。 */
  const refreshStatus = useCallback(() => {
    const mod = moduleRef.current;
    const pusher = pusherRef.current;
    if (!mod || !pusher) return;
    setConfigured(pusher.isConfigured());
    setConnected(pusher.isConnected());
    setClientIdOverride(mod.getGoogleClientIdOverride() ?? "");
    if (pusher.isConfigured()) {
      // 契約: connect() をジェスチャ内で同期的に呼べるよう、prepare は事前に済ませる
      void pusher.prepare().catch(() => {
        // 未設定・オフライン等は接続時に再表面化する
      });
    }
  }, []);

  // active になったらロード → 状態初期化。active=false へ戻っても ready は保つ
  // （モジュールはプロセス内キャッシュ済みで、閉じて開き直すたびの初期化を省く）。
  useEffect(() => {
    if (!active || moduleRef.current) {
      if (active && moduleRef.current) refreshStatus();
      return;
    }
    let cancelled = false;
    void import("./push")
      .then((mod) => {
        if (cancelled) return;
        moduleRef.current = mod;
        if (!pusherRef.current) pusherRef.current = new mod.GoogleDrivePusher();
        setHasBundledId(mod.DEFAULT_GOOGLE_PUSH_CLIENT_ID !== "");
        setReady(true);
        refreshStatus();
      })
      .catch((err) => {
        console.error("push settings load failed:", err instanceof Error ? err.message : err);
      });
    return () => {
      cancelled = true;
    };
  }, [active, refreshStatus]);

  // 他面（設定モーダル・キュー・別タブ）での変更を反映
  useEffect(() => {
    if (!active) return;
    const handler = () => refreshStatus();
    window.addEventListener(PUSH_STATUS_EVENT, handler);
    return () => window.removeEventListener(PUSH_STATUS_EVENT, handler);
  }, [active, refreshStatus]);

  const disconnect = useCallback(() => {
    const pusher = pusherRef.current;
    if (!pusher) return;
    pusher.disconnect();
    setConnected(false);
  }, []);

  const saveClientId = useCallback((value: string) => {
    const mod = moduleRef.current;
    if (!mod) return;
    mod.setGoogleClientIdOverride(value);
    setConnectError(null);
    refreshStatus();
  }, [refreshStatus]);

  const clearClientId = useCallback(() => {
    const mod = moduleRef.current;
    if (!mod) return;
    mod.setGoogleClientIdOverride(null);
    setConnectError(null);
    refreshStatus();
  }, [refreshStatus]);

  return {
    ready,
    configured,
    connected,
    hasBundledId,
    clientIdOverride,
    connecting,
    connectError,
    disconnect,
    saveClientId,
    clearClientId,
  };
}
