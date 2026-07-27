// InboxPusher の Google Drive 実装。
//
// アップロード先はユーザーの個人 Drive の `Graphium/Inbox/`。デスクトップ側は
// 既存の同期フォルダ受信箱（FolderInbox, #604）が Google Drive for desktop 等の
// 同期を介して拾う想定なので、ここは「置く」ことだけに徹する。
//
// - スコープは drive.file のみ。アプリが作ったファイル/フォルダしか見えないので、
//   フォルダ解決は常に find-or-create（既にユーザーが手で作った同名フォルダは
//   見えず、初回に必ず自前で作る）。解決結果は localStorage にキャッシュし、
//   404/権限エラー時はキャッシュを破棄して作り直す。
// - ≤5MB は multipart（uploadType=multipart / FormData）、それ超は resumable
//   （uploadType=resumable / 256KiB 倍数チャンク）。
// - resumable 初期化応答の Location ヘッダが CORS で読めない環境に備え、
//   X-GUploader-UploadID からセッション URI を再構成するフォールバックを持つ。
// - 401 は invalidateAccessToken() してから PushAuthError にする（queue 側の
//   中断シグナル）。手元の期限が残っていても Google 側の判定を正とする。
//
// multipart / find-or-create のパターンは旧実装
// （4608875~1:src/lib/google-drive.ts の uploadMediaFileWithMeta / getOrCreateFolder）
// を下敷きにしている。

import {
  getDriveFolderCache,
  getGoogleClientId,
  setDriveFolderCache,
} from "./config";
import {
  connectInteractive,
  disconnectGoogleAuth,
  getValidAccessToken,
  invalidateAccessToken,
  prepareGoogleAuth,
} from "./google-auth";
import {
  PushAuthError,
  PushConfigError,
  type InboxPusher,
  type PushOptions,
  type PushResult,
} from "./types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const MIME_FOLDER = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Graphium";
const INBOX_FOLDER_NAME = "Inbox";
/** これ以下は multipart、超えたら resumable。Drive の multipart 上限は 5MB。 */
const MULTIPART_LIMIT_BYTES = 5 * 1024 * 1024;
/** resumable のチャンクサイズ。Drive の要件で 256KiB の倍数（8MiB = 32 × 256KiB）。 */
const CHUNK_BYTES = 32 * 256 * 1024;

/** キャッシュしていた親フォルダが消えた/権限を失ったことを示す内部シグナル。 */
class FolderGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderGoneError";
  }
}

export type GoogleDrivePusherOptions = {
  /** テスト用: multipart/resumable の振り分け閾値（既定 5MB）。 */
  multipartLimitBytes?: number;
  /** テスト用: resumable のチャンクサイズ。本番は 256KiB の倍数であること（既定 8MiB）。 */
  chunkBytes?: number;
};

export class GoogleDrivePusher implements InboxPusher {
  readonly kind = "google-drive" as const;
  private readonly multipartLimitBytes: number;
  private readonly chunkBytes: number;

  constructor(options: GoogleDrivePusherOptions = {}) {
    this.multipartLimitBytes = options.multipartLimitBytes ?? MULTIPART_LIMIT_BYTES;
    this.chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
  }

  isConfigured(): boolean {
    return getGoogleClientId() !== null;
  }

  async prepare(): Promise<void> {
    const clientId = getGoogleClientId();
    if (!clientId) {
      throw new PushConfigError("Google client ID is not configured");
    }
    await prepareGoogleAuth(clientId);
  }

  isConnected(): boolean {
    return getValidAccessToken() !== null;
  }

  connect(): Promise<void> {
    // connectInteractive はこの同期呼び出しの中で requestAccessToken まで到達する。
    // ここに await/async 前処理を足してはいけない（ユーザージェスチャが切れる）。
    return connectInteractive().then(() => undefined);
  }

  disconnect(): void {
    disconnectGoogleAuth();
    // フォルダ ID はアカウントに紐づくので、別アカウント接続に備えて破棄する
    setDriveFolderCache(null);
  }

  async push(file: File, opts?: PushOptions): Promise<PushResult> {
    try {
      return await this.pushOnce(file, opts);
    } catch (err) {
      if (err instanceof FolderGoneError) {
        // キャッシュしていた Inbox フォルダが消された等 → 作り直して 1 回だけ再試行
        setDriveFolderCache(null);
        return await this.pushOnce(file, opts);
      }
      throw err;
    }
  }

  private async pushOnce(file: File, opts?: PushOptions): Promise<PushResult> {
    const token = this.requireToken();
    const inboxId = await this.ensureInboxFolder(token);
    if (file.size <= this.multipartLimitBytes) {
      return await this.multipartUpload(token, inboxId, file, opts);
    }
    return await this.resumableUpload(token, inboxId, file, opts);
  }

  private requireToken(): string {
    const token = getValidAccessToken();
    if (!token) {
      throw new PushAuthError("Google Drive is not connected or the token has expired");
    }
    return token;
  }

  /** Graphium → Inbox の順に find-or-create し、Inbox の ID を返す（キャッシュ利用）。 */
  private async ensureInboxFolder(token: string): Promise<string> {
    const cached = getDriveFolderCache();
    if (cached) return cached.inboxId;
    const rootId = await this.findOrCreateFolder(token, ROOT_FOLDER_NAME, null);
    const inboxId = await this.findOrCreateFolder(token, INBOX_FOLDER_NAME, rootId);
    setDriveFolderCache({ rootId, inboxId });
    return inboxId;
  }

