// 投入口のフォルダ引き継ぎ（純関数）
//
// 「フォルダの中の並びは、そのままフォルダになります」という 1 文の規則を実装する。
// - 落としたフォルダ自身の名前は付けない。全ファイルの path 先頭セグメントが揃っている
//   ときだけ、それを「共通の根」として外す（フォルダを 2 つ同時に落とした等、根が
//   複数あるときは外さず、それぞれのフォルダ名がそのまま親フォルダになる）
// - 根を外した後の「ファイル名を除いた残り」を Graphium のフォルダ（noteContexts の
//   "親/子" 文字列）にする。空なら未分類（フォルダを付けない）
// - 深さは切らない。"a/b/c" はそのまま文字列で入れる
//   （folder-tree-model.ts が最初の "/" だけで 2 段の木として見せるので壊れない）

import type { IntakeFile } from "./types";

/**
 * 落としたファイル群に共通の根（path 先頭セグメント）があればそれを返す。
 * 単体ファイル（path に "/" が無い）が 1 件でも混ざる、または先頭セグメントが
 * 揃わない場合は null（根なし＝各ファイルの先頭セグメントをそのままフォルダ名にする）
 */
export function commonRootOf(files: IntakeFile[]): string | null {
  let root: string | null = null;
  for (const f of files) {
    const i = f.path.indexOf("/");
    if (i < 0) return null;
    const segment = f.path.slice(0, i);
    if (root === null) {
      root = segment;
    } else if (root !== segment) {
      return null;
    }
  }
  return root;
}

/**
 * path から Graphium のフォルダ（"親/子..." 文字列）を出す。
 * root（commonRootOf の結果）を先頭から外し、残りからファイル名を除いた部分を返す。
 * 残りが空（ファイルがフォルダ直下にある）なら undefined（未分類）
 */
export function folderOf(path: string, root: string | null): string | undefined {
  let rest = path;
  if (root !== null) {
    const prefix = `${root}/`;
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
    }
  }
  const segments = rest.split("/");
  segments.pop(); // ファイル名を除く
  const folder = segments.join("/").trim();
  return folder.length > 0 ? folder : undefined;
}
