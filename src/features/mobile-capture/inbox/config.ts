// inbox root（モバイルキャプチャ同期フォルダの親）の設定を localStorage に保存する。
//
// <inbox-root>/Inbox/ にモバイルが素のメディアを置き、デスクトップ(Tauri)が
// そこを列挙 → 取り込み → _imported/ へ退避する（FolderInbox / runInboxImport）。
//
// 疎結合: hook / provider の具体には依存せず単独で読める。
// shared/config.ts の getSharedRoot/setSharedRoot と同じ try/catch ガード形。

const INBOX_ROOT_KEY = "graphium-inbox-root";

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
