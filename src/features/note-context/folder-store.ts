// ──────────────────────────────────────────────
// 空フォルダ定義の保存と復元。
//
// フォルダの実体は noteContexts のタグなので、「タグ付きノートが 1 件もない
// フォルダ」はどこにも実体がなく、定義を持たないとリロードで消えてしまう。
// ユーザーが「＋ 新しいフォルダ」で作った名前をここに保存し、サイドバーの
// ツリーは「タグ由来のフォルダ ∪ この定義」の和集合（小文字名寄せ）で組む。
//
// 保存先は appdata（graph-layouts と同じ仕組み）。ストレージプロバイダ経由で
// 同期されるので別端末でも同じフォルダが見える。ノート JSON には一切書かない —
// フォルダ運用をやめてもノートデータに影響しない可逆性を保つ。
//
// タグが付いて実体化したフォルダの定義は消さずに残す（和集合なので表示は
// 重複しないし、全ノートからタグが外れたときフォルダだけ残る方が自然）。
// 定義から除くのはフォルダ削除のときだけ（タグ剥がしは呼び出し側の責務）。
// ──────────────────────────────────────────────

import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";
import { getActiveProvider } from "../../lib/storage/registry";
import type { StorageProvider } from "../../lib/storage/types";

const APP_DATA_KEY = "folders";
const DRIVE_FILE_NAME = ".graphium-folders.json";

/** 保存形式の版。形が変わったら上げる → 読み込み時に全破棄（空フォルダ定義は失っても軽傷） */
export const FOLDER_DEFS_VERSION = 1;

export type FolderDefinitionsFile = {
  version: number;
  /** ユーザーが作成したフォルダの path（"親" または "親/子"）。表記は作成時のまま保持 */
  folders: string[];
};

let cache: FolderDefinitionsFile | null = null;
let loading: Promise<FolderDefinitionsFile> | null = null;

function emptyFile(): FolderDefinitionsFile {
  return { version: FOLDER_DEFS_VERSION, folders: [] };
}

/** サインアウト・プロバイダ切り替え時に読み直させる */
export function clearFolderDefinitionsCache(): void {
  cache = null;
  loading = null;
}

/**
 * appdata から読み込む（成功したら以降はキャッシュ）。
 * ファイルが無い・壊れている・版違いは空として確定する — 空フォルダが消えるだけで実データは無傷。
 * 読み込み自体の失敗（ストレージプロバイダ初期化前など）はキャッシュを確定せず、
 * 次の呼び出しで再試行する（起動直後の一度の失敗で定義が消えたように見えるのを防ぐ）。
 */
export async function ensureFolderDefinitions(
  provider: StorageProvider = getActiveProvider(),
): Promise<string[]> {
  if (cache) return cache.folders;
  if (!loading) {
    loading = (async () => {
      try {
        const read = await readAppDataFile<FolderDefinitionsFile>(
          APP_DATA_KEY,
          DRIVE_FILE_NAME,
          provider,
        );
        const file =
          read && read.version === FOLDER_DEFS_VERSION && Array.isArray(read.folders)
            ? {
                version: FOLDER_DEFS_VERSION,
                folders: read.folders.filter((f): f is string => typeof f === "string"),
              }
            : emptyFile();
        cache = file;
        return file;
      } catch {
        // 読めなかった — キャッシュ未確定のまま空を返す（次回再試行）
        return emptyFile();
      } finally {
        loading = null;
      }
    })();
  }
  return (await loading).folders;
}

/**
 * フォルダ定義を追加して保存する（小文字比較で既存なら何もしない）。
 * 返り値は反映後の一覧。書き込みに失敗してもメモリ上は追加済みにする
 * （セッション中は見え続け、次回起動で消えるだけ）。
 */
export async function addFolderDefinition(
  path: string,
  provider: StorageProvider = getActiveProvider(),
): Promise<string[]> {
  await ensureFolderDefinitions(provider);
  const file = cache ?? emptyFile();
  const value = path.trim();
  const key = value.toLowerCase();
  if (!key) return file.folders;
  if (!file.folders.some((f) => f.trim().toLowerCase() === key)) {
    file.folders = [...file.folders, value];
    cache = file;
    try {
      await writeAppDataFile(APP_DATA_KEY, DRIVE_FILE_NAME, file, provider);
    } catch {
      // 書けなくてもメモリ上は有効
    }
  }
  return file.folders;
}

/** フォルダ定義から除いて保存する（フォルダ削除用）。返り値は反映後の一覧 */
export async function removeFolderDefinition(
  path: string,
  provider: StorageProvider = getActiveProvider(),
): Promise<string[]> {
  await ensureFolderDefinitions(provider);
  const file = cache ?? emptyFile();
  const key = path.trim().toLowerCase();
  const next = file.folders.filter((f) => f.trim().toLowerCase() !== key);
  if (next.length !== file.folders.length) {
    file.folders = next;
    cache = file;
    try {
      await writeAppDataFile(APP_DATA_KEY, DRIVE_FILE_NAME, file, provider);
    } catch {
      // 書けなくてもメモリ上は有効
    }
  }
  return file.folders;
}
