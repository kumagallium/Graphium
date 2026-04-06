// .provnote-media-index.json の型定義と Drive 読み書き
// 全メディアファイルのメタデータを1ファイルに集約し、ギャラリー表示を高速化する

import { getAccessToken } from "../../lib/google-auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".provnote-media-index.json";

// ── 型定義 ──

/** メディアの種類 */
export type MediaType = "image" | "video" | "audio" | "pdf" | "other";

/** メディアが使用されているノートの情報 */
export type MediaUsage = {
  noteId: string;
  noteTitle: string;
  blockId: string;
};

/** メディアインデックスのエントリ */
export type MediaIndexEntry = {
  /** Google Drive ファイル ID */
  fileId: string;
  /** ファイル名 */
  name: string;
  /** メディアタイプ */
  type: MediaType;
  /** MIME タイプ */
  mimeType: string;
  /** CDN URL（表示用） */
  url: string;
  /** サムネイル URL */
  thumbnailUrl: string;
  /** アップロード日時 */
  uploadedAt: string;
  /** 使用されているノート一覧 */
  usedIn: MediaUsage[];
};

/** メディアインデックス全体 */
export type MediaIndex = {
  version: 1;
  updatedAt: string;
  media: MediaIndexEntry[];
};

// ── MIME → MediaType 変換 ──

export function mimeToMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "other";
}

// ── Drive API ──

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error("未認証です");
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API エラー (${res.status}): ${body}`);
  }
  return res;
}

// ProvNote フォルダ ID を取得
let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const query = `name='ProvNote' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("ProvNote フォルダが見つかりません");
}

// インデックスファイル ID のキャッシュ
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

/** メディアインデックスを読み込み */
export async function readMediaIndex(): Promise<MediaIndex | null> {
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

/** メディアインデックスを保存（新規作成 or 上書き） */
export async function saveMediaIndex(index: MediaIndex): Promise<void> {
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
    const boundary = "provnote_media_index_boundary";
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

/** 空のメディアインデックスを作成 */
export function createEmptyIndex(): MediaIndex {
  return { version: 1, updatedAt: new Date().toISOString(), media: [] };
}

/** メディアエントリを追加 */
export function addMediaEntry(
  index: MediaIndex,
  entry: MediaIndexEntry,
): MediaIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    media: [...index.media, entry],
  };
}

/** メディアエントリを削除 */
export function removeMediaEntry(
  index: MediaIndex,
  fileId: string,
): MediaIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    media: index.media.filter((m) => m.fileId !== fileId),
  };
}

/** 特定ノートの usedIn を更新（ノート保存時に呼ぶ） */
export function syncUsedIn(
  index: MediaIndex,
  noteId: string,
  noteTitle: string,
  /** 現在のノートで使われているメディア: { url → blockId } */
  currentMediaMap: Map<string, string>,
): MediaIndex {
  const media = index.media.map((entry) => {
    const blockId = currentMediaMap.get(entry.url);
    if (blockId) {
      // このメディアがノートで使われている → usedIn に追加/更新
      const usedIn = entry.usedIn.filter((u) => u.noteId !== noteId);
      usedIn.push({ noteId, noteTitle, blockId });
      return { ...entry, usedIn };
    } else {
      // このメディアがノートで使われていない → usedIn から該当ノートを除去
      const usedIn = entry.usedIn.filter((u) => u.noteId !== noteId);
      return { ...entry, usedIn };
    }
  });
  return { ...index, updatedAt: new Date().toISOString(), media };
}

/** 削除されたノートの usedIn を全クリーンアップ */
export function removeNoteFromUsedIn(
  index: MediaIndex,
  noteId: string,
): MediaIndex {
  const media = index.media.map((entry) => ({
    ...entry,
    usedIn: entry.usedIn.filter((u) => u.noteId !== noteId),
  }));
  return { ...index, updatedAt: new Date().toISOString(), media };
}

/** メディアタイプ別にカウント */
export function countByType(index: MediaIndex): Record<MediaType, number> {
  const counts: Record<MediaType, number> = { image: 0, video: 0, audio: 0, pdf: 0, other: 0 };
  for (const entry of index.media) {
    counts[entry.type]++;
  }
  return counts;
}

