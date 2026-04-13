// 付箋キャプチャの軽量インデックス（.graphium-captures.json）
// メディアインデックスと同じパターンで、Google Drive / Local / Filesystem に対応

import { getActiveProvider } from "../../lib/storage/registry";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".graphium-captures.json";

// ── 型定義 ──

/** 付箋キャプチャ1件 */
export type CaptureEntry = {
  /** 一意 ID */
  id: string;
  /** テキスト内容 */
  text: string;
  /** 作成日時 */
  createdAt: string;
  /** 作成者メールアドレス */
  createdBy?: string;
};

/** キャプチャインデックス全体 */
export type CaptureIndex = {
  version: 1;
  updatedAt: string;
  captures: CaptureEntry[];
};

// ── 空インデックス ──

export function createEmptyCaptureIndex(): CaptureIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    captures: [],
  };
}

// ── Drive API（Google Drive プロバイダー用） ──

function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getActiveProvider().authedFetch(url, options);
}

let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  // Graphium フォルダ（旧名 ProvNote からの互換性は google-drive.ts 側で処理済み）
  const query = `(name='Graphium' or name='ProvNote') and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("Graphium フォルダが見つかりません");
}

let cachedIndexFileId: string | null = null;

async function findIndexFileId(): Promise<string | null> {
  if (cachedIndexFileId) return cachedIndexFileId;
  const folderId = await getFolderId();
  const query = `name='${INDEX_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedIndexFileId = data.files[0].id;
    return cachedIndexFileId;
  }
  return null;
}

// ── 読み書き ──

/** キャプチャインデックスを読み込み */
export async function readCaptureIndex(): Promise<CaptureIndex | null> {
  const provider = getActiveProvider();
  if (provider.readAppData) {
    return (await provider.readAppData("captures")) as CaptureIndex | null;
  }
  // Google Drive
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

/** キャプチャインデックスを保存 */
export async function saveCaptureIndex(index: CaptureIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData("captures", index);
    return;
  }
  // Google Drive
  const fileId = await findIndexFileId();
  const body = JSON.stringify(index);

  if (fileId) {
    await authedFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } else {
    const folderId = await getFolderId();
    const boundary = "graphium_captures_boundary";
    const metadata = JSON.stringify({ name: INDEX_FILE_NAME, parents: [folderId] });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;

    const res = await authedFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    const data = await res.json();
    cachedIndexFileId = data.id;
  }
}

// ── CRUD 操作 ──

/** 付箋を追加 */
export function addCapture(index: CaptureIndex, entry: CaptureEntry): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: [entry, ...index.captures],
  };
}

/** 付箋を削除 */
export function removeCapture(index: CaptureIndex, captureId: string): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.filter((c) => c.id !== captureId),
  };
}

/** ID 生成 */
export function generateCaptureId(): string {
  return `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** キャッシュリセット（認証切り替え時） */
export function clearCaptureCache(): void {
  cachedFolderId = null;
  cachedIndexFileId = null;
}
