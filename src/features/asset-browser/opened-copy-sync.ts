// 「アプリで開く」で外のアプリ（Word / Excel / PowerPoint など）が編集したコピーを、
// Graphium の素材に取り込む（デスクトップ版のみ）。
//
// 開くときに Rust 側が `<root>/appdata/opened/{id}/{表示名}` に編集できるコピーを置き、
// そのときの中身のハッシュを覚えている。Graphium に戻ってきたとき（起動時・ウィンドウに
// フォーカスが戻ったとき）に list_changed_opened_copies で「覚えたハッシュから中身が
// 変わったコピー」を集め、利用者に知らせる。勝手には取り込まない。
//
// 取り込み方は、元の素材が引用されているかで変わる:
//   - どこからも引用されていない → 同じ素材を上書き（adopt_opened_copy。容量は増えない）
//   - ノート・知識・過去の版・テンプレート・共有のどこかから引用されている
//       → 元の版は残し、新しい素材（新しい版）として登録する。
//         新しい版には revisionOf / derivedFromAssets で元の版を記録し、
//         コピーは新しい版のものに付け替える（rebase_opened_copy）。以後の保存は
//         まだ引用されていない新しい版への変更になるので、途中の版は増えない。
// 変更を捨てるときはコピーを消す（discard_opened_copy）。

import type { MediaIndexEntry } from "./media-index";

/** 外のアプリで編集された（まだ取り込んでいない）コピー */
export type ChangedOpenedCopy = { fileId: string; fileName: string };

/** 取り込み方 */
export type AdoptionMode = "replace" | "new-version";

/** usedIn 以外で数える引用（版スナップショット・テンプレート）の数 */
export type ExtraRefCounts = { snapshots: number; templates: number };

/**
 * 元の素材を上書きしてよいか（どこからも引用されていないか）。
 * 迷う材料が 1 つでもあれば新しい版にする（上書きは取り返しがつかないため）。
 */
export function decideAdoption(entry: Pick<MediaIndexEntry, "usedIn" | "sharedRef">, extra: ExtraRefCounts): AdoptionMode {
  const cited =
    entry.usedIn.length > 0
    || !!entry.sharedRef
    || extra.snapshots > 0
    || extra.templates > 0;
  return cited ? "new-version" : "replace";
}

/**
 * 新しい版の素材に付ける欄。元の版の名前・フォルダ・出どころを引き継ぎ、
 * どの版の改訂かを記録する。
 */
export function revisionPatch(previous: MediaIndexEntry): Partial<MediaIndexEntry> {
  return {
    revisionOf: previous.fileId,
    derivedFromAssets: [previous.fileId],
    ...(previous.noteContexts && previous.noteContexts.length > 0 ? { noteContexts: previous.noteContexts } : {}),
    ...(previous.sourceInfo ? { sourceInfo: previous.sourceInfo } : {}),
  };
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function listChangedOpenedCopies(): Promise<ChangedOpenedCopy[]> {
  return tauriInvoke<ChangedOpenedCopy[]>("list_changed_opened_copies");
}

/** 編集されたコピーの中身（新しい版として登録する用） */
export async function readOpenedCopy(fileId: string): Promise<Uint8Array> {
  const base64 = await tauriInvoke<string>("read_opened_copy", { fileId });
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** コピーの中身で元の素材を上書きする。新しい中身のハッシュ（`sha256:<hex>`）を返す */
export function adoptOpenedCopy(fileId: string): Promise<string> {
  return tauriInvoke<string>("adopt_opened_copy", { fileId });
}

/** コピーを新しい版の素材のものに付け替える */
export function rebaseOpenedCopy(fromFileId: string, toFileId: string): Promise<void> {
  return tauriInvoke<void>("rebase_opened_copy", { fromFileId, toFileId });
}

/** 外での変更を捨てる */
export function discardOpenedCopy(fileId: string): Promise<void> {
  return tauriInvoke<void>("discard_opened_copy", { fileId });
}
