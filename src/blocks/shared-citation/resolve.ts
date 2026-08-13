// shared:// 引用の表示時解決（読み込み・hash 照合・新版検知）。
//
// 状態の判定順（docs/internal/team-shared-storage-design.md §5 / §9）:
// 1. Web 版 or shared root 未設定 → offline（ブロック props のスナップショットで表示）
// 2. read 成功:
//    - tombstone（status: "unshared"）→ missing
//    - verifyHash 不一致 → mismatch（破損・Graphium を通さない書き換えの検知）
//    - superseded_by あり → 新版バナー（major 改訂の通知）
//    - それ以外 → verified。entry.hash が引用時と違えば minor 更新 → 呼び出し側で追従
// 3. read 失敗: shared_root_exists で切り分け
//    - root がある → エントリだけ無い = missing（削除・共有解除）
//    - root が無い → NAS 未マウント等 = offline
//
// mismatch は「共有側の manifest と実体が食い違っている」異常の検知であって、
// 「引用時から内容が変わった」ではない点に注意（後者は minor 追従 / 新版バナーが担う）。

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/platform";
import { getSharedRoot } from "../../lib/storage/shared/config";
import { LocalFolderSharedProvider, type SharedEntry } from "../../lib/storage/shared";
import type { CitationStatus } from "../../features/sharing/SharedCitationCard";

export type CitationResolution = {
  status: CitationStatus;
  /** read に成功したときの最新エントリ（minor 追従・新版遷移に使う） */
  entry?: SharedEntry;
  hasNewerVersion: boolean;
};

const OFFLINE: CitationResolution = { status: "offline", hasNewerVersion: false };
const MISSING: CitationResolution = { status: "missing", hasNewerVersion: false };

export async function resolveCitation(sharedId: string): Promise<CitationResolution> {
  if (!isTauri()) return OFFLINE;
  const root = getSharedRoot();
  if (!root) return OFFLINE;

  const provider = new LocalFolderSharedProvider(root);
  try {
    const { entry } = await provider.read(sharedId);
    if (entry.status === "unshared") return MISSING;
    const hasNewerVersion = Boolean(entry.superseded_by);
    const intact = await provider.verifyHash(sharedId);
    if (!intact) return { status: "mismatch", entry, hasNewerVersion };
    return { status: "verified", entry, hasNewerVersion };
  } catch {
    const rootOk = await invoke<boolean>("shared_root_exists", { root }).catch(
      () => false,
    );
    return rootOk ? MISSING : OFFLINE;
  }
}
