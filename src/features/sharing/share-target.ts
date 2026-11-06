// 共有の書き込み先を決める（共有フォルダが複数あるときの規則を 1 か所に閉じる）。
//
// - 新しく共有する（既存の共有コピーが無い）→ 既定の共有先とその大きなファイルの置き場
// - 自分の共有コピーを更新する → そのコピーがあるフォルダ（resolveOwnCopyRoot）。
//   どのフォルダにあるか分からず、読めないフォルダがあるときは null（書かずに失敗させる）

import { getBlobRoot, getSharedRoot } from "../../lib/storage/shared/config";
import { ensureSharedEntryRoots, resolveOwnCopyRoot } from "./shared-library-store";

export type ShareTarget = {
  root: string;
  blobRoot: string | null;
};

/**
 * @param existingSharedId 自分の共有コピーの id（初回共有なら省く）
 * @returns 書き込み先。共有先が未設定、または共有コピーのフォルダに届かないとき null
 */
export async function resolveShareTarget(
  existingSharedId?: string | null,
  /** 初回共有で利用者が選んだ共有フォルダ（省くと既定の共有先）。再共有では使わない */
  chosenRoot?: string | null,
): Promise<ShareTarget | null> {
  if (!existingSharedId) {
    const root = chosenRoot || getSharedRoot();
    return root ? { root, blobRoot: getBlobRoot(root) } : null;
  }
  // 居場所を引く前に一覧を読み終えておく（起動直後に既定の共有先へ二重作成しないため）
  await ensureSharedEntryRoots();
  const root = resolveOwnCopyRoot(existingSharedId, getSharedRoot());
  return root ? { root, blobRoot: getBlobRoot(root) } : null;
}
