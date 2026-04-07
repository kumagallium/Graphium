// Google Drive API v3 操作
// ProvNote 専用フォルダ内にノートファイルを保存・読み込み

import { getAccessToken } from "./google-auth";
import type { DocumentProvenance } from "../features/document-provenance/types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "ProvNote";
const UPLOAD_FILES_FOLDER = "uploadFiles";
const MIME_FOLDER = "application/vnd.google-apps.folder";
const MIME_JSON = "application/json";

// ProvNote ファイルのメタデータ
export type ProvNoteFile = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

// ノート間リンク（派生関係）
export type NoteLink = {
  /** リンク先ノートの Google Drive ファイル ID */
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
  scopeType: "heading" | "block";
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

// ProvNote ファイルの内容（エディタの完全な状態）
export type ProvNoteDocument = {
  version: 1 | 2;
  title: string;
  pages: ProvNotePage[];
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
  };
  /** スコープ別 AI チャット履歴 */
  chats?: ScopeChat[];
  /** ドキュメント来歴（編集操作の PROV-DM 記録） */
  documentProvenance?: DocumentProvenance;
  createdAt: string;
  modifiedAt: string;
};

export type ProvNotePage = {
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

// 認証付き fetch
async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
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

// フォルダ ID のキャッシュ
let cachedFolderId: string | null = null;
let cachedUploadFolderId: string | null = null;

// ProvNote 専用フォルダを取得 or 作成
export async function getOrCreateFolder(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  // 既存フォルダを検索
  const query = `name='${FOLDER_NAME}' and mimeType='${MIME_FOLDER}' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }

  // フォルダが無ければ作成
  const createRes = await authedFetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { "Content-Type": MIME_JSON },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: MIME_FOLDER,
    }),
  });
  const folder = await createRes.json();
  cachedFolderId = folder.id;
  return cachedFolderId!;
}

// ProvNote フォルダ内のファイル一覧を取得
export async function listFiles(): Promise<ProvNoteFile[]> {
  const folderId = await getOrCreateFolder();
  const query = `'${folderId}' in parents and mimeType!='${MIME_FOLDER}' and trashed=false`;
  const fields = "files(id,name,modifiedTime,createdTime)";

  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${fields}&orderBy=modifiedTime desc&spaces=drive`
  );
  const data = await res.json();
  return data.files || [];
}

// ファイルの内容を読み込み
export async function loadFile(fileId: string): Promise<ProvNoteDocument> {
  const res = await authedFetch(
    `${DRIVE_API}/files/${fileId}?alt=media`
  );
  const doc: ProvNoteDocument = await res.json();
  return migrateDocument(doc);
}

/** v1 → v2 自動変換: links → provLinks + knowledgeLinks */
function migrateDocument(doc: ProvNoteDocument): ProvNoteDocument {
  for (const page of doc.pages) {
    // 旧 links フィールドが存在し、新フィールドがない場合は変換
    if (page.links && !page.provLinks) {
      const provLinks: any[] = [];
      const knowledgeLinks: any[] = [];
      for (const link of page.links) {
        const isProv = !link.type || [
          "derived_from", "used", "generated", "reproduction_of", "informed_by",
        ].includes(link.type);
        if (isProv) {
          provLinks.push({ ...link, layer: "prov" });
        } else {
          knowledgeLinks.push({ ...link, layer: "knowledge" });
        }
      }
      page.provLinks = provLinks;
      page.knowledgeLinks = knowledgeLinks;
    }
    // デフォルト値を保証
    if (!page.provLinks) page.provLinks = [];
    if (!page.knowledgeLinks) page.knowledgeLinks = [];
  }
  // version を 2 に更新
  doc.version = 2;
  return doc;
}

// 新規ファイルを作成
export async function createFile(
  title: string,
  content: ProvNoteDocument
): Promise<string> {
  const folderId = await getOrCreateFolder();
  const fileName = `${title}.provnote.json`;

  // multipart upload（メタデータ + ファイル内容を一度に送信）
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: MIME_JSON,
  };

  const boundary = "provnote_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(content),
    `--${boundary}--`,
  ].join("\r\n");

  const res = await authedFetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const data = await res.json();
  return data.id;
}

// 既存ファイルを上書き保存（タイトル変更時はファイル名も更新）
export async function saveFile(
  fileId: string,
  content: ProvNoteDocument
): Promise<void> {
  // 1. メタデータ更新（ファイル名）
  const fileName = `${content.title}.provnote.json`;
  await authedFetch(
    `${DRIVE_API}/files/${fileId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": MIME_JSON },
      body: JSON.stringify({ name: fileName }),
    }
  );

  // 2. コンテンツ更新
  await authedFetch(
    `${UPLOAD_API}/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: { "Content-Type": MIME_JSON },
      body: JSON.stringify(content),
    }
  );
}

/** Google Drive Revision の型 */
export type DriveRevision = {
  id: string;
  modifiedTime: string;
};

