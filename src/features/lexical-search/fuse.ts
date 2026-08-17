// Reciprocal Rank Fusion（RRF）
//
// 埋め込み（cosine）と BM25 はスコアの尺度が違うので、値を足しても意味が無い。
// RRF は各リストでの「順位」だけを使って 1 / (k + rank) を合算する。尺度非依存で、
// どちらか一方にしか無い候補も自然に残る（片方が使えないときはそのリストが空に
// なるだけで、もう片方の順位がそのまま出る）。k=60 は原論文の慣用値。

export type RankedItem = { id: string; score: number };

export type FusedItem = {
  id: string;
  /** RRF スコア（大きいほど上位） */
  score: number;
  /** どのリストで何位だったか（0 始まり）。デバッグ・表示用 */
  ranks: Record<string, number>;
};

/**
 * 複数の順位付きリストを RRF で 1 本にする。
 * @param lists  名前付きリスト（`{ name, items }`）。items は各リスト内で降順（上位が先）
 * @param k      RRF の定数（既定 60）
 * @param weights リストごとの重み（既定 1）
 */
export function reciprocalRankFusion(
  lists: { name: string; items: RankedItem[] }[],
  k = 60,
  weights: Record<string, number> = {},
): FusedItem[] {
  const acc = new Map<string, FusedItem>();
  for (const { name, items } of lists) {
    const w = weights[name] ?? 1;
    const seen = new Set<string>();
    items.forEach((item, rank) => {
      // 同一リスト内の重複 id は最初の順位だけ数える
      if (seen.has(item.id)) return;
      seen.add(item.id);
      const cur = acc.get(item.id) ?? { id: item.id, score: 0, ranks: {} };
      cur.score += w / (k + rank + 1);
      cur.ranks[name] = rank;
      acc.set(item.id, cur);
    });
  }
  return Array.from(acc.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
