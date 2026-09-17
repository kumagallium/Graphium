// 出典照合 — トピックが引く知見を「出典」として扱うための ID。
//
// derivedFromNotes の出典 ID（プレフィックス無しのノート / "pdf:" / "url:" など）と
// 同じ並びで計画・実行に流すため、知見 ID に "claim:" を付けて区別する。
// この ID は出典照合の中だけで使い、保存しない。network-graph/external-source.ts の
// プレフィックス一覧（derivedFromNotes に実際に入る ID の正本）には足さない
// — 足すと来歴グラフや PROV 書き出しなど、この ID を想定していない読み手の挙動が変わる。

const CLAIM_SOURCE_PREFIX = "claim:";

export function toClaimSourceId(claimId: string): string {
  return `${CLAIM_SOURCE_PREFIX}${claimId}`;
}

/** "claim:<id>" なら知見 ID を返す。それ以外は null */
export function parseClaimSourceId(sourceId: string): string | null {
  return sourceId.startsWith(CLAIM_SOURCE_PREFIX) ? sourceId.slice(CLAIM_SOURCE_PREFIX.length) : null;
}