/** ファイルの最新リビジョン ID を取得 */
export async function getLatestRevisionId(fileId: string): Promise<string | null> {
  try {
    const res = await authedFetch(
      `${DRIVE_API}/files/${fileId}/revisions?fields=revisions(id,modifiedTime)&pageSize=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const revisions: DriveRevision[] = data.revisions ?? [];
    return revisions.length > 0 ? revisions[revisions.length - 1].id : null;
  } catch {
    return null;
  }
}

// ファイルを削除（ゴミ箱に移動）
export async function deleteFile(fileId: string): Promise<void> {
  await authedFetch(`${DRIVE_API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": MIME_JSON },
    body: JSON.stringify({ trashed: true }),
  });
}

// ProvNote/uploadFiles サブフォルダを取得 or 作成
async function getOrCreateUploadFolder(): Promise<string> {
  if (cachedUploadFolderId) return cachedUploadFolderId;

  const parentId = await getOrCreateFolder();

  // 既存サブフォルダを検索
  const query = `name='${UPLOAD_FILES_FOLDER}' and mimeType='${MIME_FOLDER}' and '${parentId}' in parents and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    cachedUploadFolderId = data.files[0].id;
    return cachedUploadFolderId!;
  }

  // フォルダが無ければ作成
  const createRes = await authedFetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { "Content-Type": MIME_JSON },
    body: JSON.stringify({
      name: UPLOAD_FILES_FOLDER,
      parents: [parentId],
      mimeType: MIME_FOLDER,
    }),
  });
  const folder = await createRes.json();
  cachedUploadFolderId = folder.id;
  return cachedUploadFolderId!;
}

/** アップロード結果（URL + メタデータ） */
export type UploadResult = {
  url: string;
  fileId: string;
  name: string;
  mimeType: string;
};

// メディアファイルを Google Drive にアップロードし、公開 URL とメタデータを返す
export async function uploadMediaFile(file: File): Promise<string> {
  const result = await uploadMediaFileWithMeta(file);
  return result.url;
}

// メディアファイルをアップロードし、メタデータ込みの結果を返す（メディアインデックス登録用）
export async function uploadMediaFileWithMeta(file: File): Promise<UploadResult> {
  const uploadFolderId = await getOrCreateUploadFolder();

  // ファイル名にタイムスタンプを付与して一意にする
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const baseName = file.name.includes(".")
    ? file.name.slice(0, file.name.lastIndexOf("."))
    : file.name;
  const uniqueName = `${baseName}_${Date.now()}${ext}`;

  const metadata = {
    name: uniqueName,
    parents: [uploadFolderId],
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: MIME_JSON })
  );
  form.append("file", file);

  const token = getAccessToken();
  if (!token) throw new Error("未認証です。サインインしてください。");

  const res = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`メディアアップロードエラー (${res.status}): ${body}`);
  }

  const data = await res.json();
  const fileId = data.id;

  // 「リンクを知っている全員が閲覧可」に権限設定
  await authedFetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": MIME_JSON },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  // Google の画像配信 CDN URL（公開ファイルの直接表示用）
  const url = `https://lh3.googleusercontent.com/d/${fileId}=s0`;
  return { url, fileId, name: uniqueName, mimeType: file.type };
}

// 認証付きで Drive API からメディアを取得し、Blob URL を返す（動画・音声の再生用）
// lh3.googleusercontent.com の CDN URL は画像専用のため、動画・音声は Drive API 経由で取得する
const blobUrlCache = new Map<string, string>();

export async function fetchMediaBlobUrl(driveFileId: string): Promise<string> {
  const cached = blobUrlCache.get(driveFileId);
  if (cached) return cached;

  const token = getAccessToken();
  if (!token) throw new Error("未認証です");

  const res = await fetch(
    `${DRIVE_API}/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`メディア取得エラー (${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(driveFileId, url);
  return url;
}

// ユーザーメールのキャッシュ
let cachedUserEmail: string | null = null;

/** 現在のユーザーの Google アカウントメールアドレスを取得 */
export async function getUserEmail(): Promise<string | null> {
  if (cachedUserEmail) return cachedUserEmail;
  try {
    const res = await authedFetch(
      "https://www.googleapis.com/oauth2/v2/userinfo?fields=email"
    );
    const data = await res.json();
    cachedUserEmail = data.email ?? null;
    return cachedUserEmail;
  } catch {
    return null;
  }
}

/** CDN URL から Drive ファイル ID を抽出 */
export function extractDriveFileId(url: string): string | null {
  const match = url.match(/googleusercontent\.com\/d\/([^=/?]+)/);
  return match ? match[1] : null;
}

// フォルダIDキャッシュをクリア（サインアウト時に呼ぶ）
export function clearCache(): void {
  cachedFolderId = null;
  cachedUploadFolderId = null;
  cachedUserEmail = null;
  // Blob URL を解放
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}