  private async findOrCreateFolder(
    token: string,
    name: string,
    parentId: string | null,
  ): Promise<string> {
    // drive.file スコープではアプリ作成分しか見えない。それでも過去に自分が
    // 作った分を拾うため、作成の前に必ず検索する（多重作成防止）。
    const clauses = [
      `name='${name}'`,
      `mimeType='${MIME_FOLDER}'`,
      "trashed=false",
    ];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    const query = clauses.join(" and ");
    const searchRes = await this.driveFetch(
      token,
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
    );
    if (!searchRes.ok) {
      throw new Error(`Drive folder lookup failed (${searchRes.status})`);
    }
    const found = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (found.files && found.files.length > 0) return found.files[0].id;

    const createRes = await this.driveFetch(token, `${DRIVE_API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: MIME_FOLDER,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    if (!createRes.ok) {
      // 親 ID が無効（キャッシュ経由ではないが保険）
      if (createRes.status === 404 || createRes.status === 403) {
        throw new FolderGoneError(`Drive folder create failed (${createRes.status})`);
      }
      throw new Error(`Drive folder create failed (${createRes.status})`);
    }
    const created = (await createRes.json()) as { id: string };
    return created.id;
  }

  /** ≤5MB: multipart（メタデータ + 本体を 1 リクエストで）。 */
  private async multipartUpload(
    token: string,
    inboxId: string,
    file: File,
    opts?: PushOptions,
  ): Promise<PushResult> {
    // fetch はアップロード進捗を観測できないため、multipart は開始/完了の 2 点通知
    opts?.onProgress?.({ sentBytes: 0, totalBytes: file.size });

    const metadata = { name: file.name, parents: [inboxId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", file);

    const res = await this.driveFetch(token, `${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) {
        throw new FolderGoneError(`Drive multipart upload failed (${res.status})`);
      }
      const body = await res.text().catch(() => "");
      throw new Error(`Drive multipart upload failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { id: string };
    opts?.onProgress?.({ sentBytes: file.size, totalBytes: file.size });
    return { fileId: json.id, name: file.name };
  }

  /** >5MB: resumable（セッション開始 → 256KiB 倍数チャンクの PUT）。 */
  private async resumableUpload(
    token: string,
    inboxId: string,
    file: File,
    opts?: PushOptions,
  ): Promise<PushResult> {
    const initRes = await this.driveFetch(
      token,
      `${UPLOAD_API}/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": file.type || "application/octet-stream",
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify({ name: file.name, parents: [inboxId] }),
      },
    );
    if (!initRes.ok) {
      if (initRes.status === 404 || initRes.status === 403) {
        throw new FolderGoneError(`Drive resumable init failed (${initRes.status})`);
      }
      throw new Error(`Drive resumable init failed (${initRes.status})`);
    }
    const sessionUri = resolveSessionUri(initRes);

    let offset = 0;
    opts?.onProgress?.({ sentBytes: 0, totalBytes: file.size });
    while (offset < file.size) {
      const end = Math.min(offset + this.chunkBytes, file.size);
      const chunk = file.slice(offset, end);
      const res = await this.driveFetch(token, sessionUri, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
        },
        body: chunk,
      });

      if (res.status === 308) {
        // 継続。Range ヘッダが確定済みバイトを示す（"bytes=0-524287" → 次は 524288 から）
        const range = res.headers.get("Range");
        const confirmed = parseConfirmedEnd(range);
        const next = confirmed !== null ? confirmed + 1 : offset;
        if (next <= offset) {
          // 進みがない = 同じチャンクを送り続けるループになるので、この試行は失敗させて
          // queue のリトライ（新しいセッションでやり直し）に委ねる
          throw new Error("Drive resumable upload made no progress");
        }
        offset = next;
        opts?.onProgress?.({ sentBytes: offset, totalBytes: file.size });
        continue;
      }

      if (res.ok) {
        // 200/201 = 完了
        const json = (await res.json()) as { id: string };
        opts?.onProgress?.({ sentBytes: file.size, totalBytes: file.size });
        return { fileId: json.id, name: file.name };
      }

      if (res.status === 404 || res.status === 403) {
        throw new FolderGoneError(`Drive resumable chunk failed (${res.status})`);
      }
      throw new Error(`Drive resumable chunk failed (${res.status})`);
    }
    // 全チャンク送信後も完了応答が来なかった（通常は到達しない）
    throw new Error("Drive resumable upload did not complete");
  }

  /** Authorization 付き fetch。401 はトークン破棄 + PushAuthError（queue の中断シグナル）。 */
  private async driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      invalidateAccessToken();
      throw new PushAuthError("Google Drive rejected the access token (401)");
    }
    return res;
  }
}

/**
 * resumable セッション URI を決める。通常は Location ヘッダ。CORS 設定によっては
 * Location が読めない（Access-Control-Expose-Headers に含まれない）ことがあるため、
 * X-GUploader-UploadID からの再構成をフォールバックとして持つ。
 */
function resolveSessionUri(initRes: Response): string {
  const location = initRes.headers.get("Location");
  if (location) return location;
  const uploadId = initRes.headers.get("X-GUploader-UploadID");
  if (uploadId) {
    return `${UPLOAD_API}/files?uploadType=resumable&upload_id=${encodeURIComponent(uploadId)}&fields=id`;
  }
  throw new Error(
    "Drive resumable session URI is unavailable (no Location / X-GUploader-UploadID header)",
  );
}

/** `Range: bytes=0-524287` から確定済み末尾バイト位置を取り出す。無効なら null。 */
function parseConfirmedEnd(range: string | null): number | null {
  if (!range) return null;
  const match = /bytes=\d+-(\d+)/.exec(range);
  if (!match) return null;
  const end = Number(match[1]);
  return Number.isFinite(end) ? end : null;
}
