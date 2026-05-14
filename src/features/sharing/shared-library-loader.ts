// shared root から全 type の SharedEntry を一括読み出す（Phase 2c-Library）。
//
// 設計判断:
// - 各 type ごとに provider.list を呼び、エラーは type 単位で握りつぶして他 type の表示を維持
// - active な entry のみ（tombstone は除外、provider 側で実装済み）
// - hash 検証は重いので別パス（カードクリック / verify ボタン）で実行する想定。
//   ここでは検証しない

import {
  LocalFolderSharedProvider,
  type SharedEntry,
  type SharedEntryType,
} from "../../lib/storage/shared";

const ALL_TYPES: SharedEntryType[] = [
  "note",
  "reference",
  "data-manifest",
  "template",
  "claim",
  "atom",
  "report",
];

export type SharedLibraryLoadResult = {
  /** type ごとのエントリ配列。失敗した type は空配列 + errors に記録 */
  entries: Record<SharedEntryType, SharedEntry[]>;
  /** type 単位のエラーメッセージ */
  errors: Partial<Record<SharedEntryType, string>>;
};

export async function loadAllSharedEntries(
  root: string,
): Promise<SharedLibraryLoadResult> {
  const provider = new LocalFolderSharedProvider(root);
  const entries: Record<SharedEntryType, SharedEntry[]> = {
    note: [],
    reference: [],
    "data-manifest": [],
    template: [],
    claim: [],
    atom: [],
    report: [],
  };
  const errors: Partial<Record<SharedEntryType, string>> = {};

  await Promise.all(
    ALL_TYPES.map(async (type) => {
      try {
        const list = await provider.list(type);
        // updated_at 降順
        list.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
        entries[type] = list;
      } catch (e) {
        errors[type] = e instanceof Error ? e.message : String(e);
      }
    }),
  );

  return { entries, errors };
}
