// 素材が属するフォルダを求める。
//
// 素材のフォルダには 2 つの出どころがある:
//   - 自分で付けたもの（MediaIndexEntry.noteContexts）
//   - 使われているノートのフォルダ（usedIn のノートが入っているフォルダ）
//
// 「材料X のノートに貼った写真は材料X のもの」という関係は、人が付け直さなくても
// 成り立っているはずなので、後者は**保存せず、その場で合成する**（導出）。
// 書き込んでしまうと、あとでノート側のフォルダを変えても素材に古い値が residue として
// 残り、一度貼っただけの素材に意図しないフォルダが溜まっていく。
//
// 導出なので、ノートからフォルダが外れれば素材からも自然に消える。自分で付けた分は
// ノートに関係なく常に残る。

import type { MediaIndexEntry } from "./media-index";
import { normalizeNoteContexts } from "../note-context/context-tags";

/** ノート id → そのノートのフォルダ。導出の参照表 */
export type NoteFolderLookup = ReadonlyMap<string, readonly string[]>;

/** ノートインデックスのエントリから参照表を作る */
export function buildNoteFolderLookup(
  notes: readonly { noteId: string; noteContexts?: string[] }[],
): NoteFolderLookup {
  const map = new Map<string, readonly string[]>();
  for (const n of notes) {
    const folders = normalizeNoteContexts(n.noteContexts);
    if (folders) map.set(n.noteId, folders);
  }
  return map;
}

export type AssetFolder = {
  value: string;
  /** true = 使われているノートから導いたもの（自分で付けたものではない） */
  derived: boolean;
};

/**
 * 素材が属するフォルダを、出どころ付きで返す。
 * 自分で付けたものを先に、ノート由来をあとに並べる。両方に同じ名前があれば
 * 「自分で付けた」を優先する（外しても勝手に戻る、という誤解を避けるため）。
 */
export function resolveAssetFolders(
  entry: Pick<MediaIndexEntry, "noteContexts" | "usedIn">,
  lookup: NoteFolderLookup,
): AssetFolder[] {
  const own = normalizeNoteContexts(entry.noteContexts) ?? [];
  const seen = new Set(own.map((c) => c.trim().toLowerCase()));
  const out: AssetFolder[] = own.map((value) => ({ value, derived: false }));

  for (const usage of entry.usedIn ?? []) {
    for (const folder of lookup.get(usage.noteId) ?? []) {
      const key = folder.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: folder, derived: true });
    }
  }
  return out;
}

/** 絞り込み用に、出どころを問わずフォルダ名だけ取り出す */
export function assetFolderValues(
  entry: Pick<MediaIndexEntry, "noteContexts" | "usedIn">,
  lookup: NoteFolderLookup,
): string[] {
  return resolveAssetFolders(entry, lookup).map((f) => f.value);
}
