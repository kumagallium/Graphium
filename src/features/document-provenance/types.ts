// ドキュメント来歴（Document Provenance）の型定義
// ノート内容の来歴（Content Provenance）とは別に、
// ドキュメント自体の編集操作を PROV-DM で記録する

/** ブロック単位のテキスト差分（監査証跡用） */
export type BlockContentDiff = {
  blockId: string;
  /** "add" = 新規ブロック, "remove" = 削除, "modify" = 変更 */
  type: "add" | "remove" | "modify";
  /** 変更前のテキスト（add の場合は undefined） */
  before?: string;
  /** 変更後のテキスト（remove の場合は undefined） */
  after?: string;
};

/** リビジョンの変更サマリ */
export type RevisionSummary = {
  blocksAdded: number;
  blocksRemoved: number;
  blocksModified: number;
  /** 追加されたブロック ID */
  addedBlockIds?: string[];
  /** 削除されたブロック ID */
  removedBlockIds?: string[];
  /** 変更されたブロック ID */
  modifiedBlockIds?: string[];
  /** ブロック単位のテキスト差分（監査証跡用） */
  contentDiff?: BlockContentDiff[];
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
  /** ページ全体の SHA-256 ハッシュ（改ざん検知用） */
  contentHash: string;
  /** 前リビジョンの contentHash（ハッシュチェーン） */
  prevContentHash?: string;
  /** 前リビジョン ID → prov:wasDerivedFrom */
  wasDerivedFrom?: string;
  /** EditActivity ID → prov:wasGeneratedBy */
  wasGeneratedBy: string;
};

/** 編集操作の種別 */
export type EditActivityType =
  | "human_edit"
  | "human_derivation"
  | "ai_generation"
  | "ai_derivation"
  | "template_create"
  | "derive_source";

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
  /** Google アカウントのメールアドレス（人間エージェントの識別用） */
  email?: string;
};

/** ドキュメント来歴全体 */
export type DocumentProvenance = {
  revisions: RevisionEntity[];
  activities: EditActivity[];
  agents: EditAgent[];
};

/** リビジョン数の上限 */
export const MAX_REVISIONS = 100;
