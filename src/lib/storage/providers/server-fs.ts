// サーバーファイルシステムプロバイダー（Docker / セルフホスト Web 用）
//
// バックエンドサーバーの /api/storage/* に対して fetch を行い、
// ノート・Wiki・Skill・メディアをサーバー側のファイルシステムに保存する。
// 同じサーバーに複数ブラウザ・端末からアクセスしても同じデータが見える。

import type { StorageProvider, AuthState, MediaUploadResult } from "../types";
import type { GraphiumDocument, GraphiumFile } from "../../document-types";
import { migrateToLatest } from "../../document-migration";

const TOKEN_KEY = "graphium_server_token";
// 機能検出キャッシュ（同一セッション内で再問い合わせしない）
let cachedCapabilities: { serverStorage: boolean; requiresAuth: boolean } | null = null;

type ServerFileInfo = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

type ServerMediaInfo = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
};

/** トークンを取得（localStorage） */
function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** トークンを保存 */
export function setServerStorageToken(token: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  cachedCapabilities = null;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { "X-Graphium-Token": token } : {};
}

/** サーバー機能を問い合わせ */
export async function fetchCapabilities(): Promise<
  { serverStorage: boolean; requiresAuth: boolean } | null
> {
  if (cachedCapabilities) return cachedCapabilities;
  try {
    const res = await fetch("/api/storage/capabilities", {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      // トークンが必要だが未設定 / 不一致
      cachedCapabilities = { serverStorage: true, requiresAuth: true };
      return cachedCapabilities;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { serverStorage: boolean; requiresAuth: boolean };
    cachedCapabilities = data;
    return data;
  } catch {
    return null;
  }
}

async function authedFetchInternal(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.clone().text();
      detail = body.slice(0, 500);
    } catch {
      // ignore
    }
    throw new Error(`Storage API エラー (${res.status}): ${detail}`);
  }
  return res;
}

let authListeners: Array<(state: AuthState) => void> = [];
let signedIn = false;
const mediaBlobCache = new Map<string, string>();

export class ServerFilesystemProvider implements StorageProvider {
  readonly id = "server-fs";
  readonly displayName = "Server (Self-host)";

  async init(): Promise<void> {
    const caps = await fetchCapabilities();
    if (!caps?.serverStorage) {
      throw new Error("サーバーストレージが利用できません");
    }
    if (caps.requiresAuth && !getToken()) {
      throw new Error("認証トークンが必要です");
    }
    // 接続テスト
    await authedFetchInternal("/api/storage/notes");
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

  // --- ノート CRUD ---

  async listFiles(): Promise<GraphiumFile[]> {
    const res = await authedFetchInternal("/api/storage/notes");
    const files = (await res.json()) as ServerFileInfo[];
    return files;
  }

  async loadFile(fileId: string): Promise<GraphiumDocument> {
    const res = await authedFetchInternal(`/api/storage/notes/${encodeURIComponent(fileId)}`);
    const json = (await res.json()) as GraphiumDocument;
    return migrateToLatest(json);
  }

  async createFile(_title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    await authedFetchInternal(`/api/storage/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
    return id;
  }

  async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
    await authedFetchInternal(`/api/storage/notes/${encodeURIComponent(fileId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await authedFetchInternal(`/api/storage/notes/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
  }

  // --- メディア ---

  async uploadMedia(file: File): Promise<MediaUploadResult> {
    const id = crypto.randomUUID();
    const form = new FormData();
    form.append("file", file);
    const res = await authedFetchInternal(`/api/storage/media?id=${encodeURIComponent(id)}`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as { id: string; name: string; mimeType: string };
    return {
      fileId: data.id,
      url: `media-server://${data.id}`,
      name: data.name,
      mimeType: data.mimeType,
    };
  }

  async getMediaBlobUrl(fileId: string): Promise<string> {
    const cached = mediaBlobCache.get(fileId);
    if (cached) return cached;
    const res = await authedFetchInternal(`/api/storage/media/${encodeURIComponent(fileId)}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    mediaBlobCache.set(fileId, url);
    return url;
  }

  extractFileId(url: string): string | null {
    const match = url.match(/^media-server:\/\/(.+)$/);
    return match ? match[1] : null;
  }

  async getUserEmail(): Promise<string | null> {
    return null;
  }

  async authedFetch(url: string, options?: RequestInit): Promise<Response> {
    return authedFetchInternal(url, options);
  }

  // --- アプリデータ ---

  async readAppData(key: string): Promise<unknown | null> {
    try {
      const res = await fetch(`/api/storage/appdata/${encodeURIComponent(key)}`, {
        headers: authHeaders(),
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text === "null") return null;
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async writeAppData(key: string, data: unknown): Promise<void> {
    await authedFetchInternal(`/api/storage/appdata/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  // --- メディア管理 ---

  async renameMedia(fileId: string, newName: string): Promise<void> {
    await authedFetchInternal(`/api/storage/media/${encodeURIComponent(fileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
  }

  async deleteMedia(fileId: string): Promise<void> {
    await authedFetchInternal(`/api/storage/media/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
    const cached = mediaBlobCache.get(fileId);
    if (cached) {
      URL.revokeObjectURL(cached);
      mediaBlobCache.delete(fileId);
    }
  }

  async listMediaFiles(): Promise<
    { id: string; name: string; mimeType: string; createdTime: string }[]
  > {
    const res = await authedFetchInternal("/api/storage/media");
    return (await res.json()) as ServerMediaInfo[];
  }

  clearCache(): void {
    for (const url of mediaBlobCache.values()) {
      URL.revokeObjectURL(url);
    }
    mediaBlobCache.clear();
  }

  // --- Wiki ドキュメント CRUD ---

  async listWikiFiles(): Promise<GraphiumFile[]> {
    const res = await authedFetchInternal("/api/storage/wiki");
    return (await res.json()) as ServerFileInfo[];
  }

  async loadWikiFile(fileId: string): Promise<GraphiumDocument> {
    const res = await authedFetchInternal(`/api/storage/wiki/${encodeURIComponent(fileId)}`);
    return (await res.json()) as GraphiumDocument;
  }

  async createWikiFile(_title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    await authedFetchInternal(`/api/storage/wiki/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
    return id;
  }

  async saveWikiFile(fileId: string, content: GraphiumDocument): Promise<void> {
    await authedFetchInternal(`/api/storage/wiki/${encodeURIComponent(fileId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
  }

  async deleteWikiFile(fileId: string): Promise<void> {
    await authedFetchInternal(`/api/storage/wiki/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
  }

  // --- Skill ドキュメント CRUD ---

  async listSkillFiles(): Promise<GraphiumFile[]> {
    const res = await authedFetchInternal("/api/storage/skills");
    return (await res.json()) as ServerFileInfo[];
  }

  async loadSkillFile(fileId: string): Promise<GraphiumDocument> {
    const res = await authedFetchInternal(`/api/storage/skills/${encodeURIComponent(fileId)}`);
    return (await res.json()) as GraphiumDocument;
  }

  async createSkillFile(_title: string, content: GraphiumDocument): Promise<string> {
    const id = crypto.randomUUID();
    await authedFetchInternal(`/api/storage/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
    return id;
  }

  async saveSkillFile(fileId: string, content: GraphiumDocument): Promise<void> {
    await authedFetchInternal(`/api/storage/skills/${encodeURIComponent(fileId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
  }

  async deleteSkillFile(fileId: string): Promise<void> {
    await authedFetchInternal(`/api/storage/skills/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
  }
}
