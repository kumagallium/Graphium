// Graphium ドキュメントのドメイン型定義
// ストレージプロバイダーに依存しない、アプリケーション固有の型

import type { DocumentProvenance } from "../features/document-provenance/types";

// AI Wiki ドキュメントの種類
// summary  : 1 ノートに対する内部向け要約
// concept  : 複数ノート横断の整理（実施文脈をある程度残す）
// atom     : 実験的レイヤ。Concept をさらに抽象化し、文脈を削いだ単一アイデア（Zettel atom）
// synthesis: 実験的レイヤ。Atom 同士の結合から立ち上がる新しい洞察
//
// experimental.atomLayer / experimental.synthesis 設定で生成可否を制御する。
// 既存ユーザーの synthesis ファイルは削除しないため、atom 同様に kind 文字列としては常に有効。
export type WikiKind = "summary" | "concept" | "atom" | "synthesis";

// Concept の抽象度レベル（concept のみで意味を持つ）
// principle: ノートが推論ステップで依拠した一般原理（教科書知識でも、本人の研究で実際に使われたもの）
// finding: 本人の経験から立ち上がった転用可能な命題
// bridge: 複数の finding を貫く抽象（後段の cross-update で生成）
export type ConceptLevel = "principle" | "finding" | "bridge";

// Concept の確度ステータス（principle で主に意味を持つ）
// candidate: 1 ノートのみで依拠されている。検索・retrieval 母集団には含むが UI では薄表示
// verified: 2 ノート以上で依拠された。「自分の研究で繰り返し効いている原理」
export type ConceptStatus = "candidate" | "verified";

// Skill（プロンプトテンプレート）のメタデータ
export type SkillMeta = {
  /** スキルの説明（一行） */
  description: string;
  /** Ingest 時に自動適用するか */
  availableForIngest: boolean;
  /** 作成日時 */
  createdAt: string;
  /**
   * システム同梱スキルの識別子（例: "default-voice-ja"）。
   * 設定されている場合、このスキルは削除不可・常に存在し、デフォルト内容にリセット可能。
   */
  systemSkillId?: string;
  /**
   * 適用対象の言語。"ja" | "en" を指定すると、生成側の言語と一致するときだけプロンプトに注入される。
   * 未指定の場合は全言語に適用（既存スキルとの後方互換）。
   */
  language?: "ja" | "en";
};

// AI Wiki ドキュメントのメタデータ
export type WikiMeta = {
  kind: WikiKind;
  /** 生成元ノート ID リスト */
  derivedFromNotes: string[];
  /** 生成元チャットセッション ID リスト */
  derivedFromChats: string[];
  /** ISO 8601 生成日時 */
  generatedAt: string;
  /** 生成に使用した LLM */
  generatedBy: {
    model: string;
    version: string;
  };
  /** 最後に Ingest を実行した日時 */
  lastIngestedAt?: string;
  /** Ingest 時に使用した Skill 名 */
  skillsUsed?: string[];
  /** 人間が編集したセクションの blockId リスト（Ingest 時の上書き保護用） */
  editedSections?: string[];
  /** セクション単位の embedding メタデータ */
  sectionEmbeddings?: {
    sectionId: string;
    modelVersion: string;
  }[];
  /** Wiki の生成言語 */
  language?: string;
  /** Concept の抽象度レベル（concept のみ） */
  level?: ConceptLevel;
  /** Concept の確度ステータス（principle で主に意味を持つ） */
  status?: ConceptStatus;
  /** principle が依拠していると判定された、ソースノート内の該当文（生成時の自己検証用） */
  evidenceSpan?: string;
  /** Atom が抽象化した元 Concept の ID リスト（atom のみ） */
  derivedFromConcepts?: string[];
  /** 生成時の自己評価された確度（0.0〜1.0）。主に Synthesis で誤差伝搬の指標として表示する */
  confidence?: number;
};

/**
 * 一覧 UI と Snapshot ビルダーが共通で使う wiki メタの軽量サマリ。
 * doc 全体ではなく頻繁にアクセスする最小限のフィールドだけを保持する。
 */
