// shared root / blob root の設定（localStorage に保存）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §設定 UI
//
// Phase 1b では path を保存するだけ。Settings UI は次の PR。

const SHARED_ROOT_KEY = "graphium-shared-root";
const BLOB_ROOT_KEY = "graphium-shared-blob-root";
const SHARED_AI_ENABLED_KEY = "graphium-shared-ai-enabled";

/** Shared ストレージのルートパス（未設定なら null）。 */
export function getSharedRoot(): string | null {
  try {
    return localStorage.getItem(SHARED_ROOT_KEY);
  } catch {
    return null;
  }
}

export function setSharedRoot(path: string | null): void {
  if (path === null || path.trim() === "") {
    localStorage.removeItem(SHARED_ROOT_KEY);
  } else {
    localStorage.setItem(SHARED_ROOT_KEY, path);
  }
}

/**
 * Blob ストレージのルートパス（未設定なら shared root と同じディレクトリ配下に
 * `_blobs/` を作る運用にフォールバックすると後で混乱するので、
 * Phase 1b では「未設定なら null を返す」だけにし、Provider 側で扱いを決める）。
 */
export function getBlobRoot(): string | null {
  try {
    return localStorage.getItem(BLOB_ROOT_KEY);
  } catch {
    return null;
  }
}

export function setBlobRoot(path: string | null): void {
  if (path === null || path.trim() === "") {
    localStorage.removeItem(BLOB_ROOT_KEY);
  } else {
    localStorage.setItem(BLOB_ROOT_KEY, path);
  }
}

/**
 * 共有ライブラリのエントリを ⌘K・AI チャットの対象に含めるか（既定 true）。
 *
 * 既定を ON にしているのは、共有ルートを設定すること自体がオプトインだから
 * （フォルダを繋いだ人は共有物を使いたい人）。OFF にすると手元の索引から
 * 共有分だけが消える（共有フォルダには元々何も書いていない）。
 */
export function getSharedAiEnabled(): boolean {
  try {
    // 未設定（null）は既定 ON。明示的に "0" を書いたときだけ OFF
    return localStorage.getItem(SHARED_AI_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSharedAiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SHARED_AI_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage が使えない環境では既定 ON のまま */
  }
}
