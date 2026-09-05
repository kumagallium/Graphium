// 投入口（既存資料の一括持ち込み）の共通型
//
// フォルダ選択・複数ファイル選択・ドロップの 3 経路すべてが、この形に揃えてから
// 分類・実行の各処理に渡す。path はフォルダ構造の復元（将来のノートの入れ子等）に
// 使えるよう、フォルダ内の相対パスを "/" 区切り・先頭スラッシュ無しで持つ。

/** 投入口に渡す 1 ファイル。path はフォルダ内の相対パス（"/" 区切り・先頭スラッシュ無し）。単体選択なら file.name と同じ */
export type IntakeFile = { file: File; path: string };

/** ファイルがどの経路で渡されたか */
export type IntakeSource = "folder" | "files" | "drop";

/**
 * `<input webkitdirectory>` や `<input multiple>` から来た FileList/File[] を
 * IntakeFile[] に変換する。webkitRelativePath があればそれを path にする
 * （フォルダ選択時にブラウザが付与する）。無ければ file.name を単体ファイルの
 * path として使う。
 */
export function toIntakeFiles(files: FileList | File[]): IntakeFile[] {
  return Array.from(files).map((file) => {
    // webkitRelativePath は型定義に存在しないため any 経由で読む
    const relativePath = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    return { file, path: relativePath && relativePath.length > 0 ? relativePath : file.name };
  });
}
