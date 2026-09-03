// ノートをフォルダへドラッグしたときに、そのノートのフォルダ（noteContexts）を
// どう書き換えるかを決める。
//
// エクスプローラーの移動/コピーに寄せつつ、Graphium の「1 ノートが複数フォルダに
// 入れる」性質で事故が起きないようにする:
//
//   - フォルダを開いた状態から動かす → **そのフォルダから出て、落とし先に入る**（移動）
//   - すべてのノート・未分類から動かす → **落とし先に入るだけ**（出るべき場所が無い）
//   - Ctrl / Cmd を押しながら → **出ずに入るだけ**（コピー）
//
// 「移動」で全フォルダを落とし先だけに置き換えないのは、関係のないフォルダまで
// 黙って剥がしてしまうため。出るのは「今開いていたフォルダ」だけに限る。

import { normalizeNoteContexts } from "./context-tags";
import { UNFILED_PATH } from "./folder-tree-model";

export type FolderDropMode = "move" | "copy";

/** そのフォルダ自身か、その子（"親/子"）にあたるか。前方一致は "/" 境界で判定する */
function isSelfOrChild(candidate: string, path: string): boolean {
  const key = candidate.trim().toLowerCase();
  const target = path.trim().toLowerCase();
  return key === target || key.startsWith(`${target}/`);
}

/**
 * ドロップ後の noteContexts を返す。変化が無ければ null（保存を走らせない）。
 *
 * @param current    ドラッグ元ノートの現在のフォルダ
 * @param target     落とし先フォルダの path
 * @param sourceFolder 開いていたフォルダ（すべてのノート・未分類なら null / UNFILED_PATH）
 * @param mode       move = 出て入る / copy = 入るだけ
 */
export function computeFolderDrop(
  current: readonly string[] | undefined,
  target: string,
  sourceFolder: string | null | undefined,
  mode: FolderDropMode,
): string[] | undefined | null {
  const targetPath = target.trim();
  if (!targetPath || targetPath === UNFILED_PATH) return null;

  const kept: string[] = [];
  for (const c of current ?? []) {
    if (typeof c !== "string") continue;
    // 落とし先に既に入っているなら、そこは入れ直さず 1 つに畳む（後で足す）
    if (c.trim().toLowerCase() === targetPath.toLowerCase()) continue;
    // 移動のときだけ、開いていたフォルダ（とその子）から出る
    if (
      mode === "move" &&
      sourceFolder &&
      sourceFolder !== UNFILED_PATH &&
      isSelfOrChild(c, sourceFolder)
    ) {
      continue;
    }
    kept.push(c);
  }

  const next = normalizeNoteContexts([...kept, targetPath]);
  // 所属が変わっていなければ保存しない。比較はフォルダの名寄せと同じ小文字で行う —
  // 既に入っているフォルダへ落としたときに、表記だけ落とし先に揃える書き換えが
  // 走るのを防ぐ（ユーザーから見れば「何も起きないはず」の操作）。
  const membership = (list: readonly string[] | undefined): string =>
    (list ?? [])
      .map((c) => c.trim().toLowerCase())
      .sort()
      .join(" ");
  if (membership(current) === membership(next)) return null;
  return next;
}

/** ドラッグ中のノート id を dataTransfer に載せるときのキー */
export const FOLDER_DRAG_MIME = "application/x-graphium-notes";

/** dataTransfer から取り出す（壊れていたら空配列） */
export function readDraggedNoteIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}
