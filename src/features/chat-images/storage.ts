// チャットに貼った画像の置き場（media-text チャネル）。
//
// uploadMedia（バイナリの素材）には置かない。置くと provider.listMediaFiles →
// ensureMediaIndex が素材ギャラリーに画像として並べてしまう（URL のプレビュー画像を
// media-text に置いたのと同じ理由。asset-browser/preview-image.ts 参照）。
// media-text は 3 プロバイダ（filesystem / local / server-fs）とも実装済みで、
// どの一覧にも出ない。

import type { ChatImageRef } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import type { EncodedChatImage } from "./encode";

const REF_PREFIX = "media-text:";
const KEY_PREFIX = "chatimg_";
/** 鍵として受け付ける形（保存先のファイル名になるので区切り文字・ドットを通さない） */
const SAFE_KEY_RE = /^chatimg_[A-Za-z0-9_-]{1,100}$/;

/** 読み出した data URL の置き場（同じ画像を履歴として毎ターン送るため）。古いものから捨てる */
const cache = new Map<string, string>();
const CACHE_LIMIT = 48;

function remember(ref: string, dataUrl: string): void {
  cache.delete(ref);
  cache.set(ref, dataUrl);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 参照から media-text の鍵を取り出す。妥当でなければ null */
export function chatImageKey(ref: string | null | undefined): string | null {
  if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX)) return null;
  const key = ref.slice(REF_PREFIX.length);
  return SAFE_KEY_RE.test(key) ? key : null;
}

// 会話を消しても画像は消さない。分岐（fork）した会話は元の会話と同じ参照を持つので、
// 片方を消したときに消すと、もう片方の画像が見えなくなる。

/** 縮小済みの画像を保存し、メッセージに持たせる参照を返す */
export async function saveChatImage(
  provider: Pick<StorageProvider, "saveMediaText">,
  image: Pick<EncodedChatImage, "dataUrl" | "mimeType">,
  name?: string,
): Promise<ChatImageRef> {
  if (!provider.saveMediaText) throw new Error("This storage cannot keep chat images");
  const key = `${KEY_PREFIX}${crypto.randomUUID().replace(/-/g, "")}`;
  await provider.saveMediaText(key, image.dataUrl);
  const ref = `${REF_PREFIX}${key}`;
  remember(ref, image.dataUrl);
  return { ref, mimeType: image.mimeType, ...(name ? { name } : {}) };
}

/**
 * 参照から data URL を読む。見つからない・形が違うときは null
 * （共有されたノートのチャットなど、画像が手元に無い場合）。
 */
export async function loadChatImage(
  provider: Pick<StorageProvider, "loadMediaText">,
  ref: string,
): Promise<string | null> {
  const hit = cache.get(ref);
  if (hit) return hit;
  const key = chatImageKey(ref);
  if (!key || !provider.loadMediaText) return null;
  try {
    const text = await provider.loadMediaText(key);
    if (!text || !text.startsWith("data:image/")) return null;
    remember(ref, text);
    return text;
  } catch {
    return null;
  }
}

/** 入力欄で縮小した画像をまとめて保存する（送信の直前に呼ぶ） */
export async function savePendingChatImages(
  provider: Pick<StorageProvider, "saveMediaText">,
  images: readonly (Pick<EncodedChatImage, "dataUrl" | "mimeType"> & { name?: string })[],
): Promise<ChatImageRef[]> {
  const refs: ChatImageRef[] = [];
  for (const img of images) refs.push(await saveChatImage(provider, img, img.name));
  return refs;
}

/** テスト用: 読み出しの置き場を空にする */
export function clearChatImageCacheForTest(): void {
  cache.clear();
}
