// ノートの noteLinks（ノート → ノートの線）の読み分け。
//
// noteLinks には 2 種類の線が同じ形（type: "derived_from"）で入っている:
//   - 派生: 「派生」ボタン・表の行から作ったノート・スラッシュの「新しいノート」・
//     音声ノートの議事録など、このノートを元に**新しく作った**ノートへの線。
//     作られた側は必ず derivedFromNoteId にこのノートを持つ
//   - つながり: 本文の @（ノートへのメンション）・リンクの貼り付け・表の行に既存の
//     ノートを紐付けたもの。後から書いたノートが前のノートを引くこともあるので、
//     **向きを持たない**（どちらが元かは本文を読まないと分からない）
// 保存されたデータは書き換えず、読むときに相手の derivedFromNoteId で見分ける。
// 古いデータも同じ規則で読める（派生で作った経路はどれも相手に derivedFromNoteId を書く）。

/** noteLinks の線の種類 */
export type NoteLinkKind = "derivation" | "connection";

/**
 * ownerNoteId の noteLinks にある線が、相手（その derivedFromNoteId）から見て
 * 派生（親 → 子）か、向きの無いつながりかを返す。
 * targetDerivedFromNoteId には相手ノートの derivedFromNoteId を渡す（読めなければ undefined）。
 */
export function noteLinkKind(
  ownerNoteId: string,
  targetDerivedFromNoteId: string | undefined | null,
): NoteLinkKind {
  return targetDerivedFromNoteId === ownerNoteId ? "derivation" : "connection";
}
