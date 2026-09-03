// .graphium-media-index.json の型定義と Drive 読み書き
// 全メディアファイルのメタデータを1ファイルに集約し、ギャラリー表示を高速化する

import { getActiveProvider } from "../../lib/storage/registry";
import { isDelimitedDataFile } from "../data-import/file-kind";
import { normalizeNoteContexts } from "../note-context/context-tags";
// チャートが直接参照する素材（config.assetSources）を利用ノートに数えるため。
// chart-config は純関数の葉モジュールで、こちらへ戻る import は無い
import { collectChartAssetFileIds, parseChartBlockConfig } from "../../blocks/chart/chart-config";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".graphium-media-index.json";

// ── 型定義 ──

/** メディアの種類 */
export type MediaType = "image" | "video" | "audio" | "pdf" | "url" | "document" | "data" | "memo" | "other";

/**
 * 「素材ライブラリ」として扱うドキュメント MIME 一覧。
 * Word/Excel/PowerPoint 系をひとまとめに mediaType="document" として登録し、
 * AssetGalleryView の document タブで一覧できるようにする。
 * PDF は専用 type が既にあるためここには含めない。
 */
const DOCUMENT_MIMES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // .ppt
]);

export function isDocumentMime(mimeType: string): boolean {
  return DOCUMENT_MIMES.has(mimeType);
}

/** Word (.docx) の MIME。埋め込み画像抽出は .docx のみ対応（.doc/.xls/.ppt は非対応）。 */
const WORD_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Word (.docx) 素材かどうか */
export function isWordDocxEntry(entry: { type: MediaType; mimeType: string }): boolean {
  return entry.type === "document" && entry.mimeType === WORD_DOCX_MIME;
}

/**
 * 埋め込み画像抽出（PDF / Word .docx）の対象になる素材か。
 * PDF は pdf-image-extractor、Word は docx-import/extract-images が処理する。
 */
export function canExtractEmbeddedImages(entry: { type: MediaType; mimeType: string }): boolean {
  return entry.type === "pdf" || isWordDocxEntry(entry);
}

/**
 * この素材から既に埋め込み画像を抽出済みか。
 * 抽出された画像は derivedFromAssets に元素材の fileId を持つため、
 * それが 1 つでも index に存在すれば「抽出済み」とみなす。
 * （派生画像をすべて削除すれば再抽出できる状態に戻る）
 */
export function hasExtractedImages(
  entry: { fileId: string },
  index: { media: Array<{ derivedFromAssets?: string[] }> },
): boolean {
  return index.media.some((m) => m.derivedFromAssets?.includes(entry.fileId));
}

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
  /**
   * OGP 画像の URL（取得元の記録）。
   *
   * **描画には使わない。** publisher が自由に書ける値で、しかも CDN・計測ドメインを
   * 指すのが普通なので、そのまま `<img src>` に載せるとカードを描くたびに第三者へ
   * GET が飛ぶ（favicon で閉じたのと同じ経路が og:image で開いたままだった）。
   * 実際に描くのは下の `previewImage`（ローカルにキャッシュした実体）だけ。
   * ここに残すのは「どこから取ったか」の来歴と、キャッシュの取得元としての用途。
   */
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
  /**
   * Reader Mode で抽出した記事内の代表画像 URL（取得元の記録）。
   * `ogImage` と同じく**描画には使わない** — キャッシュ元としてだけ使い、
   * `ogImage` より優先する（記事固有の hero の方が中身を表すため）。
   */
  leadImage?: string;
  /**
   * ローカルにキャッシュしたプレビュー画像への参照。**描画に使うのはこれだけ。**
   *
   * 形式は `"media-text:<key>"` のみで、http(s) の URL は構造上ここに入らない
   * （入っていたら normalizeMediaIndexEntry が読み込み時に落とす）。実体は
   * `provider.loadMediaText(key)` が返す `data:image/...` の data URL で、
   * バイト列は登録時に一度だけ sidecar の image-proxy 経由で取得している。
   * 取得・保存できなかった場合は undefined のままで、描画側は favicon に落ちる
   * （リモート URL には**絶対に**フォールバックしない）。
   */
  previewImage?: string;
  /**
   * プレビュー画像の取得を最後に試みた時刻（ISO-8601）。
   * 成功・失敗どちらでも入れて、失敗したブックマークを毎回叩き直さないための間引きに使う。
   */
  previewImageAt?: string;
  /**
   * サイト自身が `<link rel="icon">` 等で宣言している favicon の絶対 URL。
   * favicon は第三者サービス（Google の favicon API 等）を一切経由せず、
   * ブックマーク先のサイトからのみ取得する。fetchUrlMetadata が登録時に拾う。
   * ページと別オリジンを指す宣言アイコンは保存しない（他所へのビーコンになるため）。
   * 未取得（旧データ・CORS 失敗・別オリジン）なら undefined で、
   * `https://<host>/favicon.ico` にフォールバックする。
   */
  faviconUrl?: string;
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
  /**
   * 実体バイト列の SHA-256（`"sha256:<hex>"`、optional）。
   *
   * 同じファイルを二度素材にしないための一次キー。アップロード時に計算して持たせ、
   * 次のアップロードは index 内の突き合わせだけで既存素材を見つけられる（実体を
   * 読み直さない）。画像は `IMG_0001.jpg` のように「同名で別物」「別名で同一」が
   * 普通にあるので、名前ではなく中身で判定する。
   *
   * 持たない素材がある:
   *   - この仕組みより前にアップロードした既存素材（起動後の後追い付与で埋まる）
   *   - URL ブックマーク（実体が無い）
   *   - 実体が大きすぎてハッシュ計算を見送ったもの（`dedupe.ts` の上限参照）
   * いずれも「判定できない」であって「別物」ではないため、重複判定は
   * ハッシュを持つ素材どうしでしか行わない。
   */
  contentHash?: string;
  /** URL ブックマーク用メタデータ（type === "url" のとき） */
  urlMeta?: UrlMeta;
  /**
   * 画像から端末内 OCR で読み取ったテキスト（type === "image" のとき）。
   *
   * 素材そのものに紐づく写し。読み取りの出どころは 2 つあり、どちらもここに集まる:
   *   - 素材ギャラリーから直接読んだ結果（`persistOcrTextPatch`）
   *   - ノートに貼った画像を読んだ結果（`page.mediaOcr` のブロック単位注釈からの写し。
   *     OCR 実行時に `mirrorOcrToMediaIndex` が書き戻し、既存分は v5 の再構築で回収する）
   *
   * ブロック単位の正は `page.mediaOcr` のままで、こちらは素材横断で探すための索引。
   * これにより「どのノートにも貼られていない画像」も「ノートに貼った画像」も、
   * 素材ギャラリーと Cmd+K から同じように文字で引ける。
   * optional なので既存インデックスはそのまま読める。
   */
  ocrText?: string;
  /**
   * メモピーク用の本文（type === "memo" のとき）。
   * buildMemoPeekEntry が組む transient エントリ専用で、media-index には保存されない。
   */
  memoText?: string;
  /** team-shared storage への共有状態（Phase 2b-media、optional） */
  sharedRef?: MediaSharedRef;
  /**
   * このメディアが派生してきた元アセットの fileId 配列（optional）。
   * 例: PDF から抽出した画像は元 PDF の fileId を保持する。
   * MaterialSidePeek の asset graph で「素材同士の派生」を辿るために使う。
   * 既存ユーザー互換のため optional。
   */
  derivedFromAssets?: string[];
  /**
   * アーカイブ日時（ISO 8601、optional）。設定されている素材はギャラリー・
   * ピッカー・タイプ別件数から隠れるが、バイナリと URL 解決はそのまま残り、
   * 既存ノート・版スナップショットの中では表示され続ける（ノートのアーカイブと
   * 同じ soft-delete 思想）。ensureMediaIndex の再構築は既存 entry を spread で
   * 温存するため、note-index のような明示的な引き継ぎ処理は不要。
   */
  archivedAt?: string;
  /**
   * モバイル受信箱（同期フォルダ <root>/Inbox/）から取り込んだときの来歴メタ(optional)。
   * 取り込み済み素材は「もはやモバイルのものではない」= 一覧上は普通の素材として扱うが、
   * どこから来たかという来歴は残す（PROV 思想）。既存素材は持たない（後方互換）。
   * 設計: docs/internal/mobile-capture-transport-design-2026-07.md §7
   */
  capture?: import("../mobile-capture/inbox/types").CaptureMeta;
  /**
   * 素材が入っているフォルダ。ノートと同じ noteContexts の体系を共有する
   * （「材料X」フォルダにノートも画像も入る）。
   *
   * 人が付ける情報で、ノートからは導けない。ensureMediaIndex の再構築は既存エントリを
   * 土台に usedIn などを埋め直すだけなので、ここは温存される（#699 の「再構築は自分が
   * 知らない情報を上書きしない」性質）。
   *
   * 再構築で回収できる類の情報ではないため、スキーマ版は上げない — 上げても得るものが
   * 無く、全ユーザーに無駄な全走査を強いるだけになる。古いインデックスはこの欄を
   * 持たないだけで、そのまま読める（optional・後方互換）。
   */
  noteContexts?: string[];
};

