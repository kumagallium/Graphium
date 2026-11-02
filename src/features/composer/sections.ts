// Cmd+K 用: 結果を段（ノート / ナレッジ / 共有 / 素材）ごとに切る純関数
//
// searchNotes などは大きめの limit で全件に近い数を返し、表示件数はここで切る。
// 切った残りの件数を「さらに N 件を表示」の行に出し、展開するとその段だけ上限が広がる。

/** 段の種類（展開状態のキー） */
export type SectionKey = "notes" | "knowledge" | "shared" | "media";

/** 検索時の既定の表示件数 */
export const SECTION_LIMITS: Record<SectionKey, number> = {
  notes: 8,
  knowledge: 5,
  shared: 4,
  media: 4,
};

/** 入力が空のとき（履歴ビュー）の表示件数。共有・素材は検索時と同じ */
export const RECENT_SECTION_LIMITS: Record<SectionKey, number> = {
  notes: 6,
  knowledge: 3,
  shared: 4,
  media: 4,
};

/** 展開後の上限 */
export const EXPANDED_LIMIT = 50;

/** 各段の検索を呼ぶときの limit（総数を知るため大きめにとり、表示側で切る） */
export const SEARCH_FETCH_LIMIT = 200;

export type SectionSlice<T> = {
  /** 表示する項目 */
  visible: T[];
  /** 「さらに N 件を表示」に出す件数（0 なら行を出さない） */
  more: number;
  /** 上限（EXPANDED_LIMIT）を超えて出せない一致が残っているか */
  hidden: boolean;
};

/**
 * 段の項目を limit 件で切り、残りの件数を返す。
 * more は「展開したとき実際に増える件数」（EXPANDED_LIMIT で頭打ちにした後の差）。
 * expanded のときは上限を EXPANDED_LIMIT に広げ、それを超える分は出さない（more は 0、hidden で知らせる）。
 */
export function sliceSection<T>(items: readonly T[], limit: number, expanded: boolean): SectionSlice<T> {
  const hidden = items.length > EXPANDED_LIMIT;
  if (expanded) return { visible: items.slice(0, Math.max(limit, EXPANDED_LIMIT)), more: 0, hidden };
  if (items.length <= limit) return { visible: [...items], more: 0, hidden: false };
  return {
    visible: items.slice(0, limit),
    more: Math.max(0, Math.min(items.length, EXPANDED_LIMIT) - limit),
    hidden,
  };
}
