// ストレージプロバイダーのインターフェース定義
// 各プロバイダー（Google Drive, OneDrive, Dropbox, S3 等）がこれを実装する

import type { GraphiumDocument, GraphiumFile } from "../document-types";

/** メディアアップロード結果 */
export type MediaUploadResult = {
  fileId: string;
  url: string;
  name: string;
  mimeType: string;
};

/** 認証状態 */
export type AuthState = {
  isSignedIn: boolean;
  userEmail: string | null;
};

/** ストレージプロバイダーのインターフェース */
export interface StorageProvider {
  /** プロバイダー識別子（設定保存・切り替え用） */
  readonly id: string;
  /** 表示名 */
  readonly displayName: string;

  // --- 認証 ---
  init(): Promise<void>;
  signIn(): void;
  signOut(): void;
  getAuthState(): AuthState;
  onAuthChange(fn: (state: AuthState) => void): () => void;

  // --- ファイル CRUD ---
  listFiles(): Promise<GraphiumFile[]>;
  loadFile(fileId: string): Promise<GraphiumDocument>;
  createFile(title: string, content: GraphiumDocument): Promise<string>;
  saveFile(fileId: string, content: GraphiumDocument): Promise<void>;
  deleteFile(fileId: string): Promise<void>;

  // --- メディア ---
  uploadMedia(file: File): Promise<MediaUploadResult>;
  /** メディアファイルの表示用 URL を取得（動画・音声は Blob URL を返す場合あり） */
  getMediaBlobUrl(fileId: string): Promise<string>;
  /**
   * メディアの実体バイト列を読む（表示用の URL を作らない）。
   *
   * `getMediaBlobUrl` は blob URL をモジュールキャッシュに溜めるので、素材を
   * 端から読むような用途（重複判定のハッシュ後追い付与など）に使うと、
   * ライブラリ全体の blob がセッション中メモリに居座る。中身だけ要る場面は
   * こちらを使う。
   *
   * `maxBytes` を渡すと、それより大きい素材は読まずに undefined を返す。
   * SHA-256 は全体をメモリに載せないと計算できないため、巨大な動画で
   * 数百 MB を抱えるくらいなら読まない方がよい、という判断のため。
   *
   * 未実装プロバイダでは undefined（呼び出し側は機能ごと諦める）。
   */
  readMediaBytes?(fileId: string, maxBytes?: number): Promise<Uint8Array | undefined>;
  /** URL からプロバイダー固有のファイル ID を抽出 */
  extractFileId(url: string): string | null;

  // --- メタデータ ---
  getUserEmail(): Promise<string | null>;
  getRevisionId?(fileId: string): Promise<string | null>;

  // --- 認証付き fetch（Drive API 互換プロバイダー用） ---
  authedFetch(url: string, options?: RequestInit): Promise<Response>;

  // --- アプリデータ（インデックスファイル等の内部メタデータ） ---
  readAppData?(key: string): Promise<unknown | null>;
  writeAppData?(key: string, data: unknown): Promise<void>;

  // --- メディア管理 ---
  renameMedia?(fileId: string, newName: string): Promise<void>;
  deleteMedia?(fileId: string): Promise<void>;
  listMediaFiles?(): Promise<{ id: string; name: string; mimeType: string; createdTime: string }[]>;

  // --- メディア原文テキスト（URL Reader 原文などの永続保存, B-persist） ---
  /**
   * 外部素材の原文プレーンテキスト（URL の Reader 抽出結果など、LLM 加工前）を永続保存する。
   * fileId は呼び出し側が発行し、GraphiumDocument.sourceTextFileId に紐付ける。
   * バイナリメディア（uploadMedia）とは別チャネル。ノート内参照 grounding でオフライン利用・鮮度固定するため。
   * 未実装プロバイダでは undefined（呼び出し側は都度取得の loadUrlText にフォールバックする）。
   */
  saveMediaText?(fileId: string, text: string): Promise<void>;
  /** 保存済み原文テキストを取得。存在しなければ undefined */
  loadMediaText?(fileId: string): Promise<string | undefined>;
  /**
   * 保存済み原文テキストを削除する。存在しなくてもエラーにしない。
   * URL ブックマークを削除したとき、そのプレビュー画像キャッシュを道連れにする用途
   * （ブックマークはバイナリを持たないので deleteMedia が呼ばれない）。
   */
  deleteMediaText?(fileId: string): Promise<void>;

  // --- キャッシュクリア ---
  clearCache(): void;

  // --- Wiki ドキュメント CRUD ---
  listWikiFiles?(): Promise<GraphiumFile[]>;
  loadWikiFile?(fileId: string): Promise<GraphiumDocument>;
  createWikiFile?(title: string, content: GraphiumDocument): Promise<string>;
  saveWikiFile?(fileId: string, content: GraphiumDocument): Promise<void>;
  deleteWikiFile?(fileId: string): Promise<void>;

  // --- Skill ドキュメント CRUD ---
  listSkillFiles?(): Promise<GraphiumFile[]>;
  loadSkillFile?(fileId: string): Promise<GraphiumDocument>;
  createSkillFile?(title: string, content: GraphiumDocument): Promise<string>;
  saveSkillFile?(fileId: string, content: GraphiumDocument): Promise<void>;
  deleteSkillFile?(fileId: string): Promise<void>;
}