/**
 * この素材が受信箱経由で取り込まれたものか（capture 来歴メタを持つか）。
 * 一覧の絞り込みには使わない（振り分け後は普通の素材）。詳細表示など
 * 「出自を知りたい」場面のための単一述語。
 */
export function isMobileCapture(entry: MediaIndexEntry): boolean {
  return entry.capture != null;
}

/** メディアインデックスのスキーマバージョン。
 *  - 1: 初期版（block 由来の usedIn のみ集計）
 *  - 2: document-level の PDF 参照（wikiMeta.derivedFromNotes / sourcePdfFileId）も usedIn に含める
 *  - 3: URL 素材の利用も usedIn に含める（本文中のインラインリンク + document-level の
 *       URL 出典 sourceUrl / derivedFromNotes の "url:"）。これにより URL も画像・PDF と
 *       同じくアセットグラフに出るようになり、素材タイプ間で UI が一貫する
 *  - 4: 再構築時に URL ブックマークの usedIn もリセットして再集計する（v3 までは既存の
 *       usedIn を温存したまま全ノート走査で再 push していたため、再構築のたびに同一
 *       noteId+blockId の usage が積み上がっていた）。bump により壊れた既存インデックスを
 *       強制再構築して重複を解消する
 *  - 5: ノートに貼った画像の OCR テキスト（`page.mediaOcr`）を素材側の `ocrText` にも
 *       集約する。v4 までは素材ギャラリーから読んだ分しか素材に紐づかず、ノートで
 *       読んだ画像は素材横断の検索から漏れていた。bump により既存ユーザーの
 *       読み取り済みテキストを一度の再構築で回収する
 *  - 6: チャートが直接描いているデータ素材（chart ブロックの config.assetSources）と、
 *       取り込んだ表の元ファイル（tableMeta.source.fileId）を usedIn に含める。
 *       どちらも表のセルやブロックの url に痕跡が残らない参照なので、ブロック走査では
 *       拾えない。bump により既存ノートの参照を一度の再構築で回収する
 *  - 7: インライン画像（inlineImage — セルや本文の行内に埋めた画像素材）の fileId を
 *       usedIn に含める。ブロックの url ではなく inline props の参照なので、これを
 *       入れないと「セルにだけ貼った画像」が未使用扱いになり、削除前の参照チェックを
 *       すり抜ける。bump により既存ノートの参照を一度の再構築で回収する
 *    バージョンが古い既存インデックスは ensureMediaIndex で強制再構築する
 */
export const CURRENT_MEDIA_INDEX_VERSION = 7 as const;

/** メディアインデックス全体 */
export type MediaIndex = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  updatedAt: string;
  media: MediaIndexEntry[];
};

// ── MIME → MediaType 変換 ──

/**
 * MIME（と分かればファイル名）から素材の種類を決める。
 *
 * 装置が吐く .dat / .txt は MIME が text/plain や空、application/octet-stream と
 * まちまちで、MIME だけでは "other" に落ちて素材一覧から消える。名前が分かる場合は
 * 拡張子で "data" に振り分ける。読む物（PDF / Word）とは用途が違い、表にして
 * 使うものなので、素材一覧でも別の棚に置く。
 */
