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

/**
 * 編集操作の種別。
 *
 * `wiki_*` は Knowledge Layer の成長操作。以前はすべて `ai_generation` に
 * 潰していたが、それでは PROV 上で「マージ」と「再生成」を区別できず、
 * 知識の成長過程が来歴として残らない。wikiLog（表示用の要約ログ）と
 * 意味論を揃えた専用の型で記録する。
 * 旧ビルドは未知の型をラベル無変換で表示するだけなので互換性は壊れない。
 */
export type EditActivityType =
  | "human_edit"
  | "human_derivation"
  | "ai_generation"
  | "ai_derivation"
  | "template_create"
  | "derive_source"
  /** ソース（ノート / PDF / URL / チャット）からの Wiki 新規生成 */
  | "wiki_ingest"
  /** Ingester の merge 提案による既存 Wiki への統合（rewriteAndMerge） */
  | "wiki_merge"
  /** 新ノート取り込み後の既存 Wiki 横断更新（cross-update） */
  | "wiki_cross_update"
  /** Lint の redundant 検出による重複 Wiki の自動統合 */
  | "wiki_dedup_merge"
  /** 既存 Wiki のソースからの再生成（re-lift / マルチソース regenerate） */
  | "wiki_regenerate"
  /** Claim 群からの構造抽象（Atom / Insight）の生成 */
  | "wiki_atomize";

/** prov:Activity — 編集操作 */
export type EditActivity = {
  id: string;
  type: EditActivityType;
  startedAt: string;
  endedAt: string;
  /** EditAgent ID → prov:wasAssociatedWith */
  wasAssociatedWith: string;
  /**
   * この操作が取り込んだソースの ID → prov:used。
   * ノート ID / Wiki ID / 外部ソース ID（`pdf:` / `url:` / `document:` /
   * `chat:` prefix）が入る。「このリビジョンはどのソースを取り込んで
   * 生まれたか」の因果を残すためのフィールドで、wikiMeta.derivedFromNotes
   * （現在値の集合）と違い操作単位の対応が保たれる。
   */
  used?: string[];
};

/**
 * AuthorIdentity — ユーザーの自己申告 identity（v1）。
 *
 * Graphium は v0.4 で OAuth を撤去しており、改ざん困難な identity を持たない。
 * v1 は self-asserted（name + email のみ）で運用し、データモデルは将来の
 * 暗号署名（Ed25519 keypair）や eureco 連携時の検証済 identity 受け入れを
 * 想定して optional フィールドを並べて拡張可能にしておく。
 *
 * 設計詳細は docs/internal/team-shared-storage-design.md §AuthorIdentity 参照。
 */
export type AuthorIdentity = {
  /** 表示名 */
  name: string;
  /** 連絡先 email（簡易バリデーションのみ） */
  email: string;

  /** Ed25519 公開鍵（v1.5+ オプトイン暗号署名） */
  public_key?: string;
  /** 本エントリの hash に対する署名（v1.5+） */
  signature?: string;

  /** 外部 IdP による検証（v2 マネージド連携） */
  verified_by?: "eureco" | "github" | string;
  /** Provider 内の検証済 ID */
  subject?: string;
};

/** prov:Agent — 編集者 */
export type EditAgent = {
  id: string;
  type: "human" | "ai";
  label: string;
  /** Google アカウントのメールアドレス（人間エージェントの識別用） */
  email?: string;
  /**
   * 自己申告 author identity（Phase 0, team-shared-storage 基盤）。
   * 既存ノートとの互換のため optional。Settings で identity を登録した
   * 後の保存（recordRevision）から埋まる。shared エントリでは将来 hash
   * の入力に含めて改ざん検知に使う想定。
   */
  author?: AuthorIdentity;
};

/** ドキュメント来歴全体 */
export type DocumentProvenance = {
  revisions: RevisionEntity[];
  activities: EditActivity[];
  agents: EditAgent[];
};
