// Google Drive ストレージプロバイダー
// 既存の google-auth.ts / google-drive.ts をラップして StorageProvider インターフェースを実装

import type { StorageProvider, AuthState, MediaUploadResult } from "../types";
import type { GraphiumDocument, GraphiumFile } from "../../document-types";
import {
  initGoogleAuth,
  signIn as gisSignIn,
  signOut as gisSignOut,
  isSignedIn,
  onAuthChange as gisOnAuthChange,
  getAccessToken,
} from "../../google-auth";
import {
  listFiles as driveListFiles,
  loadFile as driveLoadFile,
  createFile as driveCreateFile,
  saveFile as driveSaveFile,
  deleteFile as driveDeleteFile,
  uploadMediaFileWithMeta,
  fetchMediaBlobUrl,
  extractDriveFileId,
  getUserEmail as driveGetUserEmail,
  getLatestRevisionId,
  clearCache as driveClearCache,
} from "../../google-drive";
import { clearIndexCache } from "../../../features/navigation/index-file";
import { clearMediaIndexCache } from "../../../features/asset-browser/media-index";
import { clearCaptureCache } from "../../../features/mobile-capture/capture-store";

export class GoogleDriveProvider implements StorageProvider {
  readonly id = "google-drive";
  readonly displayName = "Google Drive";

  async init(): Promise<void> {
    await initGoogleAuth();
  }

  signIn(): void {
    gisSignIn();
  }

  signOut(): void {
    gisSignOut();
    this.clearCache();
  }

  getAuthState(): AuthState {
    return {
      isSignedIn: isSignedIn(),
      userEmail: null, // メール取得は非同期のため、ここでは null
    };
  }

  onAuthChange(fn: (state: AuthState) => void): () => void {
    return gisOnAuthChange((token) => {
      fn({
        isSignedIn: token !== null,
        userEmail: null,
      });
    });
  }

  async listFiles(): Promise<GraphiumFile[]> {
    return driveListFiles();
  }

  async loadFile(fileId: string): Promise<GraphiumDocument> {
    return driveLoadFile(fileId);
  }

  async createFile(title: string, content: GraphiumDocument): Promise<string> {
    return driveCreateFile(title, content);
  }

  async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
    return driveSaveFile(fileId, content);
  }

  async deleteFile(fileId: string): Promise<void> {
    return driveDeleteFile(fileId);
  }

  async uploadMedia(file: File): Promise<MediaUploadResult> {
    return uploadMediaFileWithMeta(file);
  }

  async getMediaBlobUrl(fileId: string): Promise<string> {
    return fetchMediaBlobUrl(fileId);
  }

  extractFileId(url: string): string | null {
    return extractDriveFileId(url);
  }

  async getUserEmail(): Promise<string | null> {
    return driveGetUserEmail();
  }

  async getRevisionId(fileId: string): Promise<string | null> {
    return getLatestRevisionId(fileId);
  }

  async authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = getAccessToken();
    if (!token) throw new Error("未認証です。サインインしてください。");

    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive API エラー (${res.status}): ${body}`);
    }
    return res;
  }

  clearCache(): void {
    driveClearCache();
    clearIndexCache();
    clearMediaIndexCache();
    clearCaptureCache();
  }
}
