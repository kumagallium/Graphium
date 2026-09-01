// URL ブックマークのプレビュー画像をローカルにキャッシュする
//
// og:image / leadImage は publisher が自由に書ける remote URL で、CDN や計測ドメインを
// 指しているのが普通。そのまま `<img src>` に載せると「ギャラリーを開いた」「ノートを
// スクロールした」だけで第三者へ GET が飛び、しかも URL にクエリを載せられる以上、
// 置き換えたはずの第三者 favicon サービスより相手の自由度が高い。
//
// そこで og:image は**取得元の記録**に降格し、描画に使うのは登録時に一度だけ取り込んだ
// ローカルの実体だけにする:
//
//   1. 登録時（capture）に sidecar の /url/image-proxy 経由でバイト列を取得
//      （ブラウザから直接 fetch するとほとんどの配信元で CORS に弾かれるため）
//   2. canvas で長辺 MAX_PREVIEW_EDGE に縮小して再エンコード（EXIF も落ちる）
//   3. data URL を provider.saveMediaText（media-text チャネル）に保存
//   4. urlMeta.previewImage にローカル参照 `media-text:<key>` だけを書き戻す
//
// 描画側（usePreviewImage）はネットワークに一切触らない。取得・保存に失敗したら
// previewImage は付かず、カードは favicon 表示に落ちる。**remote URL には
// どの経路でもフォールバックしない** —— 見えるが漏れるカードより、素のカードを取る。
//
// media-text を置き場所に選んだ理由: uploadMedia（バイナリチャネル）に置くと
// provider.listMediaFiles → ensureMediaIndex がギャラリーに画像素材として並べてしまい、
// 件数一致による鮮度チェックも壊れる。media-text は 3 プロバイダとも実装済みで、
// かつ既存コードの側で一覧から外れている（Rust は `.txt` を除外、IndexedDB は
// `blob != null` で絞る、sidecar は別ディレクトリ）。

import { useEffect, useState } from "react";
import { apiBase } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
// image-proxy が届くかの判定は remote-image.ts と共有する（2 本に分けない）
import { imageProxyAvailable } from "./remote-image";
import {
  isLocalPreviewRef,
  persistUrlMetaPatch,
  previewImageKey,
  previewImageRef,
  previewRefKey,
  readMediaIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  type MediaIndex,
  type MediaIndexEntry,
  type UrlMeta,
} from "./media-index";

/** 縮小後の長辺（px）。カード上は最大 200px 幅なので、Retina 相当でも十分足りる。 */
export const MAX_PREVIEW_EDGE = 640;

/**
 * 保存する data URL の上限。base64 は元バイトの約 1.33 倍なので、
 * 縮小・再エンコードを省くと 2MB の hero が 2.7MB の .txt になる。
 * ディスクとメモリの増幅を入力側で止める（相手が書き放題の値である以上、必須）。
 */
export const MAX_PREVIEW_DATA_URL_LENGTH = 256 * 1024;

/** デコード前に弾く元画像のバイト数上限。巨大 PNG のデコードで固まらせない。 */
export const MAX_PREVIEW_SOURCE_BYTES = 8 * 1024 * 1024;

/** 取得に失敗したブックマークを叩き直すまでの間隔。 */
export const PREVIEW_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** image-proxy のタイムアウト。sidecar 側（15s）より少し短くして先に諦める。 */
const PREVIEW_FETCH_TIMEOUT_MS = 12_000;

// ── キャッシュ生成（capture 時） ──

export type CachePreviewResult = "cached" | "skipped" | "failed";

/** 環境依存の処理は差し込む（テスト時に純粋関数として呼べるように）。 */
export type CachePreviewDeps = {
  /** remote URL → 画像 Blob。取得できなければ null */
  fetchImage: (remoteUrl: string) => Promise<Blob | null>;
  /** Blob → `data:image/...`。縮小・再エンコードを含む。失敗なら null */
  encode: (blob: Blob) => Promise<string | null>;
  /** media-text チャネルへの保存。チャネルを持たないプロバイダなら null */
  saveText: ((key: string, dataUrl: string) => Promise<void>) | null;
  /** urlMeta への書き戻し。反映できたら true */
  patch: (fileId: string, patch: Parameters<typeof persistUrlMetaPatch>[1]) => Promise<boolean>;
  now: () => string;
};

