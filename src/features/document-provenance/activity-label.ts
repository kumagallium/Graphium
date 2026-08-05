// EditActivityType → 表示ラベルの i18n キー
// 履歴パネル（DocumentProvenancePanel）と lineage / グラフの成長サマリで共用する。
// 未知の型は null を返し、呼び出し側が生文字列でフォールバックする
// （旧ビルド互換と同じ振る舞い）。

export function activityTypeLabelKey(type: string): string | null {
  switch (type) {
    case "human_edit": return "history.type.edit";
    case "human_derivation": return "history.type.derive";
    case "ai_generation": return "history.type.aiGen";
    case "ai_derivation": return "history.type.aiDerive";
    case "template_create": return "history.type.template";
    case "derive_source": return "history.type.deriveSource";
    case "wiki_ingest": return "history.type.wikiIngest";
    case "wiki_merge": return "history.type.wikiMerge";
    case "wiki_cross_update": return "history.type.wikiCrossUpdate";
    case "wiki_dedup_merge": return "history.type.wikiDedupMerge";
    case "wiki_regenerate": return "history.type.wikiRegenerate";
    case "wiki_atomize": return "history.type.wikiAtomize";
    case "wiki_reinforce": return "history.type.wikiReinforce";
    case "skill_default_update": return "history.type.skillDefaultUpdate";
    case "snapshot_restore": return "history.type.snapshotRestore";
    default: return null;
  }
}