export function mimeToMediaType(mimeType: string, fileName?: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (fileName && isDelimitedDataFile(fileName)) return "data";
  if (isDocumentMime(mimeType)) return "document";
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

/**
 * アプリが知っている最新のインデックス。
 *
 * インデックスの更新はどこも「今の index を読む → 書き換える → 保存する」の形で、
 * 保存はほぼ全ての呼び出し元で fire-and-forget（await しない）。そのため保存が
 * 飛んでいる最中にディスクを読むと、**書いたばかりの内容を知らない土台**の上で
 * 次の更新が組み立てられ、上書きで消える。ノート保存を契機に走る
 * `ensureMediaIndex` が、アップロード直後のエントリを落としていたのがこれ。
 *
 * `saveMediaIndex` が保存を投げる前に同期的にここへ控え、読み手はまずこれを見る。
 * 別ウィンドウなどディスク側が先に進んでいる場合もあるので、`readMediaIndex` は
 * `updatedAt` で新しい方を選ぶ。
 */
let latestIndex: MediaIndex | null = null;

/**
 * 保存中のものも含めた「アプリが知っている最新のインデックス」を同期的に返す。
 * ディスク読み込みを挟まずに土台を取り直したい場面（`ensureMediaIndex` の
 * 走査後など）で使う。まだ一度も読み書きしていなければ null。
 */
export function getLatestMediaIndex(): MediaIndex | null {
  return latestIndex;
}

/** モジュールキャッシュをクリア（サインアウト時に呼ぶ） */
export function clearMediaIndexCache(): void {
  cachedFolderId = null;
  cachedIndexFileId = null;
  latestIndex = null;
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

/**
 * ディスク上のインデックスをそのまま読む（`latestIndex` を見ない）。
 *
 * 読んだ内容は normalizeMediaIndex に通す。旧バージョンは第三者 favicon サービスの
 * URL（クエリにホスト名を載せる形）を thumbnailUrl / urlMeta.faviconUrl として
 * **永続化していた**ので、コードを直すだけでは既存の素材を表示するたびにそこへ
 * ホスト名が送られ続ける。ディスクの中身がプロセスに入る経路はここだけなので、
 * 読み込み側の正規化もここ 1 箇所でよい。
 */
async function readStoredMediaIndex(): Promise<MediaIndex | null> {
  const provider = getActiveProvider();
  if (provider.readAppData) {
    const data = (await provider.readAppData("media-index")) as MediaIndex | null;
    return data ? normalizeMediaIndex(data) : null;
  }
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  const data = (await res.json()) as MediaIndex | null;
  return data ? normalizeMediaIndex(data) : null;
}

/**
 * メディアインデックスを読み込み。
 *
 * ディスクと `latestIndex`（保存中のものを含む最新）を突き合わせ、新しい方を返す。
 * ディスクだけを見ると、保存が飛んでいる最中の更新をなかったことにしてしまう。
 * `updatedAt` は全ての更新ヘルパが付け直す ISO-8601 なので、文字列比較で足りる。
 *
 * どちらを返す場合も中身は正規化済み: ディスク由来は readStoredMediaIndex が、
 * `latestIndex` は saveMediaIndex が控える前に normalizeMediaIndex を通している。
 * キャッシュを返す枝だけ素通しになると、旧データを読んだ直後の保存以降ずっと
 * 第三者 favicon URL が消費者へ渡り続けることになるため。
 */
export async function readMediaIndex(): Promise<MediaIndex | null> {
  const stored = await readStoredMediaIndex();
  if (latestIndex && (!stored || stored.updatedAt <= latestIndex.updatedAt)) {
    return latestIndex;
  }
  latestIndex = stored;
  return stored;
}

/**
 * メディアインデックスを保存（新規作成 or 上書き）。
 *
 * 保存するのは normalizeMediaIndex を通した版。`latestIndex` に控えるのも同じ値なので、
 * readMediaIndex がディスクを飛ばしてキャッシュを返す枝でも第三者 favicon URL や
 * 非ローカルの previewImage は消費者に渡らない。書き換えるところが無ければ
 * normalizeMediaIndex は引数のオブジェクトをそのまま返す（同一性は保たれる）。
 */
export async function saveMediaIndex(index: MediaIndex): Promise<void> {
  const normalized = normalizeMediaIndex(index);
  // 書き込みを投げる前に同期的に控える。ここを await の後ろに置くと、
  // 保存を待っている間に読んだ相手が古い土台の上で更新を組み立ててしまう。
  latestIndex = normalized;
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData("media-index", normalized);
    return;
  }
  const fileId = await findIndexFileId();
  const body = JSON.stringify(normalized);

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

/** persistUrlMetaPatch で後追い更新できる urlMeta のフィールド。 */
export type UrlMetaPatch = Partial<
  Pick<UrlMeta, "excerpt" | "lang" | "leadImage" | "previewImage" | "previewImageAt">
>;

/**
 * 既存 URL メディアエントリの urlMeta を partial 更新する（PR3-d Phase 4）。
 * Reader Mode で抽出した excerpt / lang / leadImage と、後追いでキャッシュした
 * previewImage を書き戻す用途。
 *
 * 該当 fileId が無ければ no-op。`type === "url"` 以外のエントリも no-op。
 * 永続化失敗時は warning ログのみで握り潰す（UI 表示には影響しない）。
 *
 * @returns 実際にインデックスへ反映できたら true。呼び出し側が「エントリがまだ
 *          index に載っていなかった」を検出してリトライできるようにするため
 *          （登録直後の書き戻しは保存レースになり得る）。
 */
export async function persistUrlMetaPatch(
  fileId: string,
  patch: UrlMetaPatch,
): Promise<boolean> {
  if (
    !patch.excerpt &&
    !patch.lang &&
    !patch.leadImage &&
    !patch.previewImage &&
    !patch.previewImageAt
  ) {
    return false;
  }
  const index = await readMediaIndex();
  if (!index) return false;
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
      m.urlMeta?.lang === nextMeta.lang &&
      m.urlMeta?.leadImage === nextMeta.leadImage &&
      m.urlMeta?.previewImage === nextMeta.previewImage &&
      m.urlMeta?.previewImageAt === nextMeta.previewImageAt
    ) {
      return m;
    }
    changed = true;
    return { ...m, urlMeta: nextMeta };
  });
  if (!changed) return false;
  const next: MediaIndex = {
    ...index,
    updatedAt: new Date().toISOString(),
    media: nextMedia,
  };
  try {
    await saveMediaIndex(next);
    // in-memory の useFileManager.mediaIndex が disk と乖離しないよう、
    // 再読込トリガを broadcast する。リスナは useFileManager 側。
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "urlMeta-patch", fileId } }),
      );
    }
    return true;
  } catch (err) {
    console.warn("urlMeta 書き戻し失敗:", err);
    return false;
  }
}

/**
 * 画像の OCR テキストを media-index に書き戻す。
 *
 * 呼び出し元は 2 つ:
 *   - 素材ギャラリー / 素材ピークからの読み取り（そこが唯一の保存先）
 *   - ノートに貼った画像の読み取り（正は `page.mediaOcr`。ここへは
 *     `mirrorOcrToMediaIndex` 経由で写しを置き、素材横断で探せるようにする）
 */
export async function persistOcrTextPatch(
  fileId: string,
  ocrText: string,
): Promise<void> {
  const index = await readMediaIndex();
  if (!index) return;
  const text = ocrText.trim();
  let changed = false;
  const nextMedia = index.media.map((m) => {
    if (m.fileId !== fileId) return m;
    // 同じ値なら書き込まない（無駄な保存とイベントを避ける）
    if ((m.ocrText ?? "") === text) return m;
    changed = true;
    // 空文字は「読んだが文字が無かった」なのでキー自体を落とす
    if (!text) {
      const { ocrText: _omit, ...rest } = m;
      return rest;
    }
    return { ...m, ocrText: text };
  });
  if (!changed) return;
  const next: MediaIndex = {
    ...index,
    updatedAt: new Date().toISOString(),
    media: nextMedia,
  };
  try {
    await saveMediaIndex(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "ocr-patch", fileId } }),
      );
    }
  } catch (err) {
    console.warn("OCR テキストの書き戻しに失敗:", err);
  }
}

/**
 * メディアインデックスが外部で書き換えられたことを伝えるイベント名。
 * `persistUrlMetaPatch` 等の disk 経由更新が in-memory state と
 * 乖離しないよう、useFileManager が listen して `refreshMediaIndex` を呼ぶ。
 */
