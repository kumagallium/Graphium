// 投入口（既存資料の一括持ち込み）の共通型
//
// フォルダ選択・複数ファイル選択・ドロップの 3 経路すべてが、この形に揃えてから
// 分類・実行の各処理に渡す。path はフォルダ構造の復元（将来のノートの入れ子等）に
// 使えるよう、フォルダ内の相対パスを "/" 区切り・先頭スラッシュ無しで持つ。

/**
 * 投入口に渡す 1 ファイル。path はフォルダ内の相対パス（"/" 区切り・先頭スラッシュ無し）。
 * 単体選択なら name と同じ。
 *
 * ファイル実体（File）は即座には持たず、getFile() で遅延取得する形にしてある。
 * DOM 経路（input/drop）では既に読み込み済みの File を包むだけだが、将来の
 * Tauri ネイティブ走査ではパスだけを先に集め、処理する瞬間に初めて読むことになる
 * ため、この形に揃えておく。
 */
export type IntakeFile = {
  /** 取り込み元のルートからの相対パス（フォルダ引き継ぎの判定に使う） */
  path: string;
  name: string;
  /** MIME。ネイティブ走査では空文字になることがあるので、利用側は拡張子推定にフォールバックすること */
  type: string;
  /** 実体を取り出す。ネイティブ走査ではこれが呼ばれた瞬間に初めてファイルを読む */
  getFile: () => Promise<File>;
};

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
    return {
      path: relativePath && relativePath.length > 0 ? relativePath : file.name,
      name: file.name,
      type: file.type,
      // DOM 経路では既に読み込み済みの File を包むだけ。同じ File を
      // 何度返しても再読み込みは起きないので、そのまま毎回同じ参照を返す
      getFile: async () => file,
    };
  });
}
