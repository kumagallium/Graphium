// @メンションのクリック解決を、そのブロックに保存済みの reference リンクから行う。
//
// なぜ必要か:
//   従来のクリック解決はメンションの表示テキスト（タイトル）を noteIndex 全体から
//   逆引きしていた。そのため同名ノートが複数あると常に「先頭の1件」に解決され、
//   2件目以降のノートを開けなかった。
//
//   メンション挿入時には linkStore に reference リンク（sourceBlockId + targetNoteId）が
//   既に保存されており、これは note JSON の knowledgeLinks として永続化・復元される。
//   よってクリックされたブロックの reference リンクを引けば、タイトルに依存せず
//   targetNoteId で一意に解決できる（＝同名ノートでも正しいノートを開ける）。
//
// 後方互換:
//   reference リンクが無い（この機能以前の）メンションや、アセット引用など
//   note reference を持たないメンションは、ここで null を返し呼び出し側の
//   従来のタイトル逆引き経路にフォールバックさせる。
//
// なぜタイトル照合も併用するか:
//   1 ブロックに複数のメンション（例: あるノート参照 ＋ アセット引用）が同居しうる。
//   ブロック単位でしかリンクを引けないため、クリックされたテキストとリンク先タイトルを
//   突き合わせて「今クリックしたのがどのメンションか」を絞り込む。テキストが
//   どのリンク先タイトルとも一致しない場合（アセット等）は null を返して委譲する。

import type { BlockLink } from "./link-types";

export type MentionResolution = { noteId: string; isWiki: boolean };

/** リンク先ノートのタイトルと種別（Wiki/AI か否か）を返す解決関数 */
export type NoteInfoResolver = (
  noteId: string,
) => { title: string; isWiki: boolean } | null;

/**
 * メニュー表示ラベルとノート実タイトルを比較可能な形に正規化する。
 *   - Wiki は "🤖 Summary: <title>" / "🤖 Concept: <title>"、素材は "📄 <name>" のように
 *     装飾プレフィックスが付くため、それらを剥がして実タイトルに寄せる。
 */
function normalizeTitle(s: string): string {
  return s
    .replace(/^(🤖|📄)\s*/, "")
    .replace(/^(Summary|Concept):\s*/i, "")
    .trim();
}

/**
 * クリックされた @メンションを、ブロックの reference リンクから解決する。
 *
 * @param refLinks    対象ブロックの reference リンク（呼び出し側で sourceBlockId 済みフィルタ）
 * @param clickedText メンションの表示テキスト（先頭 "@" を除いたもの）
 * @param getNote     targetNoteId からタイトル・Wiki 種別を引く関数（noteIndex/files 参照）
 * @returns 解決できたら {noteId, isWiki}、できなければ null（＝タイトル逆引きへ委譲）
 */
export function resolveMentionFromLinks(
  refLinks: BlockLink[],
  clickedText: string,
  getNote: NoteInfoResolver,
): MentionResolution | null {
  const target = normalizeTitle(clickedText);
  if (!target) return null;

  for (const link of refLinks) {
    if (link.type !== "reference" || !link.targetNoteId) continue;
    const info = getNote(link.targetNoteId);
    if (info && normalizeTitle(info.title) === target) {
      return { noteId: link.targetNoteId, isWiki: info.isWiki };
    }
  }
  return null;
}