export const MEDIA_INDEX_CHANGED_EVENT = "graphium:media-index-changed";

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

/**
 * doc から「素材ライブラリ」全般への document-level 参照（fileId）を集める。
 * PDF と Document（.docx 等）を一緒に扱う。
 *
 * 対象:
 * - PROV ノートのトップレベル `sourcePdfFileId`（PDF 派生）
 * - 素材ライブラリ経由で取り込んだノートのトップレベル `sourceDocumentFileId`（Word 等）
 * - Wiki ノートの `wikiMeta.derivedFromNotes` 内の `"pdf:{fileId}"`
 *
 * `collectPdfFileIdsFromDoc` の上位互換。新規呼び出しはこちらを使う。
 */
export function collectSourceAssetFileIdsFromDoc(doc: {
  wikiMeta?: { derivedFromNotes?: string[] } | null | undefined;
  sourcePdfFileId?: string | null | undefined;
  sourceDocumentFileId?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  citedAssetFileIds?: string[] | null | undefined;
  sourceTextFileId?: string | null | undefined;
  pages?:
    | Array<{
        tableMeta?: Record<string, { source?: { fileId?: string } }> | null;
        blocks?: any[] | null;
      }>
    | null
    | undefined;
}): Set<string> {
  const ids = collectPdfFileIdsFromDoc(doc);
  if (doc.sourceDocumentFileId) ids.add(doc.sourceDocumentFileId);
  // URL 原文テキスト（B-persist）。これを入れないと原文テキスト素材だけ usedIn が
  // 空になり、削除前の参照チェックをすり抜ける。
  if (doc.sourceTextFileId) ids.add(doc.sourceTextFileId);
  // @リンク（@mention / メディアピッカーのリンク挿入）で引用した素材。
  // citedAssetFileIds は素材本体の fileId（URL 素材は "url:<生URL>"）なので、
  // そのまま usedIn のキーに使える。これを入れないと「リンクで挿入した素材」だけ
  // 埋め込みと違って usedIn に入らず、近接グラフ・アセットグラフに出ない不一致になる。
  for (const fid of doc.citedAssetFileIds ?? []) {
    if (typeof fid === "string" && fid) ids.add(fid);
  }
  // URL 素材を出典に持つノート（PROV / 翻訳 / Knowledge）。URL 素材の fileId は
  // "url:<生URL>" 形式（external-source.ts の規約）なので、それに合わせて prefix
  // 付きで集める。これを入れないと URL 素材だけ「利用ノート」が空になり、
  // 画像・PDF と違ってアセットグラフが出ない不一致になる。
  if (doc.sourceUrl) ids.add(`url:${doc.sourceUrl}`);
  for (const ref of doc.wikiMeta?.derivedFromNotes ?? []) {
    // derivedFromNotes の "url:<生URL>" は URL 素材の fileId とそのまま一致する。
    if (typeof ref === "string" && ref.startsWith("url:") && ref.length > "url:".length) {
      ids.add(ref);
    }
  }
  // 区切りテキストから取り込んだテーブルの元ファイル（tableMeta.source.fileId）。
  // 表のセルにはファイルの痕跡が残らないため、ブロック走査では拾えない。これを
  // 入れないと元データだけ「利用ノート」が空になり、アセットグラフにも出ないうえ、
  // 削除前の参照チェックをすり抜けて表の出所が消える。
  for (const page of doc.pages ?? []) {
    for (const meta of Object.values(page?.tableMeta ?? {})) {
      const fileId = meta?.source?.fileId;
      if (fileId) ids.add(fileId);
    }
    // チャートが素材のデータを直接描いている場合（config.assetSources）。表を経由しない
    // ので tableMeta には出てこない。これを入れないと、別のノートの図に重ねただけの
    // 素材は「利用ノート」が空のままになり、削除前の参照チェックもすり抜けて図が消える
    for (const fileId of collectChartAssetFileIdsFromBlocks(page?.blocks ?? [])) ids.add(fileId);
    // セル・本文の行内に埋めたインライン画像（inlineImage）。ブロックの url ではなく
    // inline props の参照なので、ブロック走査（url 抽出）では拾えない
    for (const fileId of collectInlineImageFileIdsFromBlocks(page?.blocks ?? [])) ids.add(fileId);
  }
  return ids;
}

/** ブロック木（セル内・子ブロック・カラム内も含む）からインライン画像の fileId を集める */
export function collectInlineImageFileIdsFromBlocks(blocks: any[]): Set<string> {
  const ids = new Set<string>();
  const visitInline = (content: any) => {
    if (!content) return;
    if (Array.isArray(content)) {
      for (const item of content) visitInline(item);
      return;
    }
    if (typeof content !== "object") return;
    if (content.type === "inlineImage") {
      const fileId = content.props?.fileId;
      if (typeof fileId === "string" && fileId) ids.add(fileId);
    }
    // link の中身・tableCell の content・tableContent の rows/cells を辿る
    if (Array.isArray(content.content)) visitInline(content.content);
    if (Array.isArray(content.rows)) {
      for (const row of content.rows) for (const cell of row?.cells ?? []) visitInline(cell);
    }
  };
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      visitInline(b.content);
      if (Array.isArray(b.children)) visit(b.children);
    }
  };
  visit(blocks);
  return ids;
}

/** ブロック木（子ブロック・カラム内も含む）から chart ブロックの素材参照を集める */
export function collectChartAssetFileIdsFromBlocks(blocks: any[]): Set<string> {
  const ids = new Set<string>();
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "chart") {
        const config = parseChartBlockConfig(
          String(b.props?.config ?? ""),
          String(b.props?.sourceBlockId ?? ""),
        );
        for (const fileId of collectChartAssetFileIds(config)) ids.add(fileId);
      }
      if (Array.isArray(b.children)) visit(b.children);
    }
  };
  visit(blocks);
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

/** メディアタイプ別にカウント（アーカイブ済みは一覧同様に数えない） */
export function countByType(index: MediaIndex): Record<MediaType, number> {
  const counts: Record<MediaType, number> = { image: 0, video: 0, audio: 0, pdf: 0, url: 0, document: 0, data: 0, memo: 0, other: 0 };
  for (const entry of index.media) {
    if (entry.archivedAt) continue;
    counts[entry.type]++;
  }
  return counts;
}

/** メディアをアーカイブする（一覧から隠すがバイナリ・URL 解決・usedIn は生かす） */
export function archiveMediaEntry(index: MediaIndex, fileId: string): MediaIndex {
  const media = index.media.map((entry) =>
    entry.fileId === fileId ? { ...entry, archivedAt: new Date().toISOString() } : entry,
  );
  return { ...index, updatedAt: new Date().toISOString(), media };
}

