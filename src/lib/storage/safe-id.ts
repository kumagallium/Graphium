// ノート id・素材 id・ファイル名として、ディスクのパスに組み込んでよい形か。
//
// 他人から受け取ったノート（インポート・共有フォルダ・フォーク・テンプレート）は、
// `file-media://../../x` や `file-media://\\host\share\x`、細工した @メンションのリンク先を
// 含みうる。そのまま Rust の読み書きコマンドへ渡すと、データフォルダの外のファイルを読む・
// Windows が SMB 認証を相手へ送る、といったことが起きる。パスの 1 要素に使う文字列は
// ここを通してから渡す。Rust 側の validate_id_component（src-tauri/src/lib.rs）と同じ規則。
//
// 実際に生成される id（UUID・ハイフン・下線・`<id>.<拡張子>`）はすべて通る。

/** 区切り文字・`..`・先頭の `.`・`:`・制御文字（NUL を含む）・空は断る */
export function isSafeStorageId(id: string): boolean {
  if (id === "") return false;
  if (/[/\\:]/.test(id)) return false;
  if (id.includes("..") || id.startsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(id)) return false;
  return true;
}
