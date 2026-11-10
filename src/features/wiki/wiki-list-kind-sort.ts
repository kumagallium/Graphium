// ナレッジ一覧の「種別」列の並べ替え
//
// 「種別」列のセルは一覧ごとに出しているものが違う（知見 = claimRole（複数）・洞察 = atomType・
// 統合 = synthesisMode・トピック = topicType）。並べ替えでも同じ値を比べないと、表示と並びが
// 食い違う（以前は atomType / synthesisMode しか見ておらず、トピックと知見の一覧では全行が
// 同じ値として扱われて並ばなかった）。
//
// - 比べるのは画面に出ている文言（i18n のラベル）。絞り込みの選択肢と同じ並びになり、
//   読んでいる文字の順で並ぶ（保存値の英語キーで並べると日本語 UI では順不同に見える）
// - 種類が付いていない行（トピックの「未分類」・知見や洞察の「—」）は、昇順でも降順でも最後に置く

export type KindSortEntry = {
  claimRole?: readonly string[];
  atomType?: string;
  synthesisMode?: string;
  topicType?: string;
};

/** セルに出している種類のラベル。種類が無ければ undefined（要約・問答は常に undefined） */
export function kindSortLabel(
  entry: KindSortEntry,
  kind: string,
  t: (key: string) => string,
): string | undefined {
  switch (kind) {
    case "claim": {
      const roles = entry.claimRole ?? [];
      if (roles.length === 0) return undefined;
      // セルと同じ並び（保存順）でつなぐ。先頭の役割が同じなら 2 個目以降で決まる
      return roles.map((r) => t(`wikiTypes.claimRole.${r}`)).join("\u0000");
    }
    case "atom":
      return entry.atomType ? t(`wikiTypes.atomType.${entry.atomType}`) : undefined;
    case "synthesis":
      return entry.synthesisMode ? t(`wikiTypes.synthesisMode.${entry.synthesisMode}`) : undefined;
    case "topic":
      return entry.topicType ? t(`wikiTypes.topicType.${entry.topicType}`) : undefined;
    default:
      return undefined;
  }
}

/**
 * 種別の比較。戻り値は並べ替えの向きを掛けた後の値（そのまま sort に返せる）。
 * 種類の無い行は向きに関係なく最後。
 */
export function compareKindLabels(
  a: string | undefined,
  b: string | undefined,
  dir: "asc" | "desc",
  collation: string,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const cmp = a.localeCompare(b, collation);
  return dir === "desc" ? -cmp : cmp;
}
