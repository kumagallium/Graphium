// 共有エントリの引用リンク（…#shared/<uuid>）のコピー文字列生成と、
// 単体ペースト時の引用カード変換。
//
// ノートリンク（#note/<id> → @メンション）と同じ流儀の「リンクの Copy」導線:
// Library でエントリの引用リンクをコピーし、ノートにペーストすると
// sharedCitation ブロックとして挿入される。挿入先を選んでから貼れるので、
// 排他全画面の Library に挿入ボタンを置けない問題（挿入先が見えない）を迂回できる。
//
// ノートリンクとの違い: エントリの読み出しが非同期（Tauri invoke）なので、
// paste イベントでは preventDefault だけ同期で行い、挿入は読み出し完了後に行う。
// 読めなかった場合（エントリ削除・root 不通など）はリンク文字列をそのまま
// テキストとして挿入するフォールバックに落とす（黙って何も起きないのを避ける）。

import { isTauri } from "../../lib/platform";
import { getSharedRoot } from "../../lib/storage/shared/config";
import { LocalFolderSharedProvider } from "../../lib/storage/shared";
import { matchSharedCitationLink } from "../../features/sharing/citation-link";
import { insertSharedCitations } from "./index";

/**
 * 単一トークンの共有エントリリンクを引用カードに変換する。
 * 処理を引き受けた場合 true を返す（呼び出し元の pasteListener で return する）。
 * tryConvertNoteLinkPaste と同じ二重登録ガード作法。
 */
export function tryConvertSharedCitationPaste(
  e: ClipboardEvent,
  pastedText: string,
  getEditor: () => any,
): boolean {
  const sharedId = matchSharedCitationLink(pastedText);
  if (!sharedId) return false;
  // Web 版 / shared root 未設定では解決できないので通常ペーストに任せる
  if (!isTauri()) return false;
  const root = getSharedRoot();
  if (!root) return false;

  const flagged = e as unknown as { __ghSharedCitationHandled?: boolean };
  if (flagged.__ghSharedCitationHandled) return true;
  flagged.__ghSharedCitationHandled = true;
  e.preventDefault();
  e.stopImmediatePropagation();

  void (async () => {
    const editor = getEditor();
    if (!editor) return;
    try {
      const provider = new LocalFolderSharedProvider(root);
      const { entry } = await provider.read(sharedId);
      // tombstone を貼っても「Not found」カードにしかならないので、
      // リンク文字列のフォールバックに落として気づけるようにする
      if (entry.status === "unshared") throw new Error("entry is unshared");
      insertSharedCitations(editor, [entry]);
    } catch {
      editor.insertInlineContent?.(pastedText);
    }
  })();
  return true;
}
