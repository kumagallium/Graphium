// URL 貼り付け → ブックマーク/リンク選択メニュー（UrlPasteMenu）の共通ロジック。
// メインエディタ（note-app.tsx）とサイドピーク（side-peek.tsx）の両方から使う。
// 挙動を 2 箇所で揃えるため、位置計算・挿入・素材登録はすべてここに集約する。

import {
  extractDomain,
  fetchUrlMetadata,
  generateUrlBookmarkId,
  getFaviconUrl,
} from "./media-index";
import type { MediaIndexEntry, MediaUsage } from "./media-index";
import { ensureCachedPreviewImage } from "./preview-image";

export function isHttpUrl(text: string): boolean {
  try {
    return new URL(text).protocol.startsWith("http");
  } catch {
    return false;
  }
}

/**
 * メニューの表示位置を計算する。**メニュー表示直前（挿入完了後）に呼ぶこと**。
 * paste イベント同期時の selection rect は、空ブロックの collapsed caret が
 * 全ゼロ rect を返す（Chromium）ため、メニューが画面左上に張り付く。
 * フォールバック連鎖: selection rect → ブロック要素 rect → エディタ要素基準。
 */
export function computeUrlPasteMenuPosition(
  editor: any,
  blockId: string,
): { x: number; y: number } {
  let x = 0, y = 0;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    x = rect.left;
    y = rect.bottom;
  }
  // 空ブロックの collapsed caret などで rect が (0,0) になる場合は
  // ブロック要素の位置にフォールバックする
  if (x === 0 && y === 0) {
    const blockEl = editor?.domElement?.querySelector(`[data-id="${blockId}"]`);
    const rect = blockEl?.getBoundingClientRect();
    if (rect && (rect.left !== 0 || rect.bottom !== 0)) {
      x = rect.left;
      y = rect.bottom;
    }
  }
  // それでも取れなければエディタ要素基準に置く（左上張り付きの最終防止）
  if (x === 0 && y === 0) {
    const rect = editor?.domElement?.getBoundingClientRect();
    if (rect) {
      x = rect.left + 48;
      y = rect.top + 48;
    }
  }
  return { x, y };
}

/**
 * 空リスト項目の救済分岐で挿入する inline content を作る。
 * URL 単体はネイティブ paste（GFM autolink）と同じくリンクとして挿入する。
 * プレーンテキストで入れると usedIn スキャン（extractMediaFromBlocks）の
 * 検出対象にならず、アセットグラフ・近傍グラフに URL が現れない。
 */
export function buildPastedTextContent(cleaned: string): any[] {
  const token = cleaned.trim();
  const isUrlToken = !!token && !/\s/.test(token) && isHttpUrl(token);
  return isUrlToken
    ? [{ type: "link", href: token, content: [{ type: "text", text: token, styles: {} }] }]
    : [{ type: "text", text: cleaned, styles: {} }];
}

/**
 * ペースト → ブックマーク選択: bookmark ブロックを挿入する。
 * 元ブロックに URL テキスト（またはリンク）だけが残っていたら削除する。
 * 子ブロックを持つ場合は巻き添え削除になるため残す（ネストしたリスト項目など）。
 *
 * @returns 挿入した bookmark ブロックの ID（挿入できなければ null）
 */
export function insertBookmarkBlockFromPaste(
  editor: any,
  url: string,
  blockId: string,
  removeBlockMetadata?: (blockIds: string[]) => void,
): string | null {
  const block = editor?.getBlock?.(blockId);
  if (!block) return null;
  // bookmark ブロックを即座に挿入（メタデータはブロック側で非同期取得）
  const inserted = editor.insertBlocks(
    [{
      type: "bookmark",
      props: { url, title: "", description: "", ogImage: "", domain: extractDomain(url) },
    }],
    block,
    "after",
  );
  const content = block.content;
  const hasChildren = Array.isArray(block.children) && block.children.length > 0;
  if (Array.isArray(content) && content.length <= 1 && !hasChildren) {
    const text = content[0]?.text?.trim() ?? "";
    if (text === url || text === "") {
      removeBlockMetadata?.([block.id]);
      editor.removeBlocks([block]);
    }
  }
  return inserted?.[0]?.id ?? null;
}

/**
 * ペースト → リンク選択: URL がプレーンテキストのまま入っている場合はリンク化する
 * （usedIn スキャンは {type:"link"} の href しか検出しない）。
 * ネイティブ paste 経路は既にリンク化済みなのでこのガードには入らない。
 * codeBlock は link インラインを許可しないため除外する。
 */
export function retroLinkifyPastedUrl(editor: any, url: string, blockId: string): void {
  const block = editor?.getBlock?.(blockId);
  if (!editor || !block || block.type === "codeBlock") return;
  if (!Array.isArray(block.content) || block.content.length !== 1) return;
  const item = block.content[0];
  if (item?.type === "text" && item.text?.trim() === url) {
    editor.updateBlock(block, {
      content: [{ type: "link", href: url, content: [{ type: "text", text: url, styles: {} }] }],
    });
  }
}

/**
 * ブロックの inline content に指定 URL のリンクが実在するかを調べる。
 * usedIn を事前充填する際の実体確認に使う（リンク化が no-op だった
 * codeBlock などで、実体のないグラフエッジを登録しないため）。
 */
export function blockContainsUrlLink(editor: any, blockId: string, url: string): boolean {
  const block = editor?.getBlock?.(blockId);
  if (!block || !Array.isArray(block.content)) return false;
  return block.content.some(
    (item: any) => item?.type === "link" && item.href === url,
  );
}

/**
 * URL をアセットブラウザ（media index）に登録する。メタデータは裏で取得する。
 * 登録が無いと保存時の syncUsedIn が usedIn を埋められず、
 * アセットグラフ・近傍グラフに URL が現れない。重複は useFileManager 側で吸収される。
 *
 * @param usedIn 登録時点で確定している利用ノート（サイドピークは自身のノートを渡す。
 *   メインエディタは空配列 + onRegistered で保存を予約し syncUsedIn に埋めさせる）
 * @param onRegistered 登録完了後に呼ばれる（保存予約用）。アンマウント後にも発火しうるので
 *   即時保存（saveNow 等）を渡してはいけない — 別ノートへの上書き事故になる
 */
export function registerUrlAsset(
  url: string,
  usedIn: MediaUsage[],
  onAddUrlBookmark: ((entry: MediaIndexEntry) => void) | undefined,
  onRegistered?: () => void,
): void {
  if (!onAddUrlBookmark) return;
  fetchUrlMetadata(url).then((meta) => {
    const entry: MediaIndexEntry = {
      fileId: generateUrlBookmarkId(),
      name: meta.title,
      type: "url",
      mimeType: "text/x-uri",
      url,
      // favicon はサイト自身のものだけを保存する（第三者サービスは経由しない）。
      // 社内ホストのスキーム・ポートを落とさないよう、フル URL も渡す。
      thumbnailUrl: getFaviconUrl(meta.domain, 64, meta.faviconUrl, url),
      uploadedAt: new Date().toISOString(),
      usedIn,
      urlMeta: {
        domain: meta.domain,
        description: meta.description,
        ogImage: meta.ogImage,
        faviconUrl: meta.faviconUrl,
      },
    };
    onAddUrlBookmark(entry);
    // OGP 画像の実体を登録時に一度だけ取り込む。以後カードはローカルの
    // data URL を描くので、描画で配信元へ出ていくことは無い（失敗しても無視）
    void ensureCachedPreviewImage(entry);
    onRegistered?.();
  });
}