/** メディアファイルの名前を変更 */
export async function renameMediaFile(fileId: string, newName: string): Promise<void> {
  await authedFetch(`${DRIVE_API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
}

/** メディアインデックス内のエントリ名を更新 */
export function renameMediaEntry(
  index: MediaIndex,
  fileId: string,
  newName: string,
): MediaIndex {
  const media = index.media.map((m) =>
    m.fileId === fileId ? { ...m, name: newName } : m
  );
  return { ...index, updatedAt: new Date().toISOString(), media };
}

/** Drive からメディアファイルを削除 */
export async function deleteMediaFile(fileId: string): Promise<void> {
  await authedFetch(`${DRIVE_API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** CDN URL から Drive ファイル ID を抽出 */
export function extractFileIdFromUrl(url: string): string | null {
  // https://lh3.googleusercontent.com/d/{fileId}=s0
  const match = url.match(/googleusercontent\.com\/d\/([^=/?]+)/);
  return match ? match[1] : null;
}

// ── 初期構築（既存メディアの自動登録） ──

/** Drive の uploadFiles フォルダ内のファイル一覧を取得 */
async function listUploadFiles(): Promise<{ id: string; name: string; mimeType: string; createdTime: string }[]> {
  const parentId = await getFolderId();
  // uploadFiles サブフォルダを検索
  const folderQuery = `name='uploadFiles' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const folderRes = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(folderQuery)}&fields=files(id)&spaces=drive`
  );
  const folderData = await folderRes.json();
  if (!folderData.files?.[0]?.id) return [];

  const uploadFolderId = folderData.files[0].id;
  const query = `'${uploadFolderId}' in parents and trashed=false`;
  const fields = "files(id,name,mimeType,createdTime)";
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${fields}&orderBy=createdTime desc&pageSize=1000&spaces=drive`
  );
  const data = await res.json();
  return data.files || [];
}

/**
 * メディアインデックスの初期構築・同期
 * 既存インデックスが最新かチェックし、古ければ uploadFiles/ を走査して再構築する。
 * さらに全ノートを読み込んで usedIn を構築する。
 *
 * @param noteFiles - Drive のノートファイル一覧（usedIn 構築用に全ノートを読む）
 * @param docCache - ドキュメントキャッシュ（読み込み済みのノートはここから取得）
 * @param loadFileFn - ノート読み込み関数
 */
export async function ensureMediaIndex(
  noteFiles: { id: string; name: string }[],
  docCache: Map<string, { title: string; pages: { blocks: any[] }[] }>,
  loadFileFn: (fileId: string) => Promise<{ title: string; pages: { blocks: any[] }[] }>,
): Promise<MediaIndex> {
  const existing = await readMediaIndex();

  // Drive の uploadFiles/ を走査
  const driveFiles = await listUploadFiles();

  // 既存インデックスがあり、ファイル数が一致し、usedIn も構築済みなら最新とみなす
  if (
    existing &&
    existing.media.length === driveFiles.length &&
    driveFiles.length > 0 &&
    existing.media.some((m) => m.usedIn.length > 0)
  ) {
    return existing;
  }

  // インデックスが存在しない or 古い → 全メディアから構築
  const existingMap = new Map(
    (existing?.media ?? []).map((m) => [m.fileId, m])
  );

  const media: MediaIndexEntry[] = [];
  for (const file of driveFiles) {
    const existingEntry = existingMap.get(file.id);
    const type = existingEntry?.type ?? mimeToMediaType(file.mimeType);
    // 画像は CDN URL、それ以外は Drive の公開サムネイル URL を使う
    const thumbnailUrl = type === "image"
      ? `https://lh3.googleusercontent.com/d/${file.id}=s200`
      : `https://drive.google.com/thumbnail?id=${file.id}&sz=s200`;

    if (existingEntry) {
      media.push({ ...existingEntry, usedIn: [], thumbnailUrl });
    } else {
      const url = `https://lh3.googleusercontent.com/d/${file.id}=s0`;
      media.push({
        fileId: file.id,
        name: file.name,
        type,
        mimeType: file.mimeType,
        url,
        thumbnailUrl,
        uploadedAt: file.createdTime,
        usedIn: [],
      });
    }
  }

  // URL → index のルックアップテーブル
  const urlToIdx = new Map<string, number>();
  media.forEach((m, i) => urlToIdx.set(m.url, i));

  // 全ノートを読み込んで usedIn を構築
  for (const noteFile of noteFiles) {
    let doc = docCache.get(noteFile.id);
    if (!doc) {
      try {
        doc = await loadFileFn(noteFile.id);
        docCache.set(noteFile.id, doc as any);
      } catch {
        continue;
      }
    }
    const page = doc.pages[0];
    if (!page?.blocks) continue;
    const mediaMap = extractMediaFromBlocks(page.blocks);
    for (const [url, blockId] of mediaMap) {
      const idx = urlToIdx.get(url);
      if (idx !== undefined) {
        media[idx].usedIn.push({
          noteId: noteFile.id,
          noteTitle: doc.title,
          blockId,
        });
      }
    }
  }

  const index: MediaIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    media,
  };

  // バックグラウンドで保存
  saveMediaIndex(index).catch((err) => console.warn("メディアインデックス保存失敗:", err));

  return index;
}

/** ノートのブロックからメディア URL → blockId のマップを構築 */
export function extractMediaFromBlocks(blocks: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks) {
    if (
      (block.type === "image" || block.type === "video" || block.type === "audio" || block.type === "file") &&
      block.props?.url
    ) {
      map.set(block.props.url, block.id);
    }
    // 子ブロックも再帰的に走査
    if (block.children?.length) {
      const childMap = extractMediaFromBlocks(block.children);
      for (const [url, id] of childMap) {
        map.set(url, id);
      }
    }
  }
  return map;
}
