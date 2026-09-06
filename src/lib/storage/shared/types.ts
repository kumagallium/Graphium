// Team-shared storage の型定義（Phase 1a — データモデル + Provider インターフェース）
//
// 既存の StorageProvider（個人ノートのファイル CRUD）とは並立関係。
// 思想:
//   - 既存: タイトル基準の CRUD、人間可読パス、所有 = アカウント
//   - 共有: uuidv7 = id 主導、content-addressed (hash)、author = self-asserted identity
//
// 本ファイルでは型のみ定義し、既存コードには import されない。
// Local folder Provider 実装と registry 統合は後続の PR で行う。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §4 Storage Provider 拡張

import type { AuthorIdentity } from "../../../features/document-provenance/types";

/**
 * SharedEntry の種別。フォルダ構造 (notes/, references/, ...) と 1:1 で対応する。
 *
 * Knowledge（Wiki）は 1 つの "knowledge" type に集約し、内部分類
 * （summary / claim / atom / synthesis）は extra.wikiKind に持たせる。
 * WikiKind は今後も増減しうる流動的な分類なので、共有フォーマットの語彙
 * （= フォルダ構造 = 旧バージョンの Graphium も読む永続層）には焼き込まない。
 * 未知の wikiKind でも「Knowledge エントリ」として表示・fork できる前方互換を保つ。
 *
 * "comment" は共有ストレージだけに存在する種別（手元のノートには対応物が無い）。
 * 対象エントリへの指摘を封筒 1 通として置き、extra.target で対象に結び付ける。
 */
export type SharedEntryType =
  | "note"
  | "reference"
  | "data-manifest"
  | "template"
  | "knowledge"
  | "report"
  | "comment";

/** 同一 ID 上書き時の hash 履歴（軽量、本文は持たない）。 */
export type HistoryEntry = {
  hash: string;
  updated_at: string;
  updated_by: AuthorIdentity;
  /** minor = 同一 ID 上書き、major = 新 ID + supersedes（折衷案 C） */
  change_kind: "minor" | "major";
  note?: string;
};

/** バイナリの content-addressed 参照（v2: bloxberg / OpenTimestamps）。 */
export type Attestation = {
  provider: "bloxberg" | "opentimestamps";
  hash: string;
  timestamp: string;
  /** チェーン上の証明データ（provider 固有のシリアライズ） */
  proof: string;
};

/**
 * Shared エントリのメタデータ。
 *
 * - `id`: uuidv7。時系列ソート可、内容更新で変わらない（path 非依存）
 * - `hash`: 本体コンテンツ + メタデータ（hash / history / superseded_by を除く）の SHA-256
 * - `prov.derived_from`: Pack 内系譜
 * - `prov.local_origin`: ローカルノート起源（参考情報、解決不要）
 */
export type SharedEntry = {
  id: string;
  type: SharedEntryType;
  author: AuthorIdentity;
  created_at: string;
  updated_at: string;
  hash: string;
  prov: {
    derived_from: string[];
    local_origin?: string;
  };
  history?: HistoryEntry[];
  /** メジャー改訂で増える、初版は 1 */
  version?: number;
  /** メジャー改訂時の前バージョン id */
  supersedes?: string;
  /** 後継エントリ id（自動付与は不可、後続書き込み時の参照のみ） */
  superseded_by?: string;
  attestations?: Attestation[];
  /** unshared = tombstone（誤共有リカバリ） */
  status?: "active" | "unshared";
  unshared_at?: string;
  unshared_by?: AuthorIdentity;
  /** 種別固有フィールド（type ごとに UI 側でナローイング） */
  extra?: Record<string, unknown>;
};

/**
 * read() の戻り値。本体は Uint8Array で返し、テキスト系は呼び出し側で
 * TextDecoder により復元する。バイナリも同じ経路で扱える。
 */
export type SharedEntryContent = {
  entry: SharedEntry;
  body: Uint8Array;
};

/**
 * 楽観的ロック（v2 で実装、v1 では未使用）。
 * Provider が `lock?` を実装した場合のみ有効。
 */
