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
  /**
   * Reader Mode (PR3-d) で抽出した本文の冒頭抜粋。
   * AssetGalleryView の URL カードに表示し、引用元の手がかりにする。
   * optional — 旧データには無くて良い。
   */
  excerpt?: string;
  /**
   * Reader Mode で検出した本文の言語コード（"en" / "ja" 等）。
   * 表示時のフォント切替・i18n 表示の余地として保持。
   */
  lang?: string;
};

/**
 * team-shared storage への共有状態（Phase 2b-media）。
 * data-manifest type の SharedEntry にメディアバイト列が blob として置かれ、
 * その manifest メタデータの id / hash / sharedAt をここに保持する。
 *
 * 既存ユーザーとの後方互換のため optional。Phase 2b-1 と同じ pattern:
 * Settings の identity と email が一致する author 本人のみ更新・unshare 可。
 */
export type MediaSharedRef = {
  /** SharedEntry.id（uuidv7） */
  id: string;
  /**
   * Phase 2b-media:
   * - "data-manifest": バイト列を blob root に持つメディア（image / video / audio / pdf / file）
   * - "reference": URL ブックマーク（バイト不要、メタデータのみ）
   */
  type: "data-manifest" | "reference";
  /** ISO-8601 最終共有日時 */
  sharedAt: string;
  /** 共有時の SharedEntry.hash */
  hash: string;
  /** blob root に保存された実体の SHA-256（data-manifest のときのみ） */
  blobHash?: string;
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
  /** team-shared storage への共有状態（Phase 2b-media、optional） */
  sharedRef?: MediaSharedRef;
  /**
   * このメディアが派生してきた元アセットの fileId 配列（optional）。
   * 例: PDF から抽出した画像は元 PDF の fileId を保持する。
   * MaterialSidePeek の asset graph で「素材同士の派生」を辿るために使う。
   * 既存ユーザー互換のため optional。
   */
  derivedFromAssets?: string[];
};

/** メディアインデックスのスキーマバージョン。
 *  - 1: 初期版（block 由来の usedIn のみ集計）
 *  - 2: document-level の PDF 参照（wikiMeta.derivedFromNotes / sourcePdfFileId）も usedIn に含める
 *    バージョンが古い既存インデックスは ensureMediaIndex で強制再構築する
 */
export const CURRENT_MEDIA_INDEX_VERSION = 2 as const;