export type WikiMetaSummary = {
  title: string;
  kind: WikiKind;
  /** 書記役 LLM のモデル ID (例: claude-opus-4-7) */
  model?: string;
  /** Concept のときのみ意味を持つ抽象度レベル */
  level?: ConceptLevel;
  /** principle のときのみ意味を持つ確度ステータス */
  status?: ConceptStatus;
};

// Graphium ファイルのメタデータ
export type GraphiumFile = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

// ノート間リンク（派生関係）
export type NoteLink = {
  /** リンク先ノートのファイル ID（プロバイダー固有） */
  targetNoteId: string;
  /** リンク元のブロック ID */
  sourceBlockId: string;
  /** リンクの種類 */
  type: "derived_from";
};

// AI チャットメッセージ
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// スコープに紐づく AI チャット
export type ScopeChat = {
  id: string;
  scopeBlockId: string;
  scopeType: "heading" | "block" | "page";
  messages: ChatMessage[];
  generatedBy?: {
    agent: string;
    sessionId: string;
    model?: string;
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  createdAt: string;
  modifiedAt: string;
};

// Graphium ファイルの内容（エディタの完全な状態）
// version 履歴:
//   1: 初期形式（links フィールドを prov / knowledge で混在管理）
//   2: links を provLinks / knowledgeLinks に分離
//   3: labels の値を日本語ブラケット表記（[材料] 等）から内部キー（material 等）に移行
//   4: 旧内部キー "result"（Output Entity）を "output" にリネーム。
//      Phase ラベル "plan" / "result" を新設（衝突回避）。
//   5: block-level inline-type ラベル（material/tool/attribute/output）をインラインハイライト
//      （Highlight 配列）に移行。LabelStore は heading 用（procedure/plan/result/free*）に純化。
export type GraphiumDocument = {
  version: 1 | 2 | 3 | 4 | 5;
  title: string;
  pages: GraphiumPage[];
  /** ノート間リンク（派生先ノートへの参照） */
  noteLinks?: NoteLink[];
  /** このノートの派生元ノート ID */
  derivedFromNoteId?: string;
  /** このノートの派生元ブロック ID */
  derivedFromBlockId?: string;
  /** AI エージェントによる生成メタデータ */
  generatedBy?: {
    agent: string;
    sessionId: string;
    model?: string;
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    /**
     * 保存指示を出したユーザー。Claude Code Skill 等、外部エージェント経由で
     * 書き込まれたノートで値が入る。プライバシー配慮のため email は opt-in。
     */
    user?: { username: string; email?: string };
  };
  /** スコープ別 AI チャット履歴 */
  chats?: ScopeChat[];
  /** ドキュメント来歴（編集操作の PROV-DM 記録） */
  documentProvenance?: DocumentProvenance;
  /** ドキュメントソース: "human"（既存ノート）or "ai"（Wiki ドキュメント）or "skill"（プロンプトテ��プレート） */
  source?: "human" | "ai" | "skill";
  /** AI Wiki ドキュメント���メタデータ（source === "ai" の場合のみ） */
  wikiMeta?: WikiMeta;
  /**
   * team-shared-storage への共有状態（Phase 2a）。
   * 設定されていればこのノートは shared 側にコピーが書き出されている。
   * Phase 2a ではコピーが残る運用（personal 側は消さない）。Phase 2b で
   * 移動 semantics（personal → shared 参照）に進化する。
   */
  sharedRef?: {
    /** SharedEntry.id（uuidv7） */
    id: string;
    /** SharedEntry.type（Phase 2a は "note" 固定） */
    type: "note";
    /** ISO-8601 最終共有日時 */
    sharedAt: string;
    /** 共有時の SharedEntry.hash（変更検知用） */
    hash: string;
  };
  /**
   * team-shared エントリを fork して作られたローカルノートの起源情報（Phase 2c）。
   * fork 元の SharedEntry は元の author 所有のままで、本ノートとは別人格として PROV で繋がる。
   */
  forkedFrom?: {
    /** fork 元 SharedEntry.id */
    sharedId: string;
    /** fork 時点の SharedEntry.hash */
    hash: string;
    /** fork 元 author の表示名 */
    authorName: string;
    /** fork 元 author の email */
    authorEmail: string;
    /** ISO-8601 fork 実行日時 */
    forkedAt: string;
  };
  /** Skill メタデータ（source === "skill" の場合のみ） */
  skillMeta?: SkillMeta;
  /** 外部 URL から生成した場合の元 URL */
  sourceUrl?: string;
  /** 外部 URL 取得日時（ISO 8601） */
  sourceFetchedAt?: string;
  /** 外部 URL のページタイトル（fetch 時点） */
  sourceTitle?: string;
  /** PDF から生成した場合の元 PDF（メディアインデックス上の fileId） */
  sourcePdfFileId?: string;
  /** PDF から生成した場合の表示用ファイル名 */
  sourcePdfName?: string;
  createdAt: string;
  modifiedAt: string;
};

export type GraphiumPage = {
  id: string;
  title: string;
  blocks: any[];
  /**
   * ブロックラベル（heading 用 = procedure / plan / result / free.* のみ）。
   * v5 以降、material / tool / attribute / output は highlights に移行する。
   */
  labels: Record<string, string>;
  /** PROV 層リンク（DAG 制約） */
  provLinks: any[];
  /** 知識層リンク（循環 OK） */
  knowledgeLinks: any[];
  /** @deprecated v1 互換: 旧 links フィールド。読み込み時に provLinks/knowledgeLinks に変換する */
  links?: any[];
  /** インデックステーブル: テーブルブロック ID → { サンプル名 → ノートファイル ID } */
  indexTables?: Record<string, Record<string, string>>;
  /**
   * インラインハイライト（v5 で導入）。
   * material / tool / attribute / output は本文ブロック内のテキスト範囲として保存される。
   * 1 ハイライト = 1 ブロック内（越境禁止）。
   */
  highlights?: InlineHighlight[];
  /**
   * メディアブロックのインラインラベル（Phase D-3-β, 2026-04-30 で導入）。
   *
   * 画像・動画・音声・PDF・ファイルブロックは BlockNote の inline style を持てないため、
   * 同等の UX（フローティングメニュー）でラベル付けする経路として、blockId → ラベル
   * の対応を**サイドストア**として保存する。
   *
   * 設計メモ（docs/internal/provenance-layer-design.md §8.6）では block.props 直接保存
   * を理想形としているが、BlockNote 標準ブロック (image/video/audio/file) のスキーマ
   * 拡張は影響範囲が大きいため、本実装ではサイドストア方式を採用している。UX は
   * テキストハイライトと完全に一致する。
   */
  mediaInlineLabels?: Record<string, MediaInlineLabel>;
  derivedFromPageId?: string;
  derivedFromBlockId?: string;
};

/**
 * メディアブロック用インラインラベル（Phase D-3-β）。
 *
 * - blockId: image / video / audio / file / pdf ブロックの ID
 * - label: コアラベル（material / tool / attribute / output）
 * - entityId: PROV Entity 同一性キー（テキストハイライトと共通の名前空間）
 */
export type MediaInlineLabel = {
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;
};

/**
 * インライン referent ハイライト（Phase C, v5）。
 *
 * material / tool / attribute / output を「ブロック内のテキスト範囲」として記録する。
 * 同一 entityId を持つ複数ハイライトは同じ PROV Entity を指す（参照重複の集約）。
 *
 * - blockId: ハイライトが属するブロックの ID（ブロック跨ぎ禁止）
 * - text: 参照テキストのスナップショット（ブロック編集で from/to がずれた場合の復旧手がかり）
 * - from / to: ブロック content 内の文字オフセット（先頭からの 0-indexed）
 * - label: コアラベル（material / tool / attribute / output のいずれか）
 * - entityId: PROV Entity 同一性キー（同じ referent を指す複数ハイライトは同じ id を共有）
 */
export type InlineHighlight = {
  id: string;
  blockId: string;
  from: number;
  to: number;
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;
  text: string;
};
