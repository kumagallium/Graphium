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
