// 出典照合の「要確認」判定・一覧構築（純関数）。
//
// AI の判定で知見を一覧から自動的に隠さない方針（FAQ「隠れフィルターは無い」の約束）の裏返しとして、
// 「要確認」は一覧を隠すのではなく、常設の別リストとして目立たせる方式にする。
// 対象は kind が claim / topic のみ。verdict が contradicted（出典と異なる）または
// not-in-source（出典に見当たらない）で、かつユーザーが dismiss（確認した）していないもの。
//
// 呼び出し元は fm.wikiFiles（アーカイブ・ゴミ箱を除外済みの一覧）を渡すことを前提にする
// （ここでは archivedAt / deletedAt は判定しない）。
//
// 一覧のために対象ドキュメントを全件読み込むのは重いため、WikiMetaSummary.sourceCheckVerdict
// （一覧向けミラー）だけで判定する。ミラーには checkedAt が無いため、同じ判定内の並びは
// 照合時刻ではなくタイトル順にする（無い情報のために INDEX_SCHEMA_VERSION は上げない）。

import type { SourceCheckVerdict, WikiMetaSummary } from "../../lib/document-types";

/** 要確認とみなす verdict。注意が要る順（並び順の優先度そのもの）。 */
export const NEEDS_REVIEW_VERDICT_ORDER: readonly SourceCheckVerdict[] = ["contradicted", "not-in-source"];

export type NeedsReviewVerdict = "contradicted" | "not-in-source";

/** WikiMetaSummary.sourceCheckVerdict と同じ形（呼び出し側で個別に構築する場合にも使えるよう export） */
export type SourceCheckVerdictMirror = { verdict: SourceCheckVerdict; dismissed?: boolean; claimHash: string };

/** wikiMeta.sourceCheckVerdict（一覧向けミラー）が「要確認」に該当するか */
export function isNeedsReviewVerdict(mirror: SourceCheckVerdictMirror | undefined): boolean {
  if (!mirror || mirror.dismissed) return false;
  return (NEEDS_REVIEW_VERDICT_ORDER as SourceCheckVerdict[]).includes(mirror.verdict);
}

export type NeedsReviewEntry = {
  id: string;
  title: string;
  kind: "claim" | "topic";
  verdict: NeedsReviewVerdict;
};

/**
 * 「要確認」一覧を作る。並びは contradicted → not-in-source、同じ判定内はタイトル順。
 * wikiFiles はアーカイブ・ゴミ箱を除外済みの一覧（fm.wikiFiles）を渡すこと。
 */
export function buildNeedsReviewList(
  wikiFiles: { id: string }[],
  wikiMetas: Map<string, WikiMetaSummary>,
): NeedsReviewEntry[] {
  const entries: NeedsReviewEntry[] = [];
  for (const f of wikiFiles) {
    const meta = wikiMetas.get(f.id);
    if (!meta) continue;
    if (meta.kind !== "claim" && meta.kind !== "topic") continue;
    const mirror = meta.sourceCheckVerdict;
    if (!isNeedsReviewVerdict(mirror)) continue;
    entries.push({
      id: f.id,
      title: meta.title,
      kind: meta.kind,
      verdict: mirror!.verdict as NeedsReviewVerdict,
    });
  }
  entries.sort((a, b) => {
    const rankDiff =
      NEEDS_REVIEW_VERDICT_ORDER.indexOf(a.verdict) - NEEDS_REVIEW_VERDICT_ORDER.indexOf(b.verdict);
    if (rankDiff !== 0) return rankDiff;
    return a.title.localeCompare(b.title, "ja");
  });
  return entries;
}
