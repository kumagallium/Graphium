// Graphium ドキュメントのドメイン型定義
// ストレージプロバイダーに依存しない、アプリケーション固有の型

import type { DocumentProvenance } from "../features/document-provenance/types";

// AI Wiki ドキュメントの種類
// synthesis: 複数の Concept を統合して新しい洞察を生むページ
export type WikiKind = "summary" | "concept" | "synthesis";

// Skill（プロンプトテンプレート）のメタデータ
export type SkillMeta = {
  /** スキルの説明（一行） */
  description: string;
  /** Ingest 時に自動適用するか */
  availableForIngest: boolean;
  /** 作成日時 */
  createdAt: string;
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
export type GraphiumDocument = {
  version: 1 | 2 | 3;
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
  /** Skill メタデータ（source === "skill" の場合のみ） */
  skillMeta?: SkillMeta;
  createdAt: string;
  modifiedAt: string;
};

export type GraphiumPage = {
  id: string;
  title: string;
  blocks: any[];
  labels: Record<string, string>;
  /** PROV 層リンク（DAG 制約） */
  provLinks: any[];
  /** 知識層リンク（循環 OK） */
  knowledgeLinks: any[];
  /** @deprecated v1 互換: 旧 links フィールド。読み込み時に provLinks/knowledgeLinks に変換する */
  links?: any[];
  /** インデックステーブル: テーブルブロック ID → { サンプル名 → ノートファイル ID } */
  indexTables?: Record<string, Record<string, string>>;
  derivedFromPageId?: string;
  derivedFromBlockId?: string;
};
