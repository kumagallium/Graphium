// 出典照合（Source check, v1） — wikiMeta.sourceCheck への唯一の書き込み口。
//
// 世界照合の attachValidity（src/features/world-grounding/index.ts）と同じ流儀:
// 既存 wikiMeta を spread してから sourceCheck だけ差し替える。他フィールド
// （grounding / epistemicStatus / status / title / 本文など）には一切触れない。
//
// profile が undefined のときは sourceCheck を明示的に削除する（attachValidity の
// validity 削除と同じ挙動）。

import type { GraphiumDocument, SourceCheckProfile } from "../../lib/document-types";

/**
 * WikiMeta.sourceCheck を更新した新しい GraphiumDocument を返す（純関数）。
 * doc.wikiMeta が無いドキュメント（Wiki ページでない）には何もしない。
 */
export function attachSourceCheck(
  doc: GraphiumDocument,
  profile: SourceCheckProfile | undefined,
): GraphiumDocument {
  const meta = doc.wikiMeta;
  if (!meta) return doc;
  if (profile === undefined) {
    if (meta.sourceCheck === undefined) return doc;
    const { sourceCheck: _omit, ...rest } = meta;
    return { ...doc, wikiMeta: rest };
  }
  return { ...doc, wikiMeta: { ...meta, sourceCheck: profile } };
}
