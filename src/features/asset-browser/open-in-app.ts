// 素材を OS の既定のアプリ（Word / Excel / PowerPoint など）で開く（デスクトップ版のみ）
//
// Rust 側の open_media_in_app が `<root>/appdata/opened/{id}/{表示名}` に編集できる
// コピーを置いて開く。原本を直接渡さないのは、外のアプリでの保存が原本を書き換え、
// ノートや知識が引用している中身が黙って変わるのを防ぐため。コピーへの変更は
// Graphium に戻ったときに OpenedCopyNotice が知らせ、取り込むかを利用者が選ぶ。
// ブラウザ版はアプリを起動できないので、メニューの「原本をダウンロード」で代わりにする。

import { isTauri } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry } from "./media-index";

/** 「アプリで開く」を出せるか（デスクトップ版で、素材がこの端末のフォルダにあるドキュメント） */
export function canOpenInApp(entry: Pick<MediaIndexEntry, "type">): boolean {
  if (!isTauri()) return false;
  if (entry.type !== "document") return false;
  // 素材の実体が Graphium フォルダ（<root>/media）にあるときだけ。
  // 他のプロバイダ（Google ドライブ等）ではコピー元のファイルが手元に無い
  return getActiveProvider().id === "filesystem";
}

/** 素材の読み取り専用コピーを既定のアプリで開く */
export async function openInApp(entry: Pick<MediaIndexEntry, "fileId" | "url" | "name">): Promise<void> {
  const provider = getActiveProvider();
  const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_media_in_app", { fileId, name: entry.name });
}