/** キャッシュ元にできる remote URL を選ぶ。leadImage（記事固有）を og:image より優先。 */
export function pickPreviewSource(meta: UrlMeta | undefined): string | null {
  for (const candidate of [meta?.leadImage, meta?.ogImage]) {
    const raw = (candidate ?? "").trim();
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {
      // 相対 URL・不正な値。fetchUrlMetadata は og:image を絶対化していないので普通に来る
    }
  }
  return null;
}

/** 直近に試していて、まだクールダウン中か。 */
function inCooldown(previewImageAt: string | undefined, nowMs: number): boolean {
  if (!previewImageAt) return false;
  const at = Date.parse(previewImageAt);
  return Number.isFinite(at) && nowMs - at < PREVIEW_RETRY_COOLDOWN_MS;
}

export type PreviewCacheOptions = {
  /**
   * クールダウンを無視して取り直す。取得元が変わったとき用
   * （Reader が leadImage を拾った直後など。og:image で失敗した記録に阻まれて
   * 「今なら取れる URL」を試さないのは損なので、そこだけ開ける）。
   */
  ignoreCooldown?: boolean;
};

/** キャッシュが要るエントリか（同期判定・ネットワークに触らない）。 */
export function needsPreviewCache(
  entry: MediaIndexEntry,
  nowMs = Date.now(),
  opts: PreviewCacheOptions = {},
): boolean {
  if (entry.type !== "url") return false;
  if (isLocalPreviewRef(entry.urlMeta?.previewImage)) return false;
  if (previewImageKey(entry.fileId) === null) return false;
  if (!opts.ignoreCooldown && inCooldown(entry.urlMeta?.previewImageAt, nowMs)) return false;
  return pickPreviewSource(entry.urlMeta) !== null;
}

/**
 * 1 エントリ分のプレビュー画像を取得してローカルへ保存する。
 *
 * 失敗系はすべて `previewImageAt` だけを書いて終わる —— 「試したが駄目だった」を
 * 記録して再試行を間引くためで、**remote URL を previewImage に書くことは無い**。
 */
export async function cachePreviewImage(
  entry: MediaIndexEntry,
  deps: CachePreviewDeps,
  opts: PreviewCacheOptions = {},
): Promise<CachePreviewResult> {
  if (!needsPreviewCache(entry, Date.now(), opts)) return "skipped";
  const key = previewImageKey(entry.fileId);
  const ref = previewImageRef(entry.fileId);
  if (!key || !ref) return "skipped";
  const remote = pickPreviewSource(entry.urlMeta);
  if (!remote) return "skipped";
  // 保存先が無い環境では取得もしない（web 静的配信）。previewImageAt も書かない —
  // ここで「試した」ことにすると、同じデータを開いたデスクトップ版が
  // クールダウンに阻まれて取得できなくなる。
  if (!deps.saveText) return "skipped";

  const at = deps.now();
  try {
    const blob = await deps.fetchImage(remote);
    if (!blob || !blob.type.toLowerCase().startsWith("image/")) {
      await deps.patch(entry.fileId, { previewImageAt: at });
      return "failed";
    }
    if (blob.size > MAX_PREVIEW_SOURCE_BYTES) {
      await deps.patch(entry.fileId, { previewImageAt: at });
      return "failed";
    }
    const dataUrl = await deps.encode(blob);
    if (
      !dataUrl ||
      !dataUrl.startsWith("data:image/") ||
      dataUrl.length > MAX_PREVIEW_DATA_URL_LENGTH
    ) {
      await deps.patch(entry.fileId, { previewImageAt: at });
      return "failed";
    }
    await deps.saveText(key, dataUrl);
    const applied = await deps.patch(entry.fileId, { previewImage: ref, previewImageAt: at });
    if (!applied) {
      // 登録直後は media-index への保存とレースし得る。1 度だけ待って入れ直す
      await new Promise((r) => setTimeout(r, 600));
      await deps.patch(entry.fileId, { previewImage: ref, previewImageAt: at });
    }
    rememberPreview(key, dataUrl);
    return "cached";
  } catch {
    try {
      await deps.patch(entry.fileId, { previewImageAt: at });
    } catch {
      // 記録すら書けなくても、remote URL を描かせないという結論は変わらない
    }
    return "failed";
  }
}