/** メディアインデックス全体 */
export type MediaIndex = {
  version: 1 | 2;
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
  return { version: CURRENT_MEDIA_INDEX_VERSION, updatedAt: new Date().toISOString(), media: [] };
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

/**
 * 既存 URL メディアエントリの urlMeta を partial 更新する（PR3-d Phase 4）。
 * Reader Mode で抽出した excerpt / lang を後追いで書き戻す用途。
 *
 * 該当 fileId が無ければ no-op。`type === "url"` 以外のエントリも no-op。
 * 永続化失敗時は warning ログのみで握り潰す（UI 表示には影響しない）。
 */
export async function persistUrlMetaPatch(
  fileId: string,
  patch: Partial<Pick<UrlMeta, "excerpt" | "lang">>,
): Promise<void> {
  if (!patch.excerpt && !patch.lang) return;
  const index = await readMediaIndex();
  if (!index) return;
  let changed = false;
  const nextMedia = index.media.map((m) => {
    if (m.fileId !== fileId || m.type !== "url") return m;
    const nextMeta: UrlMeta = {
      ...(m.urlMeta ?? { domain: extractDomain(m.url) }),
      ...patch,
    };
    // 値が完全に同じなら no-op（無駄な書き込みを避ける）
    if (
      m.urlMeta?.excerpt === nextMeta.excerpt &&
      m.urlMeta?.lang === nextMeta.lang
    ) {
      return m;
    }
    changed = true;
    return { ...m, urlMeta: nextMeta };
  });
  if (!changed) return;
  const next: MediaIndex = {
    ...index,
    updatedAt: new Date().toISOString(),
    media: nextMedia,
  };
  try {
    await saveMediaIndex(next);
  } catch (err) {
    console.warn("urlMeta 書き戻し失敗:", err);
  }
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

/**
 * document-level でメディアを参照していることを示す blockId 番兵。
 *
 * Wiki ノート (`wikiMeta.derivedFromNotes` の `"pdf:{fileId}"`) や
 * PROV ノート (`sourcePdfFileId`) は、PDF を block として埋め込まず
 * ドキュメントレベルのフィールドで参照する。ブロック由来の `MediaUsage`
 * と区別するためにこの値を使う。グラフ表示・ナビゲーションは noteId で
 * 動くため blockId の中身は無関係だが、将来 block にスクロールしたい
 * 用途のために区別を残している。
 */
export const DOC_REF_BLOCK_ID = "__doc_ref__";

/**
 * doc から PDF アセットへの document-level 参照（fileId）を集める。
 * 対象:
 * - Wiki ノートの `wikiMeta.derivedFromNotes` に含まれる `"pdf:{fileId}"`
 * - PROV ノートのトップレベル `sourcePdfFileId`
 */
export function collectPdfFileIdsFromDoc(doc: {
  wikiMeta?: { derivedFromNotes?: string[] } | null | undefined;
  sourcePdfFileId?: string | null | undefined;
}): Set<string> {
  const ids = new Set<string>();
  if (doc.sourcePdfFileId) ids.add(doc.sourcePdfFileId);
  for (const ref of doc.wikiMeta?.derivedFromNotes ?? []) {
    if (typeof ref === "string" && ref.startsWith("pdf:")) {
      const fileId = ref.slice(4);
      if (fileId) ids.add(fileId);
    }
  }
  return ids;
}

/** 特定ノートの usedIn を更新（ノート保存時に呼ぶ） */
export function syncUsedIn(
  index: MediaIndex,
  noteId: string,
  noteTitle: string,
  /** 現在のノートで使われているメディア: { url → blockId } */
  currentMediaMap: Map<string, string>,
  /**
   * 現在のノートが document-level で参照する PDF の fileId 集合
   *  （Wiki の derivedFromNotes "pdf:..." / PROV の sourcePdfFileId）。
   *  ブロック参照と重複した場合はブロック参照の blockId を優先する。
   */
  currentDocRefFileIds: Set<string> = new Set(),
): MediaIndex {
  const media = index.media.map((entry) => {
    const blockId = currentMediaMap.get(entry.url);
    const isDocRef = currentDocRefFileIds.has(entry.fileId);
    if (blockId || isDocRef) {
      // このメディアがノートで使われている → usedIn に追加/更新
      const usedIn = entry.usedIn.filter((u) => u.noteId !== noteId);
      usedIn.push({ noteId, noteTitle, blockId: blockId ?? DOC_REF_BLOCK_ID });
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

/** ensureMediaIndex 内で扱う共通の doc shape（block 走査 + document-level 参照に必要なだけ） */
type IndexableDoc = {
  title: string;
  pages: { blocks: any[] }[];
  wikiMeta?: { derivedFromNotes?: string[] } | null | undefined;
  sourcePdfFileId?: string | null | undefined;
};

/**
 * メディアインデックスの初期構築・同期
 * 既存インデックスが最新かチェックし、古ければ uploadFiles/ を走査して再構築する。
 * さらに全ノート（通常ノート + Wiki ノート）を読み込んで usedIn を構築する。
 *
 * Wiki ノートは PDF を block ではなく `wikiMeta.derivedFromNotes: ["pdf:{fileId}"]`
 * として document-level に持つため、走査対象に含めないと PDF アセットの
 * 利用関係が拾えない。`MediaUsage.noteId` は Wiki ノートの場合 `wiki:{id}` の
 * prefix 付きで格納する（ナビゲーション側で分岐するため）。
 *
 * @param noteFiles - 通常ノートのファイル一覧
 * @param docCache - ドキュメントキャッシュ（Wiki は `wiki:{id}` キー）
 * @param loadFileFn - 通常ノート読み込み関数
 * @param wikiFiles - Wiki ノートのファイル一覧（optional、document-level PDF 参照の集計に使用）
 * @param loadWikiFileFn - Wiki ノート読み込み関数（wikiFiles を渡す場合は必須）
 */
export async function ensureMediaIndex(
  noteFiles: { id: string; name: string }[],
  docCache: Map<string, IndexableDoc>,
  loadFileFn: (fileId: string) => Promise<IndexableDoc>,
  wikiFiles: { id: string; name: string }[] = [],
  loadWikiFileFn?: (fileId: string) => Promise<IndexableDoc>,
): Promise<MediaIndex> {
  const existing = await readMediaIndex();

  // Drive の uploadFiles/ を走査
  const driveFiles = await listUploadFiles();

  // 既存の URL ブックマーク（Drive にファイルがないエントリ）を保持
  const existingUrlBookmarks = (existing?.media ?? []).filter((m) => m.type === "url");

  // 既存インデックスがあり、ファイル数が一致し（URL ブックマークを除外して比較）、usedIn も構築済みなら最新とみなす。
  // ただしスキーマバージョンが旧版（v1: block 由来の usedIn しか集計していない）なら強制再構築する。
  const existingMediaCount = (existing?.media.length ?? 0) - existingUrlBookmarks.length;
  if (
    existing &&
    existing.version === CURRENT_MEDIA_INDEX_VERSION &&
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

  // プロバイダー固有の URL 形式を尊重するため、既存エントリの url/thumbnailUrl はそのまま保持する。
  // 新規エントリ（disk にあるが index にまだ無い）は Drive 互換 URL でフォールバック。
  for (const file of driveFiles) {
    const existingEntry = existingMap.get(file.id);
    const type = existingEntry?.type ?? mimeToMediaType(file.mimeType);

    if (existingEntry) {
      // 既存エントリの URL をそのまま保持（server-fs の media-server:// など）
      media.push({ ...existingEntry, usedIn: [] });
    } else {
      // 新規エントリ: Drive 互換でフォールバック（server-fs/local では使われないはず）
      const thumbnailUrl = type === "image"
        ? `https://lh3.googleusercontent.com/d/${file.id}=s200`
        : `https://drive.google.com/thumbnail?id=${file.id}&sz=s200`;
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

  // URL → index / fileId → index のルックアップテーブル
  const urlToIdx = new Map<string, number>();
  const fileIdToIdx = new Map<string, number>();
  media.forEach((m, i) => {
    urlToIdx.set(m.url, i);
    fileIdToIdx.set(m.fileId, i);
  });

  // 走査対象: 通常ノート + Wiki ノート。
  // Wiki ノートは PDF を document-level (`wikiMeta.derivedFromNotes`) に持つので、
  // ここで一緒に走査して usedIn を埋める。
  // - cacheKey: docCache のキー（Wiki は `wiki:{id}` を使う）
  // - usageNoteId: MediaUsage.noteId に格納する識別子（Wiki は `wiki:{id}` prefix）
  type WalkTarget = {
    id: string;
    cacheKey: string;
    usageNoteId: string;
    load: (id: string) => Promise<IndexableDoc>;
  };
  const walkTargets: WalkTarget[] = [];
  for (const f of noteFiles) {
    walkTargets.push({ id: f.id, cacheKey: f.id, usageNoteId: f.id, load: loadFileFn });
  }
  if (loadWikiFileFn) {
    for (const f of wikiFiles) {
      walkTargets.push({
        id: f.id,
        cacheKey: `wiki:${f.id}`,
        usageNoteId: `wiki:${f.id}`,
        load: loadWikiFileFn,
      });
    }
  }

  for (const target of walkTargets) {
    let doc = docCache.get(target.cacheKey);
    if (!doc) {
      try {
        doc = await target.load(target.id);
        docCache.set(target.cacheKey, doc);
      } catch {
        continue;
      }
    }
    const page = doc.pages[0];
    // どの media に追加済みかを記録（ブロックと document-level の重複排除）
    const addedIdxs = new Set<number>();
    if (page?.blocks) {
      const mediaMap = extractMediaFromBlocks(page.blocks);
      for (const [url, blockId] of mediaMap) {
        const idx = urlToIdx.get(url);
        if (idx !== undefined) {
          media[idx].usedIn.push({
            noteId: target.usageNoteId,
            noteTitle: doc.title,
            blockId,
          });
          addedIdxs.add(idx);
        }
      }
    }
    // Wiki / PROV ノートの document-level PDF 参照を usedIn に反映する。
    // PDF をブロックとして埋め込まないため、ここで補完しないと
    // PDF アセットモーダルの「利用ノート」グラフに表示されない。
    const docPdfRefs = collectPdfFileIdsFromDoc(doc);
    for (const fileId of docPdfRefs) {
      const idx = fileIdToIdx.get(fileId);
      if (idx !== undefined && !addedIdxs.has(idx)) {
        media[idx].usedIn.push({
          noteId: target.usageNoteId,
          noteTitle: doc.title,
          blockId: DOC_REF_BLOCK_ID,
        });
        addedIdxs.add(idx);
      }
    }
  }

  const index: MediaIndex = {
    version: CURRENT_MEDIA_INDEX_VERSION,
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

/** 指定 URL を参照しているメディアブロックの ID リストを返す */
export function findBlockIdsByMediaUrl(blocks: any[], targetUrl: string): string[] {
  const ids: string[] = [];
  const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);
  for (const block of blocks) {
    if (MEDIA_TYPES.has(block.type) && block.props?.url === targetUrl) {
      ids.push(block.id);
    }
    if (block.children?.length) {
      ids.push(...findBlockIdsByMediaUrl(block.children, targetUrl));
    }
  }
  return ids;
}

/** 指定 URL を参照しているメディアブロックの props.name を一括更新する（破壊的） */
export function updateBlockNameByUrl(blocks: any[], targetUrl: string, newName: string): boolean {
  let changed = false;
  const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);
  for (const block of blocks) {
    if (MEDIA_TYPES.has(block.type) && block.props?.url === targetUrl) {
      block.props.name = newName;
      changed = true;
    }
    if (block.children?.length) {
      changed = updateBlockNameByUrl(block.children, targetUrl, newName) || changed;
    }
  }
  return changed;
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
