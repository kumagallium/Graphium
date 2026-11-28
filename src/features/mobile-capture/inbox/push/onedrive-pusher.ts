// InboxPusher の OneDrive 実装（個人の Microsoft アカウント）。
//
// アップロード先はアプリ専用フォルダ（approot = `アプリ/Graphium`）の下の `Inbox/`。
// スコープは Files.ReadWrite.AppFolder のみなので、アプリ専用フォルダの外は見えない。
// デスクトップ側は既存の同期フォルダ受信箱（FolderInbox）が OneDrive の同期を介して
// 拾う想定で、ここは「置く」ことだけに徹する。
//
// - 0 バイトは分割できないので単純 PUT（`…:/content`）。それ以外は
//   createUploadSession → uploadUrl へ 10 MiB（320 KiB の倍数）ごとに PUT。
// - **uploadUrl への PUT には Authorization を付けない**（URL 自体が資格を持つ。
//   付けると Microsoft に拒否される）。uploadUrl は console に出さない。
// - Graph の 401 は、アクセス用の鍵を捨てて 1 回だけ取り直して再試行する。
//   それでも 401 なら PushAuthError（queue の中断シグナル）。
// - `Inbox` が無くて 404 のときは approot の下に作って 1 回だけ再試行する
//   （親が自動で作られるかは未確認なので保険）。
// - 同名は rename（衝突しても上書きせず別名にする）。

import { getOneDriveClientId } from "./config";
import {
  connectInteractive,
  disconnectOneDriveAuth,
  getRefreshRemainingMs,
  getValidAccessToken,
  hasLinkedBefore,
  invalidateAccessToken,
  isConnected,
  isOneDriveAuthPrepared,
  prepareOneDriveAuth,
} from "./onedrive-auth";
import {
  PushAuthError,
  PushConfigError,
  type InboxPusher,
  type PushOptions,
  type PushResult,
} from "./types";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const APPROOT = `${GRAPH_API}/me/drive/special/approot`;
const INBOX_FOLDER_NAME = "Inbox";
/** アップロードセッションの断片の単位。Graph の要件で 320 KiB の倍数。 */
const FRAGMENT_UNIT_BYTES = 320 * 1024;
/** 1 断片のサイズ。10 MiB = 32 × 320 KiB。 */
const CHUNK_BYTES = 32 * FRAGMENT_UNIT_BYTES;

/** 残りがこれ未満なら、次のタップで取り直す対象にする。 */
export const RENEWAL_THRESHOLD_MS = 10 * 60 * 1000;

export type OneDrivePusherOptions = {
  /** テスト用: 断片のサイズ。320 KiB の倍数であること（既定 10 MiB）。 */
  chunkBytes?: number;
};

/** Inbox フォルダがまだ無い（404）ことを示す内部シグナル。 */
class InboxMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxMissingError";
  }
}

export class OneDrivePusher implements InboxPusher {
  readonly kind = "onedrive" as const;
  private readonly chunkBytes: number;

  constructor(options: OneDrivePusherOptions = {}) {
    const chunk = options.chunkBytes ?? CHUNK_BYTES;
    if (chunk <= 0 || chunk % FRAGMENT_UNIT_BYTES !== 0) {
      throw new Error("OneDrive upload chunk must be a positive multiple of 320 KiB");
    }
    this.chunkBytes = chunk;
  }

  isConfigured(): boolean {
    return getOneDriveClientId() !== null;
  }

  async prepare(): Promise<void> {
    const clientId = getOneDriveClientId();
    if (!clientId) {
      throw new PushConfigError("OneDrive client ID is not configured");
    }
    await prepareOneDriveAuth(clientId);
  }

  isConnected(): boolean {
    return isConnected();
  }

  isPrepared(): boolean {
    return isOneDriveAuthPrepared();
  }

  hasLinkedBefore(): boolean {
    return hasLinkedBefore();
  }

  needsRenewal(): boolean {
    if (!this.isConfigured()) return false;
    if (!hasLinkedBefore()) return false;
    const remaining = getRefreshRemainingMs();
    return remaining === null || remaining < RENEWAL_THRESHOLD_MS;
  }

  connect(): Promise<void> {
    // connectInteractive はこの同期呼び出しの中で window.open まで到達する。
    // ここに await/async 前処理を足してはいけない（ユーザージェスチャが切れる）。
    return connectInteractive();
  }

  disconnect(): void {
    disconnectOneDriveAuth();
  }

  async push(file: File, opts?: PushOptions): Promise<PushResult> {
    try {
      return await this.pushOnce(file, opts);
    } catch (err) {
      if (err instanceof InboxMissingError) {
        // Inbox がまだ無かった → approot の下に作って 1 回だけ再試行
        await this.createInboxFolder();
        return await this.pushOnce(file, opts);
      }
      throw err;
    }
  }