export type Lock = {
  id: string;
  acquired_by: AuthorIdentity;
  acquired_at: string;
  /** ISO-8601。経過後は失効、別のクライアントが取り直せる */
  expires_at: string;
  release(): Promise<void>;
};

/**
 * GitHub PR 等の publish workflow 用（v2）。
 */
export type ReviewRequest = {
  url: string;
  state: "open" | "merged" | "closed";
};

/**
 * Shared テキスト/メタデータ用 Provider。
 *
 * 実装は v1 で Local folder のみ。WebDAV / S3 / GitHub は v2+。
 * `kind` は型として閉じない（string）— サードパーティ Provider 追加で
 * core 型を毎回触らないため。組み込み Provider の識別子は別途 const map で管理する。
 */
export interface SharedStorageProvider {
  readonly kind: string;
  readonly visibility: "private" | "public";

  /**
   * 指定種別の全エントリを列挙する。
   * tombstone（status === "unshared"）の扱いは Provider 実装に委ねる
   * （v1 Local folder では `_meta/tombstones/` に残し、本体 list からは除外）。
   */
  list(prefix: SharedEntryType): Promise<SharedEntry[]>;

  /** id でエントリ + 本体を取得。 */
  read(id: string): Promise<SharedEntryContent>;

  /**
   * upsert by id。同じ id への書き込みは「minor 改訂 = 上書き」を意味する
   * （history に旧 hash を 1 行追加）。major 改訂は呼び出し側が新 id を生成し、
   * `entry.supersedes` に旧 id をセットして write する。
   */
  write(entry: SharedEntry, content: Uint8Array): Promise<void>;

  /**
   * tombstone 化（実体削除はしない）。誤共有リカバリ用。
   * 完全削除は Provider のオプション（v1 では未対応）。
   */
  delete(id: string): Promise<void>;

  /**
   * 保存されているメタデータの hash と、現在の本体から再計算した hash を
   * 突き合わせる。改ざん検知用。
   */
  verifyHash(id: string): Promise<boolean>;

  // ── オプショナル（v2+） ──
  history?(id: string): Promise<HistoryEntry[]>;
  lock?(id: string): Promise<Lock>;
  publishWorkflow?(id: string): Promise<ReviewRequest>;
}

/**
 * 大容量バイナリへの content-addressed 参照。
 * data-manifest が複数の BlobRef を保持する想定。
 */
export type BlobRef = {
  /** Provider 識別子（"local-folder" | "s3" | "zenodo" | "nas" | ...） */
  provider: string;
  /** 例: file:///path, s3://bucket/key, zenodo://record/file */
  uri: string;
  /** SHA-256 of blob bytes */
  hash: string;
  size: number;
  filename?: string;
};

/**
 * Blob 用 Provider。SharedStorageProvider と別軸で差し替え可能。
 *
 * 例: shared 自体は研究室 NAS（Local folder）、論文用データは Zenodo
 *     のように 1 ノート内で複数 Blob Provider が併存しうる。
 */
export interface BlobStorageProvider {
  readonly kind: string;

  /** バイト列を保存して BlobRef を返す。hash は実装側で計算する。 */
  put(blob: Uint8Array, hint?: { filename?: string }): Promise<BlobRef>;

  get(ref: BlobRef): Promise<Uint8Array>;

  /** 表示用 URL（署名付き等）。Local folder では file:// or blob: URL。 */
  url(ref: BlobRef): Promise<string>;

  /** ref.hash と現在の実体の hash を突き合わせる。 */
  verifyHash(ref: BlobRef): Promise<boolean>;
}

/**
 * 組み込み Provider の識別子。string 型の `kind` に対する参照値として
 * 使う（型レベルで閉じない代わり、UI / 設定では const として扱う）。
 */
export const BUILTIN_SHARED_PROVIDER_KINDS = {
  localFolder: "local-folder",
} as const;

export const BUILTIN_BLOB_PROVIDER_KINDS = {
  localFolder: "local-folder",
} as const;
