// PROV-JSON-LD エクスポートのスコープ判定。
//
// エクスポートは「開いているノート単位」の操作（ノートの ⋯ メニュー内）なので、
// 含める Knowledge Layer も「そのノートから直接抽出された知識」に揃える。
//
// 直接抽出 = wiki ノートの `derivedFromNotes` に開いているノートの ID が入っている、
// と定義する。Insights / Ideas は複数ノート横断の抽象（context-stripped、上流は
// `derivedFromClaims` 経由）なので、単一ノートのエクスポートには含めない。含めると
// 同じ Insight が派生元の各ノートのエクスポートに重複して現れ、ノート単位の意味が崩れる。
//
// ワークスペース全体の来歴をまとめて出したい場合は、ノート単位ではなく別途
// 全体エクスポートとして扱うべき（本関数のスコープ外）。

export type WikiScopeCandidate = {
  /** wiki ノートの ID */
  id: string;
  /** この wiki が派生した通常ノートの ID 配列（wikiMeta.derivedFromNotes 相当）。 */
  derivedFromNotes: string[];
};

/**
 * 開いているノート `rootNoteId` から直接抽出された Knowledge の ID 集合を返す。
 *
 * - `derivedFromNotes` に `rootNoteId` を含む wiki を対象にする。
 * - `rootNoteId` 自身が wiki ノート（Claim を開いてエクスポート等）の場合はそれも含める。
 * - `rootNoteId` が null（開いているノートが特定できない）の場合は、後方互換として
 *   全候補を返す（スコープ不明時にエクスポートが空になる事故を避ける）。
 */
export function selectNoteScopedWikiIds(
  rootNoteId: string | null,
  candidates: WikiScopeCandidate[],
): Set<string> {
  if (!rootNoteId) return new Set(candidates.map((c) => c.id));
  const scoped = new Set<string>();
  for (const c of candidates) {
    if (c.id === rootNoteId || c.derivedFromNotes.includes(rootNoteId)) {
      scoped.add(c.id);
    }
  }
  return scoped;
}
