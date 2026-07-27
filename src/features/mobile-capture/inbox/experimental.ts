// モバイル連携（スマホで撮る → 送信キュー → Google Drive → デスクトップ受信箱）の
// 実験フラグ。既定 OFF。ON にしない限り、送信キュー・受信箱・設定のモバイル送信
// セクションといった入口は一切表示されない（従来のローカル保存動作のまま）。
//
// - 保存先: localStorage（端末ごと）。settings store には載せない —
//   mobile-capture feature 内で疎結合に読めるよう、inbox/config.ts と同じ
//   try/catch ガード形の独立ヘルパーにする。
// - リロード不要の反映: setMobileInboxEnabled が CustomEvent を飛ばし、
//   useMobileInboxFlag を使う各所（note-app / MobileCaptureView / 設定モーダル）が
//   その場で再レンダリングする（graphium-open-settings と同じ window イベント間接化）。
//   storage イベントも購読するので別タブの切替にも追従する。

import { useEffect, useState } from "react";

const FLAG_KEY = "graphium-experimental-mobile-inbox";

/** フラグ切替の同一タブ内通知（storage イベントは他タブにしか飛ばないため自前で流す）。 */
export const MOBILE_INBOX_FLAG_EVENT = "graphium-mobile-inbox-flag-changed";

/** モバイル連携（実験的機能）が有効か。既定 false。 */
export function isMobileInboxEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** モバイル連携フラグを切り替える。OFF はキー削除（= 既定に戻す）。 */
export function setMobileInboxEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(FLAG_KEY, "1");
    } else {
      localStorage.removeItem(FLAG_KEY);
    }
  } catch {
    // localStorage 不可の環境では黙って無視（getInboxRoot と同じ非致命的挙動）
  }
  try {
    window.dispatchEvent(new CustomEvent(MOBILE_INBOX_FLAG_EVENT));
  } catch {
    // window 不在（テスト等）は無視
  }
}

/**
 * フラグを反応的に読む hook。切替イベント（同一タブ）と storage イベント（別タブ）を
 * 購読するので、設定モーダルのトグル変更がリロード無しで全入口に反映される。
 */
export function useMobileInboxFlag(): boolean {
  const [enabled, setEnabled] = useState(() => isMobileInboxEnabled());
  useEffect(() => {
    const handler = () => setEnabled(isMobileInboxEnabled());
    window.addEventListener(MOBILE_INBOX_FLAG_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(MOBILE_INBOX_FLAG_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return enabled;
}