  private async pushOnce(file: File, opts?: PushOptions): Promise<PushResult> {
    const itemPath = `${APPROOT}:/${INBOX_FOLDER_NAME}/${encodeURIComponent(file.name)}:`;
    opts?.onProgress?.({ sentBytes: 0, totalBytes: file.size });
    if (file.size === 0) {
      return await this.simpleUpload(itemPath, file, opts);
    }
    return await this.sessionUpload(itemPath, file, opts);
  }

  /** 0 バイト: 単純 PUT（アップロードセッションは中身が無いと作れない）。 */
  private async simpleUpload(itemPath: string, file: File, opts?: PushOptions): Promise<PushResult> {
    const res = await this.graphFetch(
      `${itemPath}/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      },
    );
    if (res.status === 404) throw new InboxMissingError("OneDrive Inbox was not found (404)");
    if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`);
    const json = (await res.json()) as { id: string; name?: string };
    opts?.onProgress?.({ sentBytes: 0, totalBytes: 0 });
    return { fileId: json.id, name: json.name ?? file.name };
  }

  /** アップロードセッションを作り、断片ごとに PUT する。 */
  private async sessionUpload(itemPath: string, file: File, opts?: PushOptions): Promise<PushResult> {
    const sessionRes = await this.graphFetch(`${itemPath}/createUploadSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    });
    if (sessionRes.status === 404) throw new InboxMissingError("OneDrive Inbox was not found (404)");
    if (!sessionRes.ok) {
      throw new Error(`OneDrive upload session failed (${sessionRes.status})`);
    }
    const session = (await sessionRes.json()) as { uploadUrl?: string };
    if (!session.uploadUrl) {
      throw new Error("OneDrive upload session returned no upload URL");
    }
    const uploadUrl = session.uploadUrl;
    // ファイルの中身を送る先なので、https 以外は送らない
    if (!/^https:\/\//i.test(uploadUrl)) {
      throw new Error("OneDrive upload session returned an unexpected upload URL");
    }

    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + this.chunkBytes, file.size);
      // uploadUrl 自体が資格を持つ。Authorization は付けない
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
        body: file.slice(offset, end),
      });

      if (res.status === 202) {
        // 継続。nextExpectedRanges の先頭（"327680-" や "327680-655359"）が次の開始位置
        const body = (await res.json().catch(() => ({}))) as { nextExpectedRanges?: string[] };
        const next = parseNextOffset(body.nextExpectedRanges) ?? end;
        if (next <= offset) {
          // 進みがない = 同じ断片を送り続けるループになるので、この試行は失敗させて
          // queue のリトライ（新しいセッションでやり直し）に委ねる
          throw new Error("OneDrive upload made no progress");
        }
        offset = Math.min(next, file.size);
        opts?.onProgress?.({ sentBytes: offset, totalBytes: file.size });
        continue;
      }

      if (res.status === 200 || res.status === 201) {
        const json = (await res.json()) as { id: string; name?: string };
        opts?.onProgress?.({ sentBytes: file.size, totalBytes: file.size });
        return { fileId: json.id, name: json.name ?? file.name };
      }

      throw new Error(`OneDrive upload chunk failed (${res.status})`);
    }
    // 全断片を送っても完了の応答が来なかった（通常は到達しない）
    throw new Error("OneDrive upload did not complete");
  }

  /** approot の下に Inbox フォルダを作る（既にあれば 409 でも成功扱い）。 */
  private async createInboxFolder(): Promise<void> {
    const res = await this.graphFetch(`${APPROOT}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: INBOX_FOLDER_NAME,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`OneDrive Inbox folder create failed (${res.status})`);
    }
  }

  /**
   * Authorization 付きの Graph 呼び出し。401 はアクセス用の鍵を捨てて 1 回だけ取り直して
   * 再試行し、それでも 401 なら PushAuthError（queue の中断シグナル）。
   */
  private async graphFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await getValidAccessToken();
    if (!token) {
      throw new PushAuthError("OneDrive is not connected or the token has expired");
    }
    const first = await fetch(url, withBearer(init, token));
    if (first.status !== 401) return first;

    invalidateAccessToken();
    const retryToken = await getValidAccessToken();
    if (!retryToken) {
      throw new PushAuthError("OneDrive rejected the access token (401)");
    }
    const second = await fetch(url, withBearer(init, retryToken));
    if (second.status === 401) {
      invalidateAccessToken();
      throw new PushAuthError("OneDrive rejected the access token (401)");
    }
    return second;
  }
}

function withBearer(init: RequestInit, token: string): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  };
}

/** `["327680-"]` / `["327680-655359"]` から次に送る開始位置を取り出す。無効なら null。 */
function parseNextOffset(ranges: string[] | undefined): number | null {
  const first = ranges?.[0];
  if (!first) return null;
  const match = /^(\d+)-/.exec(first);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
