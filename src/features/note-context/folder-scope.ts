// フォルダで「AI が探す範囲」を絞るための集合計算。
//
// チャットの渡す範囲（standalone chat）と MCP の search_notes / list_topics が同じ規則で
// 絞れるよう、ブラウザにも Node にも依存しない純関数としてここに 1 本だけ置く。
//
// 範囲に入るもの:
//   1. フォルダ（または、その子フォルダ）に入っている生きているノート
//      — 判定はサイドバーと同じ「小文字比較で自身か "親/子" の子」
//   2. 1 から派生したナレッジ（知見・トピック・洞察・回答など）
//      — derivedFromNotes / derivedFromClaims を不動点までたどる。
//        フォルダ外のノートと一緒に派生したものも含める（外すとトピックが半分欠けて見えるため）
//
// 範囲に入らないもの: フォルダ外のノート、素材（URL・PDF などはフォルダを持たない）、
// ゴミ箱・アーカイブ。ナレッジ自身の noteContexts は見ない（フォルダツリーも数えないため）。

/** 集合計算に要る索引エントリの最小の形（NoteIndexEntry の部分集合） */
export type FolderScopeEntry = {
  noteId: string;
  noteContexts?: string[];
  source?: string;
  wikiKind?: unknown;
  derivedFromNotes?: string[];
  derivedFromClaims?: string[];
  deletedAt?: string;
  archivedAt?: string;
};

/**
 * フォルダ指定を比較用に揃える。前後の空白と "/" の周りの空白、末尾の "/" を落とす。
 * 空になったら undefined（＝絞らない）。
 */
export function normalizeFolderScope(folder: string | undefined | null): string | undefined {
  if (typeof folder !== "string") return undefined;
  const segments = folder
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments.join("/") : undefined;
}

/** noteContexts の値 candidate が、フォルダ folder 自身かその子にあたるか（小文字比較） */
export function isInFolder(candidate: string, folder: string): boolean {
  const key = candidate.trim().toLowerCase();
  const target = folder.trim().toLowerCase();
  return key === target || key.startsWith(`${target}/`);
}

/**
 * フォルダ範囲に入る noteId の集合を返す（ノート＋そこから派生したナレッジ）。
 * folder が空なら null（＝絞らない）。
 */
export function collectFolderScopeIds(
  entries: readonly FolderScopeEntry[],
  folder: string | undefined | null,
): Set<string> | null {
  const target = normalizeFolderScope(folder);
  if (!target) return null;

  const live = entries.filter((e) => !e.deletedAt && !e.archivedAt);
  const ids = new Set<string>();
  for (const e of live) {
    if (e.wikiKind || e.source === "ai") continue;
    if (e.noteContexts?.some((c) => isInFolder(c, target))) ids.add(e.noteId);
  }
  if (ids.size === 0) return ids;

  // 知見 → トピック → 洞察…と段を重ねて派生するので、増えなくなるまで繰り返す
  const wiki = live.filter((e) => e.wikiKind || e.source === "ai");
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of wiki) {
      if (ids.has(e.noteId)) continue;
      const from = [...(e.derivedFromNotes ?? []), ...(e.derivedFromClaims ?? [])];
      if (from.some((id) => ids.has(id))) {
        ids.add(e.noteId);
        grew = true;
      }
    }
  }
  return ids;
}
