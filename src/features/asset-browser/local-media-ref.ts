// メディア参照が「手元にある実体を指しているか」の判定（唯一の許可リスト）
//
// 判定は許可リスト（deny by default）で行う。「http(s) だけ弾く」にすると
// `//host/x.png`（プロトコル相対）や `x.png`（相対パス）がページ基準で解決されて
// そのまま外へ出る。ここに載っていない形は全部「外部」に倒す。
//
// 元は prov-generator/view.tsx の LOCAL_THUMB_PREFIXES / isLocalThumbRef として
// Cytoscape のサムネイル専用に書かれていたもの。ノート本文のメディアブロックでも
// 同じ判定が要るようになったので共有モジュールへ移し、許可リストが 2 本に
// 分かれるのを避ける。

import { isLocalPreviewRef } from "./media-index";

/**
 * ネットワークへ出ない参照の接頭辞。
 *
 * - `file-media://` … filesystem プロバイダ（Tauri）
 * - `local-media://` … local プロバイダ（IndexedDB）
 * - `media-server://` … server-fs プロバイダ（同一オリジンの sidecar）
 * - `media://` … 現行コードに書き込み経路は無い汎用スキーム（media-index のテスト
 *   fixture に残っている形）。他と同じくネットワークには出ないので通す
 * - `shared-blob:` … 共有ノートの blob 参照（features/sharing/auto-blob.ts）。
 *   fork 時に実体化されるが、実体化に失敗したままのノートも開ける。実体化前でも
 *   ブラウザが解決できないスキームなので、外へは出ない
 * - `blob:` / `data:image/` `data:video/` `data:audio/` … すでに手元に実体がある。
 *   `data:image/svg+xml` は `<img>` 経由だと外部リソースを読まない扱いになる
 *
 * `media-text:<key>`（preview-image.ts のローカルキャッシュ）は形式検証が要るので
 * 接頭辞では見ず、isLocalPreviewRef に委ねる。
 */
export const LOCAL_MEDIA_PREFIXES = [
  "file-media://",
  "local-media://",
  "media-server://",
  "media://",
  "shared-blob:",
  "blob:",
  "data:image/",
  "data:video/",
  "data:audio/",
] as const;

/**
 * 描画・OCR・PDF 書き出しに載せてよいローカル参照か。http(s) はホストを問わず false。
 *
 * 前後の空白を落としてから見るのは、`<img src=" https://…">` も `new URL()` も
 * 空白を無視して同じ URL として解決するため。スキーム部分は大文字小文字を区別しない
 * ので、接頭辞の比較は小文字に落として行う（許可リストに載るのはいずれも
 * ネットワークへ出ないスキームなので、緩めても外部参照は通らない）。
 */
export function isLocalMediaRef(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  if (LOCAL_MEDIA_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return true;
  // preview-image.ts がローカルキャッシュに書く `media-text:<key>` 形式
  return isLocalPreviewRef(trimmed);
}

/**
 * 外部ホストを指す参照か（= isLocalMediaRef の否定。空文字は「参照が無い」ので false）。
 * 「URL は入っているが手元に実体が無い」を判定したい呼び出し側のための別名。
 */
export function isRemoteMediaRef(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return !isLocalMediaRef(value);
}

/**
 * 外部参照の「どこから読むのか」だけを人に見せるための表示用ホスト名。
 *
 * パス・クエリは出さない。計測用のトークンはパスやクエリに載っていることが多く、
 * プレースホルダにそのまま出すと画面共有やスクリーンショットで一緒に出てしまう。
 * URL として解釈できない文字列は空文字を返す（呼び出し側はホスト行を出さない）。
 */
export function remoteRefHost(value: string): string {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return "";
  }
}
