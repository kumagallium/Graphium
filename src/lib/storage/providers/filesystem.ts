// ローカルファイルシステムプロバイダー（Tauri IPC 経由）
// ~/Documents/Graphium/notes/ に .json ファイルとして保存する
// デスクトップアプリ専用 — Web 版では使用不可

import { invoke } from "@tauri-apps/api/core";
import type { StorageProvider, AuthState, MediaUploadResult } from "../types";
import type { GraphiumDocument, GraphiumFile } from "../../document-types";
import { migrateToLatest } from "../../document-migration";

/** Rust 側 FileInfo の型 */
type RustFileInfo = {
  id: string;
  name: string;
  modified_time: string;
  created_time: string;
};

/** Rust 側 MediaFileInfo の型 */
type RustMediaFileInfo = {
  id: string;
  name: string;
  mime_type: string;
  created_time: string;
};

// 認証状態リスナー
let authListeners: Array<(state: AuthState) => void> = [];
let signedIn = false;
// Blob URL キャッシュ（file-media:// → blob: の変換結果を再利用）
const mediaBlobCache = new Map<string, string>();
// サムネイル（fileId@edge → blob URL）。原寸とは別に持つ
const thumbBlobCache = new Map<string, string>();
// list_media_files_cmd は .meta.json を全件読むので、MIME を引くためだけに毎回呼ばない。
// 短時間だけ結果を使い回す（登録直後に古い一覧を掴まないよう寿命は数秒）
let mediaListingCache: { at: number; promise: Promise<RustMediaFileInfo[]> } | null = null;
const MEDIA_LISTING_TTL_MS = 5000;
function listMediaFilesCached(): Promise<RustMediaFileInfo[]> {
  const now = Date.now();
  if (mediaListingCache && now - mediaListingCache.at < MEDIA_LISTING_TTL_MS) return mediaListingCache.promise;
  const promise = invoke<RustMediaFileInfo[]>("list_media_files_cmd");
  mediaListingCache = { at: now, promise };
  promise.catch(() => {
    if (mediaListingCache?.promise === promise) mediaListingCache = null;
  });
  return promise;
}

export class LocalFilesystemProvider implements StorageProvider {
  readonly id = "filesystem";
  readonly displayName = "Local Files";

  async init(): Promise<void> {
    // Tauri IPC が使えることを確認（list で空ディレクトリを作成）
    await invoke("list_note_files");
    signedIn = true;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  signIn(): void {
    signedIn = true;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  signOut(): void {
    signedIn = false;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  getAuthState(): AuthState {
    return { isSignedIn: signedIn, userEmail: null };
  }

  onAuthChange(fn: (state: AuthState) => void): () => void {
    authListeners.push(fn);
    return () => {
      authListeners = authListeners.filter((l) => l !== fn);
    };
  }

  async listFiles(): Promise<GraphiumFile[]> {
    const files = await invoke<RustFileInfo[]>("list_note_files");
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modified_time,
      createdTime: f.created_time,
    }));
  }

  async loadFile(fileId: string): Promise<GraphiumDocument> {
    const json = await invoke<string>("read_note_file", { fileId });
    return migrateToLatest(JSON.parse(json) as GraphiumDocument, fileId);
  }

