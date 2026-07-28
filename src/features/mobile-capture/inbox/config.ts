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

const INBOX_ROOT_KEY = "graphium-inbox-root";
const INBOX_KEEP_ARCHIVE_KEY = "graphium-inbox-keep-archive";

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
}
