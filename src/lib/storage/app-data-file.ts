// ──────────────────────────────────────────────
// アプリ付随データ（インデックス類）の読み書き。
//
// 保存先はプロバイダで二分される:
//   - readAppData/writeAppData を持つプロバイダ（local / filesystem / server-fs）
//     → キー指定でそのまま委譲する
//   - Google Drive → Graphium フォルダ直下の隠しファイルを直接読み書きする
//
// note-index / media-index は同等の処理をそれぞれ内側に持っている（歴史的経緯）。
// 新しいインデックスはここを使い、重複をこれ以上増やさない。
// ──────────────────────────────────────────────

import { getActiveProvider } from "./registry";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getActiveProvider().authedFetch(url, options);
}

let cachedFolderId: string | null = null;
const cachedFileIds = new Map<string, string>();

/** サインアウト時にキャッシュを捨てる */
export function clearAppDataFileCache(): void {
  cachedFolderId = null;
  cachedFileIds.clear();
}

async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const query = `name='Graphium' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
  );
  const data = await res.json();
  const id = data.files?.[0]?.id;
  if (!id) throw new Error("Graphium フォルダが見つかりません");
  cachedFolderId = id;
  return id;
}

async function findFileId(driveFileName: string): Promise<string | null> {
  const cached = cachedFileIds.get(driveFileName);
  if (cached) return cached;
  const folderId = await getFolderId();
  const query = `name='${driveFileName}' and '${folderId}' in parents and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
  );
  const data = await res.json();
  const id = data.files?.[0]?.id;
  if (!id) return null;
  cachedFileIds.set(driveFileName, id);
  return id;
}

/**
 * アプリ付随データを読む。存在しなければ null。
 * @param key readAppData 用のキー（プロバイダ側のファイル名になる）
 * @param driveFileName Google Drive でのファイル名（隠しファイル）
 */
export async function readAppDataFile<T>(key: string, driveFileName: string): Promise<T | null> {
  const provider = getActiveProvider();
  if (provider.readAppData) {
    return ((await provider.readAppData(key)) as T | null) ?? null;
  }
  const fileId = await findFileId(driveFileName);
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return (await res.json()) as T;
}

/** アプリ付随データを書く（無ければ作る） */
export async function writeAppDataFile(
  key: string,
  driveFileName: string,
  data: unknown,
): Promise<void> {
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData(key, data);
    return;
  }
  const body = JSON.stringify(data);
  const fileId = await findFileId(driveFileName);
  if (fileId) {
    await authedFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return;
  }
  const folderId = await getFolderId();
  const boundary = "graphium_appdata_boundary";
  const metadata = JSON.stringify({ name: driveFileName, parents: [folderId] });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
    `--${boundary}--`;
  const res = await authedFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  const created = await res.json();
  if (created?.id) cachedFileIds.set(driveFileName, created.id);
}
