// 予約フォルダ「計画」の判定ユーティリティ。
//
// 「計画」フォルダ（noteContexts）は特別な意味を持つ予約語で、ノート間プロセス機能
// （docs/internal/note-chain-plan.md）の入口になる。**予約語の集合はこのファイルだけに
// 閉じ込める** — UI 側・他の投影ロジックは isPlanFolderPath / isPlanNote だけを呼び、
// PLAN_FOLDER_KEYS をここ以外で直接比較しないこと。
//
// 比較規則は folder-store.ts の isSelfOrChild（L112-116）に揃える: trim → 小文字比較。
// 予約語判定だけは NFKC 正規化も加える（isSelfOrChild は正規化していない）。NFC では
// 全角英字（"ｐｌａｎ"）が "plan" に畳まれず取りこぼすため、互換等価まで畳む NFKC を使う。
//
// なお本機能の「計画ノート」（「計画」フォルダ配下のノート）は、論文抽出機能が使う
// GraphiumDocument.partOfPlanNoteId の「計画ノート」（実施ノートの親）とは**別概念**。
// 混同注意（docs/ARCHITECTURE.md §3.3 / document-types.ts 参照）。

import { normalizeNoteContexts } from "./context-tags";

/** 予約フォルダのキー（正規化前の表記）。この配列以外で予約語を直接書かない */
export const PLAN_FOLDER_KEYS: readonly string[] = ["計画", "plan"];

/**
 * フォルダパスを比較用に正規化する。
 * trim → NFKC 正規化 → 小文字化。folder-store.ts の isSelfOrChild に NFKC を足したもの。
 */
export function normalizeFolderKey(path: string): string {
  return path.trim().normalize("NFKC").toLowerCase();
}

/**
 * フォルダパスが予約フォルダ「計画」自身か、その子（"計画/xxx"）かどうか。
 * 「計画中」のような前方一致もどきは弾く（完全一致 or "計画/" で始まる、のみ）。
 */
export function isPlanFolderPath(path: string): boolean {
  const key = normalizeFolderKey(path);
  return PLAN_FOLDER_KEYS.some((reserved) => {
    const normalizedReserved = normalizeFolderKey(reserved);
    return key === normalizedReserved || key.startsWith(`${normalizedReserved}/`);
  });
}

/**
 * ノートの noteContexts に予約フォルダ「計画」（またはその子フォルダ）が含まれるか。
 * 要素の正規化（文字列以外の無視・trim・空の除外）は normalizeNoteContexts に任せ、
 * 規則を二重に持たない。
 */
export function isPlanNote(noteContexts: readonly unknown[] | undefined | null): boolean {
  const normalized = normalizeNoteContexts(noteContexts);
  if (!normalized) return false;
  return normalized.some((value) => isPlanFolderPath(value));
}