/** image-proxy 経由で画像バイト列を取る。取れなければ null（例外にしない）。 */
async function fetchImageViaProxy(remoteUrl: string): Promise<Blob | null> {
  try {
    if (!(await imageProxyAvailable())) return null;
    const proxied = `${apiBase()}/url/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
    const res = await fetch(proxied, { signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null; // 4xx / 415（画像でない）/ 502 は正常な結果のひとつ
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * Blob を縮小して data URL にする。
 * 再エンコードを挟むことで EXIF が落ち、SVG や巨大 PNG がそのまま永続化されるのも防げる。
 * createImageBitmap / canvas が無い環境（jsdom）では null を返す。
 */
export async function encodePreviewDataUrl(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null; // SVG や壊れた画像
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest === 0) return null;
    const scale = Math.min(1, MAX_PREVIEW_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    // WebP が使えない環境では toDataURL が黙って image/png を返すので、
    // 戻り値の MIME で判定して JPEG に落とす（PNG は写真で肥大しやすい）
    const webp = canvas.toDataURL("image/webp", 0.8);
    if (webp.startsWith("data:image/webp")) return webp;
    const jpeg = canvas.toDataURL("image/jpeg", 0.82);
    return jpeg.startsWith("data:image/") ? jpeg : null;
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}

function defaultDeps(): CachePreviewDeps {
  let saveText: CachePreviewDeps["saveText"] = null;
  try {
    const provider = getActiveProvider();
    if (provider.saveMediaText) {
      saveText = (key, dataUrl) => provider.saveMediaText!(key, dataUrl);
    }
  } catch {
    // プロバイダ未設定（初期化前）→ 保存先なし扱い
  }
  return {
    fetchImage: fetchImageViaProxy,
    encode: encodePreviewDataUrl,
    saveText,
    patch: persistUrlMetaPatch,
    now: () => new Date().toISOString(),
  };
}

/**
 * 登録直後の URL エントリについて、プレビュー画像のキャッシュを試みる。
 * fire-and-forget で呼ぶ想定（描画パスからは呼ばない）。失敗しても toast は出さない。
 */
export async function ensureCachedPreviewImage(
  entry: MediaIndexEntry,
  opts: PreviewCacheOptions = {},
): Promise<CachePreviewResult> {
  const deps = defaultDeps();
  // 保存先も取得経路も無い環境（web の静的配信）では「試した」記録すら残さない。
  // 残すと、同じ media-index をデスクトップ版で開いたときクールダウンに阻まれる。
  if (!deps.saveText) return "skipped";
  if (!needsPreviewCache(entry, Date.now(), opts)) return "skipped";
  if (!(await imageProxyAvailable())) return "skipped";
  return cachePreviewImage(entry, deps, opts);
}

// ── 既存ブックマークの後追い取得（backfill） ──

/** 1 回のスイープで取得する上限。起動直後に大量の外向きリクエストを出さないため。 */
const BACKFILL_BATCH = 8;
/** 取得間隔。配信元にも自分のネットワークにも波を作らない。 */
const BACKFILL_INTERVAL_MS = 1_200;

let backfillStarted = false;

/**
 * この修正より前に登録されたブックマーク（previewImage を持たない）を後追いでキャッシュする。
 *
 * 何もしないと、既存のブックマークは hero 画像を永久に失う。取得は
 * 「ユーザーの端末発・ローカルプロキシ経由・ブックマーク 1 件につき 1 回」で、
 * 「カードを描くたびに配信元へ GET」だった従来より厳密に少ない。
 * それでもアップグレード直後にまとめて出るのは事実なので、件数と間隔で抑える。
 *
 * セッション中 1 回だけ走る。取得できなかったものは previewImageAt により
 * PREVIEW_RETRY_COOLDOWN_MS の間は再挑戦しない。
 */
export function startPreviewBackfill(index: MediaIndex | null | undefined): void {
  if (backfillStarted || !index?.media?.length) return;
  const targets = index.media.filter((m) => needsPreviewCache(m)).slice(0, BACKFILL_BATCH);
  if (targets.length === 0) return;
  backfillStarted = true;
  void (async () => {
    const deps = defaultDeps();
    if (!deps.saveText || !(await imageProxyAvailable())) return;
    for (const entry of targets) {
      await cachePreviewImage(entry, deps);
      await new Promise((r) => setTimeout(r, BACKFILL_INTERVAL_MS));
    }
  })();
}

/** テスト用: セッション 1 回きりのフラグを戻す。 */
export function resetPreviewBackfillForTest(): void {
  backfillStarted = false;
}

// ── 読み出し（描画時・ネットワークに触らない） ──

/**
 * media-text から読んだ data URL のセッションキャッシュ。
 * ギャラリーは同じエントリを何度も描き直すので、都度 IndexedDB / IPC を叩かない。
 * data URL は 1 件最大 256KB なので、上限を決めて丸ごと捨てる（単純な世代キャッシュ）。
 */
const PREVIEW_MEMO_LIMIT = 96;
const previewMemo = new Map<string, Promise<string | null>>();

function rememberPreview(key: string, dataUrl: string): void {
  if (previewMemo.size >= PREVIEW_MEMO_LIMIT) previewMemo.clear();
  previewMemo.set(key, Promise.resolve(dataUrl));
}

/** テスト用: セッションキャッシュを空にする。 */
export function clearPreviewImageCache(): void {
  previewMemo.clear();
}

/**
 * ローカル参照からプレビュー画像の data URL を読む。
 * 参照が妥当でない・実体が無い・`data:image/` で始まらない ならすべて null。
 * ここからネットワークへ出る経路は無い（remote への再取得もしない）。
 */
export async function loadPreviewImageByRef(
  ref: string | null | undefined,
): Promise<string | null> {
  const key = previewRefKey(ref);
  if (!key) return null;
  const hit = previewMemo.get(key);
  if (hit) return hit;
  const pending = (async () => {
    try {
      const provider = getActiveProvider();
      if (!provider.loadMediaText) return null;
      const text = await provider.loadMediaText(key);
      if (!text || !text.startsWith("data:image/")) return null;
      if (text.length > MAX_PREVIEW_DATA_URL_LENGTH) return null;
      return text;
    } catch {
      return null;
    }
  })();
  if (previewMemo.size >= PREVIEW_MEMO_LIMIT) previewMemo.clear();
  previewMemo.set(key, pending);
  return pending;
}

/** エントリからプレビュー画像の data URL を読む。 */
export function loadPreviewImage(entry: MediaIndexEntry): Promise<string | null> {
  return loadPreviewImageByRef(entry.urlMeta?.previewImage);
}

/**
 * URL カードの hero 画像（ローカルキャッシュ）を返す React フック。
 * 解決前・キャッシュ無しは null で、呼び出し側は favicon 表示に落ちる。
 */
export function usePreviewImage(entry: MediaIndexEntry): string | null {
  const ref = entry.urlMeta?.previewImage;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!isLocalPreviewRef(ref)) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    void loadPreviewImageByRef(ref).then((value) => {
      if (!cancelled) setSrc(value);
    });
    return () => {
      cancelled = true;
    };
  }, [ref]);
  return src;
}

// ── ブックマークブロック用（URL からの逆引き） ──
//
// ノート本文のブックマークブロックは media-index ではなくブロック props に
// メタデータを持つ。props には remote URL を置かない方針にしたので、hero は
// 同じ URL の素材エントリが持つローカルキャッシュから引く。
// 毎回インデックス全体を読み直さないよう、短い TTL と変更イベントで畳む。

const INDEX_TTL_MS = 15_000;
let indexCache: { at: number; promise: Promise<MediaIndex | null> } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(MEDIA_INDEX_CHANGED_EVENT, () => {
    indexCache = null;
  });
}

function cachedMediaIndex(): Promise<MediaIndex | null> {
  const now = Date.now();
  if (indexCache && now - indexCache.at < INDEX_TTL_MS) return indexCache.promise;
  const promise = readMediaIndex().catch(() => null);
  indexCache = { at: now, promise };
  return promise;
}

/** テスト用: media-index の TTL キャッシュを捨てる。 */
export function clearPreviewIndexCacheForTest(): void {
  indexCache = null;
}

/** 指定 URL の素材エントリが持つプレビュー画像を読む。無ければ null。 */
export async function loadPreviewImageForUrl(url: string): Promise<string | null> {
  if (!url) return null;
  const index = await cachedMediaIndex();
  const entry = index?.media.find((m) => m.type === "url" && m.url === url);
  return entry ? loadPreviewImage(entry) : null;
}

/** ブックマークブロック用: URL からローカルキャッシュの hero を引く React フック。 */
export function useBookmarkPreviewImage(url: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    const resolve = () => {
      void loadPreviewImageForUrl(url).then((value) => {
        if (!cancelled) setSrc(value);
      });
    };
    resolve();
    // 貼り付け直後は素材登録とキャッシュ生成が後から追いつく。index の更新を
    // 拾い直さないと、そのノートを閉じるまで hero が出ない
    if (typeof window === "undefined") return () => { cancelled = true; };
    window.addEventListener(MEDIA_INDEX_CHANGED_EVENT, resolve);
    return () => {
      cancelled = true;
      window.removeEventListener(MEDIA_INDEX_CHANGED_EVENT, resolve);
    };
  }, [url]);
  return src;
}
