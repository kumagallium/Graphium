// Google Drive API v3 操作
// ProvNote 専用フォルダ内にノートファイルを保存・読み込み

import { getAccessToken } from "./google-auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "ProvNote";
const MIME_FOLDER = "application/vnd.google-apps.folder";
const MIME_JSON = "application/json";

// ProvNote ファイルのメタデータ
export type ProvNoteFile = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

// ProvNote ファイルの内容（エディタの完全な状態）
export type ProvNoteDocument = {
  version: 1;
  title: string;
  pages: ProvNotePage[];
  createdAt: string;
  modifiedAt: string;
};

export type ProvNotePage = {
  id: string;
  title: string;
  blocks: any[];
  labels: Record<string, string>;
  links: any[];
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

// ProvNote フォルダの ID をキャッシュ
let cachedFolderId: string | null = null;

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
  const query = `'${folderId}' in parents and trashed=false`;
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
  return res.json();
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

// ファイルを削除（ゴミ箱に移動）
export async function deleteFile(fileId: string): Promise<void> {
  await authedFetch(`${DRIVE_API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": MIME_JSON },
    body: JSON.stringify({ trashed: true }),
  });
}

// フォルダIDキャッシュをクリア（サインアウト時に呼ぶ）
export function clearCache(): void {
  cachedFolderId = null;
}
