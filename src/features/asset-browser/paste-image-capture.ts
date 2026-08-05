// HTML ペーストで挿入された外部 URL / data URL の image ブロックを
// ローカルメディアへ取り込む後処理（メインエディタ / SidePeek 共通）。
//
// BlockNote は text/html を含むペースト（ウェブページや他エディタからのコピー）を
// pasteHTML でパースし、<img> の src をそのまま props.url に持つ image ブロック
// として挿入する。この経路は uploadFile（素材登録の唯一の入口）を通らない
// （uploadFile が呼ばれるのはクリップボードに画像ファイル実体だけがある場合）ため、
// 本文には表示されるのに素材ライブラリには存在しない不整合が生じる。
//
// ここでは貼り付け完了後に新規追加された image ブロックを走査し、
//   - リモート http(s) 画像は image-proxy 経由で取得（remote-image.ts と同じ経路）
//   - data URL はその場で File 化（プロキシ不要。ノート JSON への base64 直埋め
//     による肥大化もこれで防ぐ）
// してメディアへ保存し、ブロックの props.url をローカル URL に差し替える。
// 差し替え後は保存時の usedIn 同期（extractMediaFromBlocks → syncUsedIn）が
// 通常アップロードと同じように効く。
//
// 取得・保存に失敗した画像は元の URL のまま残す（従来と同じ表示挙動）。
// remote-image.ts の「取り込めなければ画像ごと諦める」方針は本文にまだ存在しない
// 画像を新規に取り込む経路の話で、ここはユーザーが貼り付け済みのコンテンツを
// 後処理する経路なので、消す方がデータ破壊になる。

import { flattenBlockIds } from "../block-lifecycle/clipboard";
import { fetchRemoteImageAsFile, remoteImageFileName } from "./remote-image";

/** capturePastedImages が触るエディタ API の最小面（テスト用に絞る） */
type EditorLike = {
  document: readonly any[];
  getBlock: (blockId: string) => any | undefined;
  updateBlock: (blockId: string | { id: string }, update: any) => unknown;
};

/**
 * 取り込み対象の URL か。
 * 外部 http(s) と data:image のみ対象。自ストレージのカスタムスキーム
 * （file-media:// / local-media:// / media-server://）や blob: は弾かれる。
 */
export function isCapturablePastedImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
}

/** data URL を File 化する。画像以外（data:image を騙る非画像 blob）は throw。 */
async function dataUrlToImageFile(dataUrl: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not an image");
  // remoteImageFileName は URL 解析に失敗すると "image.<ext>" に落ちる。
  // data URL をそのまま渡すと base64 本体がファイル名に混入するため空文字で呼ぶ。
  return new File([blob], remoteImageFileName("", blob.type), { type: blob.type });
}

export type PastedImageCaptureResult = {
  /** ローカルメディアへ差し替えた枚数 */
  captured: number;
  /** 取得・保存に失敗して外部 URL のまま残した枚数 */
  failed: number;
};

/**
 * newIds のうち取り込み対象の image ブロックをメディアへ保存し、url を差し替える。
 * 同一 URL が複数ブロックに貼られた場合は 1 回だけ取得して同じローカル URL を共有する。
 */
export async function capturePastedImages(
  editor: EditorLike,
  newIds: ReadonlySet<string>,
  uploadImage: (file: File) => Promise<string>,
): Promise<PastedImageCaptureResult> {
  // 対象ブロックの収集。children はカラム等のコンテナを透過して深さ優先で辿る
  const targets: { id: string; url: string }[] = [];
  const walk = (list: readonly any[]) => {
    for (const block of list) {
      if (
        block?.id &&
        newIds.has(block.id) &&
        block.type === "image" &&
        isCapturablePastedImageUrl(block.props?.url)
      ) {
        targets.push({ id: block.id, url: block.props.url });
      }
      if (Array.isArray(block?.children) && block.children.length > 0) walk(block.children);
    }
  };
  walk(editor.document);
  if (targets.length === 0) return { captured: 0, failed: 0 };

  const localUrlByPastedUrl = new Map<string, Promise<string | null>>();
  const fetchAndStore = (url: string): Promise<string | null> => {
    let pending = localUrlByPastedUrl.get(url);
    if (!pending) {
      pending = (async () => {
        try {
          const file = url.startsWith("data:")
            ? await dataUrlToImageFile(url)
            : await fetchRemoteImageAsFile(url);
          return await uploadImage(file);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[Graphium paste] 画像の取り込みに失敗:", url.slice(0, 120), err);
          return null;
        }
      })();
      localUrlByPastedUrl.set(url, pending);
    }
    return pending;
  };

  let captured = 0;
  let failed = 0;
  await Promise.all(
    targets.map(async (target) => {
      const localUrl = await fetchAndStore(target.url);
      if (!localUrl) {
        failed++;
        return;
      }
      try {
        // 取得中にブロックが削除された / ユーザーが url を差し替えた場合は触らない
        const current = editor.getBlock(target.id);
        if (!current || current.type !== "image" || current.props?.url !== target.url) return;
        // updateBlock は onChange を発火するので dirty 化・オートセーブは自動で走る
        editor.updateBlock(target.id, { props: { url: localUrl } });
        captured++;
      } catch {
        failed++;
      }
    }),
  );
  return { captured, failed };
}

/**
 * paste リスナーから呼ぶ入口。BlockNote のネイティブ HTML パースがブロックを
 * 挿入し終わるのを待って（setTimeout 0、entity 再発番と同じタイミング手法）、
 * paste イベント同期時点との差分 = 新規ブロックだけを取り込む。
 * uploadImage が無い文脈（読み取り専用など）では何もしない。
 *
 * event を渡すとイベント単位の既処理フラグでガードする。クリップボード
 * リスナーは二重登録されることがあり（tryConvertNoteLinkPaste と同じ既知事象）、
 * 同一 paste が 2 回届くと URL 差し替えは元 URL ガードで 1 回に収まるが、
 * アップロードは両方走って素材が二重登録されるため。
 */
export function schedulePastedImageCapture(
  editor: EditorLike,
  beforeIds: ReadonlySet<string>,
  uploadImage: ((file: File) => Promise<string>) | undefined,
  event?: ClipboardEvent,
): void {
  if (!uploadImage) return;
  if (event) {
    const flagged = event as unknown as { __ghImageCaptureHandled?: boolean };
    if (flagged.__ghImageCaptureHandled) return;
    flagged.__ghImageCaptureHandled = true;
  }
  setTimeout(() => {
    const afterIds = flattenBlockIds(editor.document as any[]);
    const newIds = new Set(afterIds.filter((id) => !beforeIds.has(id)));
    if (newIds.size === 0) return;
    void capturePastedImages(editor, newIds, uploadImage);
  }, 0);
}
