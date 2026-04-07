// ドキュメント来歴（Document Provenance）の型定義
// ノート内容の来歴（Content Provenance）とは別に、
// ドキュメント自体の編集操作を PROV-DM で記録する

/** リビジョンの変更サマリ */
export type RevisionSummary = {
  blocksAdded: number;
  blocksRemoved: number;
  blocksModified: number;
  labelsChanged: string[];
  provLinksAdded: number;
  provLinksRemoved: number;
  knowledgeLinksAdded: number;
  knowledgeLinksRemoved: number;
};

/** prov:Entity — 各保存状態（リビジョン） */
export type RevisionEntity = {
  id: string;
  savedAt: string;
  driveRevisionId?: string;
  summary: RevisionSummary;
  /** 前リビジョン ID → prov:wasDerivedFrom */
  wasDerivedFrom?: string;
  /** EditActivity ID → prov:wasGeneratedBy */
  wasGeneratedBy: string;
};

/** 編集操作の種別 */
export type EditActivityType =
  | "human_edit"
  | "ai_generation"
  | "ai_derivation"
  | "template_create";

/** prov:Activity — 編集操作 */
export type EditActivity = {
  id: string;
  type: EditActivityType;
  startedAt: string;
  endedAt: string;
  /** EditAgent ID → prov:wasAssociatedWith */
  wasAssociatedWith: string;
};

/** prov:Agent — 編集者 */
export type EditAgent = {
  id: string;
  type: "human" | "ai";
  label: string;
};

/** ドキュメント来歴全体 */
export type DocumentProvenance = {
  revisions: RevisionEntity[];
  activities: EditActivity[];
  agents: EditAgent[];
};

/** リビジョン数の上限 */
export const MAX_REVISIONS = 100;
