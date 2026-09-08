// ──────────────────────────────────────────────
// 自動レイアウト（ELK）の「要求」を保つ判定
//
// 手順フロービューは、全ノードの実測サイズが揃ってから ELK を流す。実測が
// 揃うまでには数フレームかかるので、「並べ直したい」という要求は、実際に
// 適用されるまで持ち越さなければならない。
//
// 以前は nodes/edges 同期 effect が走り直すたびに「形が変わっていないから
// 並べ直す理由が無い」と要求を取り消していた。ところが effect はコールバック
// の参照が変わっただけでも走る（親が毎レンダー新しい関数を渡す経路がある）。
// 実測待ちの最中にそれが起きると、まだ一度も適用できていない要求が消え、
// 以後は誰も再試行しないのでノードが (0,0) に重なったまま固定された。
//
// 要求は「まだ ELK を適用できていない」ことを表す。適用・ドラッグ・手動配置の
// 採用でだけ下ろす。形が同じというだけでは下ろさない。
// ──────────────────────────────────────────────

export type LayoutRequestInput = {
  /** まだ ELK を適用できていない要求が残っているか */
  pending: boolean;
  /** 手で整えた並び（保存済み配置）を使っている */
  usingSavedLayout: boolean;
  /** グラフの形（ノード集合とエッジ）が前回と変わった */
  structureChanged: boolean;
};

/**
 * nodes/edges 同期のあとに残すべきレイアウト要求を返す。
 *
 * - 手動配置を使っているなら流さない（#774 の不変条件）
 * - 形が変わったなら新しく要求する
 * - どちらでもないなら、実測待ちの要求をそのまま持ち越す
 */
export function nextLayoutRequest({
  pending,
  usingSavedLayout,
  structureChanged,
}: LayoutRequestInput): boolean {
  if (usingSavedLayout) return false;
  if (structureChanged) return true;
  return pending;
}
