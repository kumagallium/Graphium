// vault のフォルダ一覧（list_folders）。
//
// フォルダの実体はノートの noteContexts タグ（"親" または "親/子"）。AI が create_note の
// 置き場所や search_notes / list_topics の範囲を選ぶとき、既存のフォルダ名を知らないと
// 似た名前のフォルダを新しく作ってしまう。そこでアプリのサイドバーと同じ木を返す。
//
// 木の組み方はアプリと同じ関数（collectFolderSource / buildFolderTree）を使う:
//   - タグ由来のフォルダ ∪ appdata/folders.json の空フォルダ定義（小文字で名寄せ）
//   - 件数は生きた人のノートだけ（ナレッジ層・Skill・ゴミ箱・アーカイブは数えない）

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildFolderTree, collectFolderSource, type FolderNode } from "../features/note-context/folder-tree-model";
import { FOLDER_DEFS_VERSION, type FolderDefinitionsFile } from "../features/note-context/folder-defs-format";
import { allEntries } from "./search";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export type FolderList = {
  folders: FolderNode[];
  /** どのフォルダにも入っていないノートの数 */
  unfiledCount: number;
};

/**
 * 空フォルダの定義（appdata/folders.json）を読む。
 * 無い・壊れている・版違いは空として扱う（アプリの folder-store と同じ扱い）。
 */
function readEmptyFolderDefinitions(root: string): string[] {
  const path = join(appDataDir(root), "folders.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as FolderDefinitionsFile;
    if (parsed?.version !== FOLDER_DEFS_VERSION || !Array.isArray(parsed.folders)) return [];
    return parsed.folders.filter((f): f is string => typeof f === "string");
  } catch {
    return [];
  }
}

/** アプリのサイドバーと同じフォルダの木を返す */
export function listFolders(root = resolveGraphiumRoot()): FolderList {
  const { folders, unfiledCount } = collectFolderSource(allEntries(root));
  return {
    folders: buildFolderTree(folders, readEmptyFolderDefinitions(root)),
    unfiledCount,
  };
}
