// デスクトップ（Tauri）でのフォルダ走査。
//
// ブラウザの `<input webkitdirectory>` は、列挙したファイル 1 件ごとに
// 「これは macOS のエイリアスファイルか」を OS に問い合わせる（getattrlist）。
// 手元のディスクなら無視できるコストだが、NAS（afp / smb）越しでは 1 件ごとに
// ネットワーク往復が発生するため、ファイル数に比例して実用にならない速度になる。
// 実測では WebView のメインスレッド時間の 65% がこの問い合わせで消えていた。
//
// そこで Tauri のときは列挙を Rust に任せ、ここではパスと名前とサイズだけを
// 受け取る。ファイルの中身は getFile() が呼ばれた瞬間に 1 件ずつ読む。
// ブラウザ版はこれまでどおり webkitdirectory を使う（types.ts の toIntakeFiles）。

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@/lib/platform";
import { guessMimeType } from "./classify";
import type { IntakeFile } from "./types";

/** Rust の ScannedFile と対。フィールド名は camelCase で渡ってくる */
type ScannedFile = {
  /** 絶対パス。read_scanned_file にはこの値をそのまま返す */
  path: string;
  /** 選んだフォルダからの相対パス（"/" 区切り） */
  relativePath: string;
  name: string;
  size: number;
};

type ScanResult = { files: ScannedFile[]; truncated: boolean };

export type NativeScanOutcome = {
  files: IntakeFile[];
  /** 上限に達して打ち切られた場合 true。全部は入らないことを利用側が伝える */
  truncated: boolean;
};

/** この環境でネイティブ走査が使えるか（＝デスクトップか） */
export function isNativeScanAvailable(): boolean {
  return isTauri();
}

/**
 * フォルダを 1 つ選ばせる。キャンセルされたら null。
 *
 * Tauri のダイアログはパスを返すだけなので、選んだ時点ではまだ中身を一切見ていない。
 */
export async function pickFolderNative(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  // multiple: false なので string か null だが、型定義上は配列も来うる
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked ?? null;
}

/**
 * 選んだフォルダを Rust に走査させ、IntakeFile[] に変換する。
 * この時点ではまだどのファイルも読んでいない（パスと属性だけ）。
 */
export async function scanFolderNative(root: string): Promise<NativeScanOutcome> {
  const result = await invoke<ScanResult>("scan_directory", { root });
  return {
    files: result.files.map(toIntakeFile),
    truncated: result.truncated,
  };
}

function toIntakeFile(scanned: ScannedFile): IntakeFile {
  // ネイティブ走査では MIME が分からないので拡張子から推定する。
  // classify 側も同じ関数でフォールバックしているので判定結果は揃う
  const type = guessMimeType(scanned.name);
  return {
    path: scanned.relativePath,
    name: scanned.name,
    size: scanned.size,
    type,
    // 読んだ中身はあえて保持しない。取り込みは 1 ファイルにつき 1 回しか
    // getFile() を呼ばない作りになっており、ここで抱えると数千件分の
    // バイト列がそのままメモリに残る。同じファイルを二度要求する側
    // （note-app の resolveImage など）が自前でキャッシュを持つ
    //
    // Rust 側は Base64 ではなく生バイト（tauri::ipc::Response）で返す。
    // フォルダを丸ごと列挙する経路なので数百 MB の動画が混ざりうる。
    // Base64 だと元データ＋約 1.33 倍の文字列が両側に同時に乗る
    getFile: async () => {
      const bytes = await invoke<ArrayBuffer>("read_scanned_file", { path: scanned.path });
      return new File([bytes], scanned.name, { type });
    },
  };
}