  async createFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    const json = JSON.stringify(content);
    await invoke("write_note_file", { fileId: id, content: json });
    return id;
  }

  async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const json = JSON.stringify(content);
    await invoke("write_note_file", { fileId, content: json });
  }

  async deleteFile(fileId: string): Promise<void> {
    await invoke("delete_note_file", { fileId });
  }

  async uploadMedia(file: File): Promise<MediaUploadResult> {
    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Base64 エンコード
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const data = btoa(binary);

    await invoke("save_media_file", {
      fileId: id,
      name: file.name,
      mimeType: file.type,
      data,
    });

    // 永続的な URL 形式（セッションをまたいで有効）
    const url = `file-media://${id}`;
    return { fileId: id, url, name: file.name, mimeType: file.type };
  }

  async getMediaBlobUrl(fileId: string, mimeTypeHint?: string): Promise<string> {
    // キャッシュ確認
    const cached = mediaBlobCache.get(fileId);
    if (cached) return cached;

    // Rust から Base64 エンコードされたデータを取得
    const base64Data = await invoke<string>("read_media_file", { fileId });

    // Base64 → Blob → URL
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // MIME は索引のヒントがあればそれを、無ければ一覧（短時間キャッシュ）から引く
    let mimeType = mimeTypeHint ?? "";
    if (!mimeType) {
      const allMedia = await listMediaFilesCached();
      mimeType = allMedia.find((m) => m.id === fileId)?.mime_type ?? "application/octet-stream";
    }

    const blob = new Blob([bytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    mediaBlobCache.set(fileId, blobUrl);
    return blobUrl;
  }

  async getMediaThumbnailUrl(fileId: string, maxEdge: number): Promise<string> {
    const key = `${fileId}@${maxEdge}`;
    const cached = thumbBlobCache.get(key);
    if (cached) return cached;
    // Rust 側で縮小した JPEG（数十 KB）。画像として読めない素材は原寸に落とす
    const base64Data = await invoke<string>("read_media_thumbnail", { fileId, maxEdge });
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    thumbBlobCache.set(key, blobUrl);
    return blobUrl;
  }

  async readMediaBytes(fileId: string, maxBytes?: number): Promise<Uint8Array | undefined> {
    let base64Data: string;
    try {
      base64Data = await invoke<string>("read_media_file", { fileId });
    } catch {
      return undefined;
    }
    // Base64 は元の約 4/3 の長さ。デコード前に概算で足切りする
    //（Rust 側が既に全体を返しているので完全な予防にはならないが、
    //  デコードで更に実体分を抱えるのは避けられる）。
    if (maxBytes != null && (base64Data.length * 3) / 4 > maxBytes) return undefined;
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  extractFileId(url: string): string | null {
    // file-media://{fileId} 形式から ID を抽出
    const match = url.match(/^file-media:\/\/(.+)$/);
    return match ? match[1] : null;
  }

  async getUserEmail(): Promise<string | null> {
    return null;
  }

  // リビジョン管理なし（オプショナル、定義しない）

  async authedFetch(_url: string, _options?: RequestInit): Promise<Response> {
    throw new Error(
      "ローカルファイルシステムでは authedFetch は使用できません",
    );
  }

  // --- アプリデータ ---

  async readAppData(key: string): Promise<unknown | null> {
    try {
      const json = await invoke<string | null>("read_app_data", { key });
      if (json === null) return null;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  async writeAppData(key: string, data: unknown): Promise<void> {
    const json = JSON.stringify(data);
    await invoke("write_app_data", { key, data: json });
  }

  // --- メディア管理 ---

  async renameMedia(fileId: string, newName: string): Promise<void> {
    await invoke("rename_media_file", { fileId, newName });
  }

  async deleteMedia(fileId: string): Promise<void> {
    await invoke("delete_media_file", { fileId });
    // Blob URL キャッシュを削除
    const cached = mediaBlobCache.get(fileId);
    if (cached) {
      URL.revokeObjectURL(cached);
      mediaBlobCache.delete(fileId);
    }
    for (const [key, url] of [...thumbBlobCache]) {
      if (key.startsWith(`${fileId}@`)) {
        URL.revokeObjectURL(url);
        thumbBlobCache.delete(key);
      }
    }
    mediaListingCache = null;
  }

  async listMediaFiles(): Promise<
    { id: string; name: string; mimeType: string; createdTime: string }[]
  > {
    const files = await invoke<RustMediaFileInfo[]>("list_media_files_cmd");
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mime_type,
      createdTime: f.created_time,
    }));
  }

  // --- メディア原文テキスト（B-persist: URL Reader 原文などの永続保存） ---

  async saveMediaText(fileId: string, text: string): Promise<void> {
    await invoke("save_media_text", { fileId, text });
  }

  async loadMediaText(fileId: string): Promise<string | undefined> {
    try {
      const text = await invoke<string | null>("read_media_text", { fileId });
      return text ?? undefined;
    } catch {
      return undefined;
    }
  }

  async deleteMediaText(fileId: string): Promise<void> {
    try {
      await invoke("delete_media_text", { fileId });
    } catch {
      // 消せなくても呼び出し側の処理は続ける（残るのは孤児の .txt だけ）
    }
  }

  clearCache(): void {
    // Blob URL キャッシュをクリア
    for (const url of mediaBlobCache.values()) {
      URL.revokeObjectURL(url);
    }
    mediaBlobCache.clear();
    for (const url of thumbBlobCache.values()) {
      URL.revokeObjectURL(url);
    }
    thumbBlobCache.clear();
    mediaListingCache = null;
  }

  // --- Wiki ドキュメント CRUD ---

  async listWikiFiles(): Promise<GraphiumFile[]> {
    const files = await invoke<RustFileInfo[]>("list_wiki_files");
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modified_time,
      createdTime: f.created_time,
    }));
  }

  async loadWikiFile(fileId: string): Promise<GraphiumDocument> {
    const json = await invoke<string>("read_wiki_file", { fileId });
    return migrateToLatest(JSON.parse(json) as GraphiumDocument, fileId);
  }

  async createWikiFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    const json = JSON.stringify(content);
    await invoke("write_wiki_file", { fileId: id, content: json });
    return id;
  }

  async saveWikiFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const json = JSON.stringify(content);
    await invoke("write_wiki_file", { fileId, content: json });
  }

  async deleteWikiFile(fileId: string): Promise<void> {
    await invoke("delete_wiki_file", { fileId });
  }

  // --- Skill ドキュメント CRUD ---

  async listSkillFiles(): Promise<GraphiumFile[]> {
    const files = await invoke<RustFileInfo[]>("list_skill_files");
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modified_time,
      createdTime: f.created_time,
    }));
  }

  async loadSkillFile(fileId: string): Promise<GraphiumDocument> {
    const json = await invoke<string>("read_skill_file", { fileId });
    return JSON.parse(json) as GraphiumDocument;
  }

  async createSkillFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    const json = JSON.stringify(content);
    await invoke("write_skill_file", { fileId: id, content: json });
    return id;
  }

  async saveSkillFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const json = JSON.stringify(content);
    await invoke("write_skill_file", { fileId, content: json });
  }

  async deleteSkillFile(fileId: string): Promise<void> {
    await invoke("delete_skill_file", { fileId });
  }
}
