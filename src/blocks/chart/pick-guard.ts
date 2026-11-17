// 素材ピッカー確定の「待った後」の確認
//
// 確定後の表の変換は非同期（大きな素材は小分けで変換する）なので、待つ間に
// ブロックが消えた・別の確定が入ることがある。古い結果で設定を上書きしないよう、
// 書く直前にこの関数で確かめる。

/** 待った後も、この確定の結果を設定へ書いてよいか */
export function shouldApplyAssetPick(args: {
  /** このチャートのブロックがまだ文書にあるか */
  blockExists: boolean;
  /** この確定の通し番号 */
  seq: number;
  /** いま有効な（最後の）確定の通し番号 */
  latestSeq: number;
}): boolean {
  return args.blockExists && args.seq === args.latestSeq;
}