/** アーカイブ済みメディアを一覧に復元する */
export function restoreMediaEntry(index: MediaIndex, fileId: string): MediaIndex {
  const media = index.media.map((entry) => {
    if (entry.fileId !== fileId) return entry;
    const { archivedAt: _archivedAt, ...rest } = entry;
    return rest;
  });
  return { ...index, updatedAt: new Date().toISOString(), media };
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

/**
 * 素材のフォルダ（noteContexts）を差し替える。ノート側の updateNoteContexts に相当する。
 * 正規化はノートと共通の normalizeNoteContexts に任せ、同じ名寄せ規則（小文字比較・
 * 表示は初出の形）で揃える。空になったら欄ごと落とす。
 */
export function setMediaEntryContexts(
  index: MediaIndex,
  fileId: string,
  contexts: readonly string[],
): MediaIndex {
  const next = normalizeNoteContexts([...contexts]);
  const media = index.media.map((m) =>
    m.fileId === fileId ? { ...m, noteContexts: next } : m,
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
  /** mediaOcr は画像ブロックの OCR 結果（blockId → 抽出テキスト）。素材側の ocrText 集約に使う */
  pages: {
    blocks: any[];
    mediaOcr?: Record<string, { text?: string }> | undefined;
    /** 取り込みで作られたテーブルの出所（元ファイルの fileId を持つ） */
    tableMeta?: Record<string, { source?: { fileId?: string } }> | undefined;
  }[];
  wikiMeta?: { derivedFromNotes?: string[] } | null | undefined;
  sourcePdfFileId?: string | null | undefined;
  sourceDocumentFileId?: string | null | undefined;
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
 * **全ノート走査は秒単位かかり、その間にアップロード・削除が走りうる**。そのため
 * ここが作るのは「エントリの完成品」ではなく、走査で分かること（素材ごとの
 * usedIn と、ノートで読んだ OCR テキスト）だけを集めたパッチである。エントリ
 * そのものの土台は走査を終えた時点の最新インデックス（`getLatestMediaIndex`）から
 * 取り直し、そこへパッチを当てる。走査開始時のスナップショットに当ててしまうと、
 * 走査中にアップロードされた素材とその付加情報（`contentHash` など）が消える。
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

  // 走査の土台。ここでの並びが最終的なエントリの並びになる。
  const scanned: MediaIndexEntry[] = [];
  // URL ブックマークを先に追加（Drive ファイルとは別管理）。
  // usedIn は Drive ファイルと同様に一旦リセットし、後段の全ノート走査で埋め直す
  //（リセットは後段の組み立てで行う）。温存すると走査の再 push で同じ usage が
  // 重複し、再構築のたびに積み上がる。
  scanned.push(...existingUrlBookmarks);

  // プロバイダー固有の URL 形式を尊重するため、既存エントリの url/thumbnailUrl はそのまま保持する。
  // 新規エントリ（disk にあるが index にまだ無い）は Drive 互換 URL でフォールバック。
  for (const file of driveFiles) {
    const existingEntry = existingMap.get(file.id);
    const type = existingEntry?.type ?? mimeToMediaType(file.mimeType, file.name);

    if (existingEntry) {
      // 既存エントリの URL をそのまま保持（server-fs の media-server:// など）
      scanned.push(existingEntry);
    } else {
      // 新規エントリ: Drive 互換でフォールバック（server-fs/local では使われないはず）
      const thumbnailUrl = type === "image"
        ? `https://lh3.googleusercontent.com/d/${file.id}=s200`
        : `https://drive.google.com/thumbnail?id=${file.id}&sz=s200`;
      const url = `https://lh3.googleusercontent.com/d/${file.id}=s0`;
      scanned.push({
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

  // URL → fileId のルックアップ。走査の成果は fileId で持つ（エントリの実体は
  // 走査後に取り直すため、配列 index で参照すると付け替えられなくなる）。
  const urlToFileId = new Map<string, string>();
  const scannedFileIds = new Set<string>();
  for (const m of scanned) {
    urlToFileId.set(m.url, m.fileId);
    scannedFileIds.add(m.fileId);
  }
  // 走査で集めるのはこの 2 つだけ
  const usageByFileId = new Map<string, MediaUsage[]>();
  const ocrByFileId = new Map<string, string>();

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
    const noteTitle = doc.title;
    // どの素材に追加済みかを記録（ブロックと document-level の重複排除）
    const addedFileIds = new Set<string>();
    const addUsage = (fileId: string, blockId: string) => {
      const usage: MediaUsage = { noteId: target.usageNoteId, noteTitle, blockId };
      const usages = usageByFileId.get(fileId);
      if (usages) usages.push(usage);
      else usageByFileId.set(fileId, [usage]);
      addedFileIds.add(fileId);
    };
    if (page?.blocks) {
      const mediaMap = extractMediaFromBlocks(page.blocks);
      for (const [url, blockId] of mediaMap) {
        const fileId = urlToFileId.get(url);
        if (fileId !== undefined) {
          addUsage(fileId, blockId);
          // ノートで読んだ OCR テキストを素材側にも写す（v5）。
          // 素材ギャラリーから直接読んだ既存の ocrText は上書きしない
          // — ユーザーが素材そのものに対して明示的に取った結果を正とする
          //（上書きしない判定は、実体を組み立てる後段で行う）。
          const noteOcr = page.mediaOcr?.[blockId]?.text?.trim();
          if (noteOcr && !ocrByFileId.has(fileId)) {
            ocrByFileId.set(fileId, noteOcr);
          }
        }
      }
    }
    // Wiki / PROV / Document 素材由来ノートの document-level 参照を usedIn に反映する。
    // PDF や .docx をブロックとして埋め込まない経路でも、ここで補完しないと
    // 素材モーダルの「利用ノート」グラフに表示されない。
    const docAssetRefs = collectSourceAssetFileIdsFromDoc(doc);
    for (const fileId of docAssetRefs) {
      if (scannedFileIds.has(fileId) && !addedFileIds.has(fileId)) {
        addUsage(fileId, DOC_REF_BLOCK_ID);
      }
    }
  }

  // ── 走査の成果を、走査後の最新インデックスに当てる ──
  //
  // 走査中にアップロード・削除が走っていることがある。走査開始時のスナップショット
  // （`existing`）にそのまま当てると、その間に増えた素材と付加情報が消える。
  const latest = getLatestMediaIndex() ?? existing;
  const latestMap = new Map((latest?.media ?? []).map((m) => [m.fileId, m]));
  // 走査開始時点で index が知っていた素材。実体が無いのが「消えた」なのか
  // 「まだ listing に載っていない新顔」なのかを分けるために使う。
  const knownBefore = new Set(existingMap.keys());

  const media: MediaIndexEntry[] = [];
  const withScanResult = (entry: MediaIndexEntry): MediaIndexEntry => {
    // 走査対象外だったエントリ（走査中に増えた素材）は usedIn を触らない。
    // リセットすると、その素材を貼ったノートの保存が直前に書いた usedIn を消す。
    if (!scannedFileIds.has(entry.fileId)) return entry;
    const noteOcr = ocrByFileId.get(entry.fileId);
    const next: MediaIndexEntry = { ...entry, usedIn: usageByFileId.get(entry.fileId) ?? [] };
    if (noteOcr && !next.ocrText) next.ocrText = noteOcr;
    return next;
  };

  for (const entry of scanned) {
    const live = latestMap.get(entry.fileId);
    if (live) {
      // 最新側の版を採る（走査中に書かれた ocrText / archivedAt などを落とさない）
      media.push(withScanResult(live));
    } else if (!knownBefore.has(entry.fileId)) {
      // index が一度も知らなかった = disk 走査で見つけた新顔。そのまま登録する
      media.push(withScanResult(entry));
    }
    // else: 走査開始時は居たのに最新には居ない = 走査中に削除された → 復活させない
  }
  // 走査中にアップロードされて listing に載らなかった素材を拾う。
  // 「以前から知っていたのに listing に無い」= 実体が消えた素材は対象外
  //（従来どおりインデックスから落とす）。
  for (const entry of latest?.media ?? []) {
    if (!scannedFileIds.has(entry.fileId) && !knownBefore.has(entry.fileId)) {
      media.push(entry);
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

// ── favicon（第三者サービスを使わない） ──
//
// favicon はブックマーク先のサイト自身からのみ取得する。第三者の favicon API に
// 投げると、社内ホストやサブドメインに含まれるプロジェクトのコードネームまで
// 「ブックマークカードを描画しただけ」で外部に送られてしまうため。
// 解決順: サイトが宣言したアイコン (<link rel="icon">) → `https://<host>/favicon.ico`。
//
// ここで言う「サイト自身」はページとスキーム・ホスト・ポートまで一致するオリジンを指す。
// 宣言アイコンはページの HTML から読む値、つまりブックマーク先が自由に書ける値なので、
// 素通しすると他所を指すアイコン URL をそのまま保存・描画してしまう。別オリジンを
// 指す宣言アイコンは捨て、`<origin>/favicon.ico` に落とす（判定は sanitizeIconUrl）。

/**
 * 旧実装が保存していた第三者 favicon サービス（Google の favicon API）の
 * ホストとパス接頭辞。既存データの検出だけに使い、新規に組み立てることはない。
 */
const THIRD_PARTY_FAVICON_HOSTS = new Set(["www.google.com", "google.com"]);
const THIRD_PARTY_FAVICON_PATH_PREFIX = "/s2/";

/** 第三者 favicon サービスの URL か（旧データ判定用） */
export function isThirdPartyFaviconUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      THIRD_PARTY_FAVICON_HOSTS.has(u.hostname) &&
      u.pathname.startsWith(THIRD_PARTY_FAVICON_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

/**
 * favicon の取得元オリジンを求める。`"example.com"` でも
 * `"http://internal.example:8080/path"` でも受ける。
 * スキーム省略時は https を仮定し、ポートは保持する（社内ホスト対策）。
 * 取り出せなければ空文字（呼び出し側は favicon を出さない）。
 */
function faviconOrigin(domainOrUrl: string | null | undefined): string {
  const raw = (domainOrUrl ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch {
    return "";
  }
}

/**
 * アイコン URL として安全に使える形に正す。
 * 許可するのは data:image と、`pageUrlOrOrigin` と同一オリジンの http(s) だけ。
 *
 * 別オリジンを弾くのは、宣言アイコンがページ側の書き放題の値だから。
 * `<link rel="icon" href="https://tracker.example/px.png?v=訪問者ID">` のような
 * アイコンを通すと、ブックマークを描画するたびに第三者へ訪問者 ID 付きの
 * ビーコンが飛ぶ。置き換えたはずの第三者 favicon サービスより、URL を相手が
 * 選べる分たちが悪い。
 * 同一オリジン判定はスキーム・ホスト・ポートの完全一致にする。登録可能ドメイン
 * 単位（CDN 相乗り許容）にするには public suffix list が要るうえ、CDN 配信の
 * アイコンが弾かれても `<origin>/favicon.ico` に落ちるだけで実害が無い。
 * data:image はインラインで通信が起きないのでオリジンに関係なく許可する。ただし
 * 値は media-index に保存され共有ストレージにも乗るので、favicon には過大な
 * サイズを弾く（相手ページが書き放題の値である以上、保存量の増幅も入力側で止める）。
 * 旧 Google favicon API は保存済みの値から復活させないよう明示的に弾く
 * （同一オリジン判定でもまず落ちるが、判定順に依らないようにしておく）。
 */
/** data:image の受け入れ上限。favicon 用途には十分で、保存量の増幅を防ぐ。 */
const MAX_DATA_ICON_LENGTH = 64 * 1024;

function sanitizeIconUrl(
  url: string | null | undefined,
  pageUrlOrOrigin: string | null | undefined,
): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) {
    return raw.length <= MAX_DATA_ICON_LENGTH ? raw : "";
  }
  if (isThirdPartyFaviconUrl(raw)) return "";
  const pageOrigin = faviconOrigin(pageUrlOrOrigin);
  if (!pageOrigin) return ""; // 比較相手が判らない → 通さない
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.origin !== pageOrigin) return "";
    // URL.origin は userinfo を含まないので、`https://user:pass@host/icon.png` は
    // 同一オリジン判定を通ってしまう。そのまま返すと資格情報が media-index に
    // 保存され共有ストレージにも乗るため、ここで落とす。
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * favicon の候補 URL を優先度順に返す。すべてブックマーク先のサイト自身を指す。
 * 1. サイトが宣言したアイコン（urlMeta.faviconUrl）。origin と同一オリジンのときだけ
 * 2. 慣習的な `<origin>/favicon.ico`
 * どちらも作れなければ空配列（= favicon を描画しない）。
 *
 * 宣言アイコンをここでも検証するのは、この修正より前に保存された
 * urlMeta.faviconUrl に別オリジンの値が残り得るため（描画側の最後の関門）。
 *
 * origin は `pageUrl`（ブックマーク先のフル URL）があればそちらから取る。
 * `domain` は extractDomain 由来の hostname だけでスキームとポートが落ちており、
 * `http://internal.example:8080/wiki` のような社内ホストでは
 * `https://internal.example/favicon.ico`（別ホスト）を指してしまうため。
 * フル URL が判らない呼び出し（旧データの domain しか無い等）では従来どおり
 * domain から https を仮定して組み立てる。
 */
export function buildFaviconCandidates(
  domain: string,
  declaredUrl?: string,
  pageUrl?: string,
): string[] {
  const candidates: string[] = [];
  const origin = faviconOrigin(pageUrl) || faviconOrigin(domain);
  const declared = sanitizeIconUrl(declaredUrl, origin);
  if (declared) candidates.push(declared);
  if (origin) {
    const conventional = `${origin}/favicon.ico`;
    if (!candidates.includes(conventional)) candidates.push(conventional);
  }
  return candidates;
}

/**
 * favicon URL を返す。第三者サービスは一切使わない。
 *
 * @param domain      ホスト名（URL 文字列でも可）
 * @param _size       旧 Google favicon API のサイズ指定。呼び出し側の互換のため
 *                    引数は残すが未使用（サイト自身の favicon にサイズ指定の口は無い）
 * @param declaredUrl サイトが宣言したアイコン URL（urlMeta.faviconUrl）。
 *                    ページと同一オリジンならこちらを優先、別オリジンなら捨てる
 * @param pageUrl     ブックマーク先のフル URL。判るなら渡す（スキーム・ポートの保持用）
 * @returns 候補が無ければ空文字。`<img src="">` は自ページを再取得してしまうので、
 *          呼び出し側は空文字なら img を描画しないこと（Favicon コンポーネント推奨）
 */
export function getFaviconUrl(
  domain: string,
  _size = 64,
  declaredUrl?: string,
  pageUrl?: string,
): string {
  return buildFaviconCandidates(domain, declaredUrl, pageUrl)[0] ?? "";
}

/**
 * 保存済みデータに残っている第三者 favicon URL をサイト自身の favicon に書き換える。
 *
 * 旧実装は Google の favicon API の URL（クエリにホスト名を載せる形）を thumbnailUrl
 * として**永続化していた**ため、コードを直すだけでは既存ノート・既存 media-index を
 * 開くたびに Google へホスト名が送られ続ける。読み込み時にここで潰す。
 * 第三者 URL でなければそのまま返す。
 */
export function normalizeFaviconUrl(url: string): string {
  if (!isThirdPartyFaviconUrl(url)) return url;
  let origin = "";
  try {
    const params = new URL(url).searchParams;
    // 旧 API は domain=<ホスト名> / domain_url=<URL> のどちらの形もあり得る
    origin = faviconOrigin(params.get("domain") || params.get("domain_url") || "");
  } catch {
    // 復元不能 → 第三者 URL を残すより空にする
  }
  return origin ? `${origin}/favicon.ico` : "";
}

// ── プレビュー画像のローカル参照 ──
//
// og:image / leadImage は publisher が自由に書ける remote URL なので、描画に使うと
// カードを描くたびに第三者へ GET が飛ぶ。登録時に一度だけバイト列を取り込んで
// media-text チャネル（provider.saveMediaText）に data URL として置き、
// urlMeta.previewImage にはその**ローカル参照だけ**を保存する。
// 「remote URL が紛れ込まないこと」は文字列の形で保証する — 接頭辞が違えば描画側は
// 読まないし、normalizeMediaIndexEntry が読み込み時に落とす。

/** urlMeta.previewImage に許すただ一つの形式。 */
export const PREVIEW_IMAGE_REF_PREFIX = "media-text:";

/**
 * media-text のキーに付ける接頭辞。
 *
 * `:` を含めないのは Windows のファイル名で `name:stream`（代替データストリーム）と
 * 解釈されるため。保存先はデスクトップが `<media_dir>/<key>.txt`、sidecar が
 * `<DATA_DIR>/media-text/<key>.txt` で、どちらもキーをそのままファイル名に使う。
 *
 * 実メディア ID（crypto.randomUUID）とは接頭辞で必ず食い違うので、IndexedDB 版
 * （local.ts の `store.put({ id, textContent })` はレコードを丸ごと置き換える）でも
 * 画像バイナリのレコードを踏み潰す事故は起きない。
 */
const PREVIEW_TEXT_KEY_PREFIX = "preview_";

/**
 * キーに許す文字。sidecar の safeId（`/` `\` `\0` 先頭 `.` を拒否）と
 * Rust 側（サニタイズ無しで `join(format!("{file_id}.txt"))`）の両方を満たすよう、
 * 英数字とハイフン・アンダースコアだけに絞る。URL ブックマークの fileId は
 * `url_<epoch>_<rand>` なので通る。通らない fileId ならキャッシュ自体を諦める。
 */
const SAFE_PREVIEW_KEY_RE = /^[A-Za-z0-9_-]{1,120}$/;

/** fileId から media-text のキーを作る。使えない fileId なら null。 */
export function previewImageKey(fileId: string): string | null {
  if (!fileId) return null;
  const key = `${PREVIEW_TEXT_KEY_PREFIX}${fileId}`;
  return SAFE_PREVIEW_KEY_RE.test(key) ? key : null;
}

/** fileId から urlMeta.previewImage に保存する参照文字列を作る。使えない fileId なら null。 */
export function previewImageRef(fileId: string): string | null {
  const key = previewImageKey(fileId);
  return key ? `${PREVIEW_IMAGE_REF_PREFIX}${key}` : null;
}

/**
 * urlMeta.previewImage がローカル参照として妥当か。
 * http(s) / data: / プロトコル相対のいずれも false を返す（＝描画されない）。
 */
export function isLocalPreviewRef(value: string | null | undefined): boolean {
  return previewRefKey(value) !== null;
}

/** ローカル参照から media-text のキーを取り出す。妥当でなければ null。 */
export function previewRefKey(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith(PREVIEW_IMAGE_REF_PREFIX)) return null;
  const key = value.slice(PREVIEW_IMAGE_REF_PREFIX.length);
  // 接頭辞だけ（= fileId が空）も弾く
  if (key.length <= PREVIEW_TEXT_KEY_PREFIX.length) return null;
  if (!key.startsWith(PREVIEW_TEXT_KEY_PREFIX)) return null;
  return SAFE_PREVIEW_KEY_RE.test(key) ? key : null;
}

/** MediaIndexEntry 1 件を読み込み時に正規化する（第三者 favicon URL・remote プレビューの除去）
 *
 *  index は型無しの JSON として読むので、TypeScript 上は必須の thumbnailUrl が
 *  実データに無いこともある。「書き換えが要るか」の判定は値の比較ではなく
 *  isThirdPartyFaviconUrl（旧データ検出そのもの）で行い、書き換えが不要なら
 *  元の参照をそのまま返す。値比較にすると欠けたキーを "" に正規化した瞬間
 *  毎回 !== になり、readMediaIndex のたびに新しいオブジェクトを配って
 *  useMemo / React.memo の同一性キャッシュを全部無効化してしまう。
 *  同じ理由で、保存データに無かった thumbnailUrl キーをここで生やさない
 *  （生やすと次の保存で "" が永続化されてしまう）。
 *
 *  previewImage も同じ扱いにする。設計上 remote URL は入らないが、手編集・共有経由・
 *  旧バージョンからの混入に備えて「ローカル参照でなければ落とす」を読み込み時に通す
 *  （描画側の最後の関門は sanitizeIconUrl と同じ思想）。
 *  ogImage / leadImage は来歴として残す — 描画に使う経路がもう無いので、
 *  ここで消さなくてもビーコンにはならない。 */
export function normalizeMediaIndexEntry(entry: MediaIndexEntry): MediaIndexEntry {
  const storedFavicon = entry.urlMeta?.faviconUrl;
  const storedPreview = entry.urlMeta?.previewImage;
  const thumbIsLegacy = isThirdPartyFaviconUrl(entry.thumbnailUrl);
  const faviconIsLegacy = isThirdPartyFaviconUrl(storedFavicon);
  // undefined はそのまま（キーを生やさない）。値があってローカル参照でなければ落とす。
  const previewIsForeign = storedPreview !== undefined && !isLocalPreviewRef(storedPreview);
  if (!thumbIsLegacy && !faviconIsLegacy && !previewIsForeign) return entry;
  const next: MediaIndexEntry = { ...entry };
  if (thumbIsLegacy) next.thumbnailUrl = normalizeFaviconUrl(entry.thumbnailUrl);
  if (entry.urlMeta && (faviconIsLegacy || previewIsForeign)) {
    const {
      faviconUrl: legacyFavicon,
      previewImage: _foreignPreview,
      ...restMeta
    } = entry.urlMeta;
    const nextMeta: UrlMeta = { ...restMeta };
    // faviconUrl は復元可能なら書き換え、不能なら（第三者 URL を残さないため）落とす
    if (faviconIsLegacy) {
      const restored = normalizeFaviconUrl(storedFavicon!);
      if (restored) nextMeta.faviconUrl = restored;
    } else if (legacyFavicon !== undefined) {
      nextMeta.faviconUrl = legacyFavicon;
    }
    // previewImage は「ローカルに実体がある」以外の意味を持たないので復元はしない
    if (!previewIsForeign && storedPreview !== undefined) nextMeta.previewImage = storedPreview;
    next.urlMeta = nextMeta;
  }
  return next;
}

/**
 * メディアインデックス全体を読み込み時に正規化する。
 * 変更が無ければ元のオブジェクトをそのまま返す（無駄な再レンダーを避ける）。
 */
export function normalizeMediaIndex(index: MediaIndex): MediaIndex {
  if (!Array.isArray(index?.media)) return index;
  const media = index.media.map(normalizeMediaIndexEntry);
  const changed = media.some((m, i) => m !== index.media[i]);
  return changed ? { ...index, media } : index;
}

/**
 * URL 文字列を素材サイドピーク（URL リーダー）用の MediaIndexEntry に解決する。
 * 既存の URL 素材があればそれを、無ければ URL からアドホックに組み立てる。
 * ブックマークカード・本文内インラインリンク・@メンション・グラフの URL ノードの
 * クリックで共用する（#537 で導入したリゾルバの共有版）。
 */
/**
 * メモ（CaptureEntry）を素材サイドピークでその場プレビューするための
 * transient エントリを組む。media-index には保存されない（buildUrlPeekEntry と同じ流儀）。
 * fileId は "memo:<captureId>"（external-source.ts の来歴規約と同じ形）。
 */
export function buildMemoPeekEntry(capture: {
  id: string;
  text: string;
  createdAt: string;
}): MediaIndexEntry {
  const firstLine =
    capture.text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return {
    fileId: `memo:${capture.id}`,
    name: firstLine.slice(0, 40) || "Memo",
    mimeType: "text/plain",
    type: "memo",
    url: "",
    thumbnailUrl: "",
    uploadedAt: capture.createdAt,
    usedIn: [],
    memoText: capture.text,
  };
}

export function buildUrlPeekEntry(
  url: string,
  mediaIndex: { media: MediaIndexEntry[] } | null | undefined,
): MediaIndexEntry {
  const existing = mediaIndex?.media.find((m) => m.type === "url" && m.url === url);
  if (existing) return existing;
  const domain = extractDomain(url);
  return {
    fileId: `url:${url}`,
    name: domain || url,
    mimeType: "text/x-uri",
    type: "url",
    url,
    thumbnailUrl: "",
    uploadedAt: new Date().toISOString(),
    usedIn: [],
    urlMeta: { domain },
  };
}

/**
 * `<link rel="...">` の rel からアイコンとしての優先度を返す（小さいほど優先）。
 * アイコンでない rel は undefined。`rel="mask-icon"` は単色マスク用なので対象外。
 */
function iconRelRank(rel: string): number | undefined {
  const tokens = rel.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("icon")) return tokens.includes("shortcut") ? 1 : 0;
  if (tokens.includes("apple-touch-icon")) return 2;
  if (tokens.includes("apple-touch-icon-precomposed")) return 3;
  return undefined;
}

/**
 * ページが自分で宣言している favicon（`<link rel="icon" | "shortcut icon" |
 * "apple-touch-icon">`）を絶対 URL で取り出す。第三者 favicon サービスを
 * 使わないための土台。
 *
 * DOMParser で作った Document の baseURI はアプリ自身になるため、`link.href`
 * （解決済みプロパティ）は使えない。生の href 属性を取り、ページの `<base href>`
 * → ページ URL の順で解決する。
 *
 * 同一オリジン判定（sanitizeIconUrl）の基準は解決に使った `<base href>` ではなく
 * ページ URL そのもの。`<base href="https://tracker.example/">` を置くだけで
 * アイコンの取得先を他所にすげ替えられてしまうため。
 */
function extractDeclaredIconUrl(doc: Document, pageUrl: string): string | undefined {
  let base = pageUrl;
  const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {
      // <base href> が不正 → ページ URL をそのまま基準にする
    }
  }

  let best: { rank: number; url: string } | undefined;
  for (const link of Array.from(doc.querySelectorAll("link[rel]"))) {
    const rank = iconRelRank(link.getAttribute("rel") ?? "");
    if (rank === undefined) continue;
    const href = link.getAttribute("href")?.trim();
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      continue;
    }
    const safe = sanitizeIconUrl(absolute, pageUrl);
    if (!safe) continue;
    if (!best || rank < best.rank) best = { rank, url: safe };
  }
  return best?.url;
}

/** URL のメタデータを取得（OGP タイトル・説明・画像 + サイト宣言の favicon）
 *  CORS エラー等で取得できない場合はドメイン名のみ返す */
export async function fetchUrlMetadata(url: string): Promise<{
  title: string;
  description?: string;
  ogImage?: string;
  /** サイトが `<link rel="icon">` 等で宣言している favicon の絶対 URL */
  faviconUrl?: string;
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
    const faviconUrl = extractDeclaredIconUrl(doc, url);
    return { title, description, ogImage, faviconUrl, domain };
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
    // 本文中のインラインリンク（<a href>）も URL 素材の「利用」として数える。
    // 画像は image ブロックとして埋め込まれるので拾えるが、URL ブックマークは
    // 本文にハイパーリンクとして貼られることが多く、これを拾わないと URL だけ
    // usedIn が空のままになり、画像・PDF と違ってアセットグラフに出ない
    // （= 素材タイプ間で UI が不一致になる）。
    // 実メディアブロックの blockId を優先したいので、未登録の href のみ設定する。
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (inline?.type === "link" && typeof inline.href === "string" && inline.href && !map.has(inline.href)) {
          map.set(inline.href, block.id);
        }
      }
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
