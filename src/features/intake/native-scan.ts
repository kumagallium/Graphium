// デスクトップ（Tauri）でのフォルダ走査。
//
// ブラウザの `<input webkitdirectory>` は、列挙したファイル 1 件ごとに
// 「これは macOS のエイリアスファイルか」を OS に問い合わせる（getattrlist）。
// 手元のディスクなら無視できるコストだが、NAS（afp / smb）越しでは 1 件ごとに
// ネットワーク往復が発生するため、ファイル数に比例して実用にならない速度になる。
// 実測では WebView のメインスレッド時間の 65% がこの問い合わせで消えていた。
//
// そこで Tauri のときは列挙を Rust に任せ、ここではパスと名前だけを受け取る
// （size は持たない。走査時点のサイズを実際に使う箇所は無く、取り込み側は
// getFile() で読んだ実体の size を見ればよいため、往復を増やしてまで
// 走査時に取得する理由がない）。ファイルの中身は getFile() が呼ばれた瞬間に
// 1 件ずつ読む。ブラウザ版はこれまでどおり webkitdirectory を使う
// （types.ts の toIntakeFiles）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
};

type ScanResult = { files: ScannedFile[]; truncated: boolean; cancelled: boolean };

export type NativeScanOutcome = {
  files: IntakeFile[];
  /** 上限に達して打ち切られた場合 true。全部は入らないことを利用側が伝える */
  truncated: boolean;
  /** 走査中に cancelFolderScanNative() で中止された場合 true。files は空 */
  cancelled: boolean;
};

export type NativeScanOptions = {
  /**
   * この走査を識別する ID。呼び出し側が createFolderScanId() で生成して渡す。
   * IntakeReceptacle が複数マウントされうる（モーダルはオーバーレイなので
   * 一覧の空状態と同時に存在しうる）ため、進捗イベントと中止要求を
   * 走査ごとに区別するのに使う
   */
  scanId: string;
  /**
   * 走査中、それまでに見つかった件数を随時受け取る（最短 200ms 間隔）。
   * found はファイル数、folders はキューに積んだ（見つけた）フォルダ数。
   * 幅優先走査では深いツリーに入るまでファイルが 1 件も見つからないことがあり、
   * その間も folders が動くことで「固まっていない」と伝えられる
   */
  onProgress?: (progress: { found: number; folders: number }) => void;
};

/** この環境でネイティブ走査が使えるか（＝デスクトップか） */
export function isNativeScanAvailable(): boolean {
  return isTauri();
}

/**
 * 走査 1 回分の識別子を発行する。呼び出し側（受け皿のインスタンスごと）が
 * 走査を始めるたびに新しく生成し、その走査の scanFolderNative / cancelFolderScanNative
 * に渡す
 */
export function createFolderScanId(): string {
  return crypto.randomUUID();
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
 *
 * 数十万件のフォルダを選ぶ利用者もいるため、走査中は "intake-scan-progress"
 * イベントで見つかった件数を随時受け取れるようにする。invoke の前に購読して
 * おかないと、走査開始直後に発火したイベントを取りこぼす。
 */
export async function scanFolderNative(
  root: string,
  opts: NativeScanOptions,
): Promise<NativeScanOutcome> {
  const { scanId } = opts;
  const unlisten = await listen<{ scanId: string; found: number; folders: number }>(
    "intake-scan-progress",
    (event) => {
      // 別インスタンスが並行して走らせている走査のイベントは無視する
      if (event.payload.scanId !== scanId) return;
      opts.onProgress?.({ found: event.payload.found, folders: event.payload.folders });
    },
  );
  try {
    const result = await invoke<ScanResult>("scan_directory", { root, scanId });
    return {
      files: result.files.map(toIntakeFile),
      truncated: result.truncated,
      cancelled: result.cancelled,
    };
  } finally {
    // invoke が失敗した場合も含め、購読を必ず解除する
    unlisten();
  }
}

/** 進行中のネイティブ走査に中止を伝える */
export async function cancelFolderScanNative(scanId: string): Promise<void> {
  await invoke("cancel_scan", { scanId });
}

function toIntakeFile(scanned: ScannedFile): IntakeFile {
  // ネイティブ走査では MIME が分からないので拡張子から推定する。
  // classify 側も同じ関数でフォールバックしているので判定結果は揃う
  const type = guessMimeType(scanned.name);
  return {
    path: scanned.relativePath,
    name: scanned.name,
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
