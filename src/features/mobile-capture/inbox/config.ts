// inbox 関連のデスクトップ側設定を localStorage に保存する。
//
// - inbox root（モバイルキャプチャ同期フォルダの親）: <inbox-root>/Inbox/ にモバイルが
//   素のメディアを置き、デスクトップ(Tauri)がそこを列挙 → 取り込む（FolderInbox /
//   runInboxImport）。
// - keep archive: 取り込み成功後の Inbox 側ファイルの後処理。既定は削除
//   （disposal:"delete"）で、これを ON にすると _imported/ へ退避（"archive"）する。
//
// 疎結合: hook / provider の具体には依存せず単独で読める。
// shared/config.ts の getSharedRoot/setSharedRoot と同じ try/catch ガード形。
//
// 同じ設定に入口が 2 つある（設定 › ストレージ = 正典 / 受信箱ビューのフォルダ設定
// メニュー = その場の近道）。どちらで変えても両方に反映させるため、setter は
// setter が CustomEvent を流し、useInboxConfig で購読する。

import { useEffect, useState } from "react";

const INBOX_ROOT_KEY = "graphium-inbox-root";
const INBOX_KEEP_ARCHIVE_KEY = "graphium-inbox-keep-archive";

/** inbox 設定変更の同一タブ内通知（storage イベントは他タブにしか飛ばないため自前で流す）。 */
export const INBOX_CONFIG_EVENT = "graphium-inbox-config-changed";

function notifyInboxConfigChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(INBOX_CONFIG_EVENT));
  } catch {
    // window 不在（テスト等）は無視
  }
}

/** Inbox 同期フォルダのルートパス（未設定なら null）。 */
export function getInboxRoot(): string | null {
  try {
    return localStorage.getItem(INBOX_ROOT_KEY);
  } catch {
    return null;
  }
}

/** Inbox 同期フォルダのルートパスを保存する。空文字/null は設定解除。 */
export function setInboxRoot(path: string | null): void {
  try {
    if (path === null || path.trim() === "") {
      localStorage.removeItem(INBOX_ROOT_KEY);
    } else {
      localStorage.setItem(INBOX_ROOT_KEY, path);
    }
  } catch {
    // localStorage 不可の環境では黙って無視（getInboxRoot と同じ非致命的挙動）
  }
  notifyInboxConfigChanged();
}

/**
 * 取り込み後に処理済みファイルを _imported/ に残すか。
 * 既定 false = 取り込み成功後に Inbox 側ファイルを削除する（プライバシー優先:
 * 同期フォルダ = クラウドに処理済みの控えを溜め続けない）。
 */
export function getInboxKeepArchive(): boolean {
  try {
    return localStorage.getItem(INBOX_KEEP_ARCHIVE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 「処理済みを _imported/ に残す」を保存する。false は既定なのでキーごと消す。 */
export function setInboxKeepArchive(keep: boolean): void {
  try {
    if (keep) {
      localStorage.setItem(INBOX_KEEP_ARCHIVE_KEY, "1");
    } else {
      localStorage.removeItem(INBOX_KEEP_ARCHIVE_KEY);
    }
  } catch {
    // localStorage 不可の環境では黙って無視（getInboxRoot と同じ非致命的挙動）
  }
  notifyInboxConfigChanged();
}

/**
 * inbox 設定（root / keep-archive）を反応的に読む hook。
 * 設定モーダルと受信箱ビューのどちらで変えても、もう片方がリロード無しで追従する。
 * 別タブの変更（storage イベント）にも追従する。
 */
export function useInboxConfig(): { root: string | null; keepArchive: boolean } {
  const [state, setState] = useState(() => ({
    root: getInboxRoot(),
    keepArchive: getInboxKeepArchive(),
  }));
  useEffect(() => {
    const handler = () =>
      setState({ root: getInboxRoot(), keepArchive: getInboxKeepArchive() });
    window.addEventListener(INBOX_CONFIG_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(INBOX_CONFIG_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return state;
}
