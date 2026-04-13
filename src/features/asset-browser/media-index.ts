// .graphium-media-index.json の型定義と Drive 読み書き
// 全メディアファイルのメタデータを1ファイルに集約し、ギャラリー表示を高速化する

import { getActiveProvider } from "../../lib/storage/registry";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".graphium-media-index.json";

// ── 型定義 ──

/** メディアの種類 */
export type MediaType = "image" | "video" | "audio" | "pdf" | "url" | "other";

/** メディアが使用されているノートの情報 */
export type MediaUsage = {
  noteId: string;
  noteTitle: string;
  blockId: string;
};

/** URL ブックマークのメタデータ（type === "url" のとき） */
export type UrlMeta = {
  /** ドメイン名 */
  domain: string;
  /** 説明文（OGP description 等） */
  description?: string;
  /** OGP 画像 URL */
  ogImage?: string;
};

/** メディアインデックスのエントリ */
export type MediaIndexEntry = {
  /** Google Drive ファイル ID（URL ブックマークの場合は生成 ID） */
  fileId: string;
  /** ファイル名（URL ブックマークの場合はタイトル） */
  name: string;
  /** メディアタイプ */
  type: MediaType;
  /** MIME タイプ */
  mimeType: string;
  /** CDN URL（表示用）/ URL ブックマークの場合は外部 URL */
  url: string;
  /** サムネイル URL */
  thumbnailUrl: string;
  /** アップロード日時 / URL 登録日時 */
  uploadedAt: string;
  /** 使用されているノート一覧 */
  usedIn: MediaUsage[];
  /** URL ブックマーク用メタデータ（type === "url" のとき） */
  urlMeta?: UrlMeta;
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

// ストレージプロバイダー経由の認証付き fetch
function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getActiveProvider().authedFetch(url, options);
}

// Graphium フォルダ ID を取得
let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const query = `name='Graphium' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("Graphium フォルダが見つかりません");
}

// インデックスファイル ID のキャッシュ
let cachedIndexFileId: string | null = null;

/** モジュールキャッシュをクリア（サインアウト時に呼ぶ） */
export function clearMediaIndexCache(): void {
  cachedFolderId = null;
  cachedIndexFileId = null;
}

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
  const provider = getActiveProvider();
  if (provider.readAppData) {
    return (await provider.readAppData("media-index")) as MediaIndex | null;
  }
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

/** メディアインデックスを保存（新規作成 or 上書き） */
export async function saveMediaIndex(index: MediaIndex): Promise<void> {
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData("media-index", index);
    return;
  }
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
    const boundary = "graphium_media_index_boundary";
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
  const counts: Record<MediaType, number> = { image: 0, video: 0, audio: 0, pdf: 0, url: 0, other: 0 };
  for (const entry of index.media) {
    counts[entry.type]++;
  }
  return counts;
}

/** メディアファイルの名前を変更 */
export async function renameMediaFile(fileId: string, newName: string): Promise<void> {
  const provider = getActiveProvider();
  if (provider.renameMedia) {
    await provider.renameMedia(fileId, newName);
    return;
  }
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

/** メディアファイルを削除 */
export async function deleteMediaFile(fileId: string): Promise<void> {
  const provider = getActiveProvider();
  if (provider.deleteMedia) {
    await provider.deleteMedia(fileId);
    return;
  }
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

/** アップロード済みメディアファイル一覧を取得 */
async function listUploadFiles(): Promise<{ id: string; name: string; mimeType: string; createdTime: string }[]> {
  // プロバイダーが listMediaFiles をサポートしていればそちらを使う
  const provider = getActiveProvider();
  if (provider.listMediaFiles) {
    return provider.listMediaFiles();
  }
  // Drive API 経由（Google Drive プロバイダー）
  const parentId = await getFolderId();
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

  // 既存の URL ブックマーク（Drive にファイルがないエントリ）を保持
  const existingUrlBookmarks = (existing?.media ?? []).filter((m) => m.type === "url");

  // 既存インデックスがあり、ファイル数が一致し（URL ブックマークを除外して比較）、usedIn も構築済みなら最新とみなす
  const existingMediaCount = (existing?.media.length ?? 0) - existingUrlBookmarks.length;
  if (
    existing &&
    existingMediaCount === driveFiles.length &&
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
  // URL ブックマークを先に追加（Drive ファイルとは別管理）
  media.push(...existingUrlBookmarks);

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

// ── URL ブックマーク ──

/** URL からドメイン名を抽出 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Google Favicon サービスで favicon URL を取得 */
export function getFaviconUrl(domain: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

/** URL のメタデータを取得（OGP タイトル・説明・画像）
 *  CORS エラー等で取得できない場合はドメイン名のみ返す */
export async function fetchUrlMetadata(url: string): Promise<{
  title: string;
  description?: string;
  ogImage?: string;
  domain: string;
}> {
  const domain = extractDomain(url);
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { title: domain, domain };
    const html = await res.text();
    // HTML からメタデータを抽出
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const title = ogTitle || doc.querySelector("title")?.textContent?.trim() || domain;
    const description =
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
      undefined;
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || undefined;
    return { title, description, ogImage, domain };
  } catch {
    // CORS やネットワークエラー → ドメイン名のみ
    return { title: domain, domain };
  }
}

/** URL ブックマーク用のユニーク ID を生成 */
export function generateUrlBookmarkId(): string {
  return `url_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** ノートのブロックからメディア URL → blockId のマップを構築 */
export function extractMediaFromBlocks(blocks: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks) {
    if (
      (block.type === "image" || block.type === "video" || block.type === "audio" || block.type === "file" || block.type === "pdf" || block.type === "bookmark") &&
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
