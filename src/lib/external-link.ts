// 外部リンクの開き方（Web / Tauri 両対応）。
//
// Tauri v2 の WebView では `<a target="_blank">` も `window.open()` も
// OS のブラウザを開かない（受け手のハンドラが無く、クリックしても何も起きない）。
// 世界照合の出典リンク（Wikipedia / DOI / arXiv）が開けない原因がこれ。
//
// 部品は揃っている（@tauri-apps/plugin-opener インストール済み・opener:default 許可済み）
// が、クライアントが openUrl() を一度も呼んでいなかった。ここで橋渡しする。

import { isTauri } from "./platform";

/**
 * 外部 URL を OS のデフォルトブラウザで開く。
 * - Tauri: opener プラグインの openUrl() に流す（動的 import で web バンドルを汚さない）
 * - Web:   従来どおり window.open(_blank)
 *
 * openUrl が失敗したら window.open にフォールバックする（取りこぼしより誤動作の方がマシ）。
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (err) {
      console.warn("[external-link] openUrl 失敗、window.open にフォールバック:", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 「OS ブラウザで開くべき外部リンク」かどうか。
 * http(s) かつ現在のオリジンと異なる（クロスオリジン）ものだけを対象にする。
 * 同一オリジンの内部リンク（dev では http://localhost:5174/... 等）を誤って
 * 横取りしてアプリ外に飛ばさないための条件。世界照合の出典（Wikipedia / DOI /
 * arXiv）や bookmark / graph の外部 URL は常にクロスオリジンなのでここに入る。
 */
function isExternalHttpUrl(href: string): boolean {
  try {
    const u = new URL(href, window.location.href);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Tauri 環境でのみ、ドキュメント全体のアンカークリックを横取りして
 * 外部 http(s) リンクを openUrl() に流すグローバルハンドラを仕込む。
 *
 * `<a href target="_blank">` で描画している全箇所（世界照合バナーの出典など）を
 * 個別に書き換えずに一括で救う。capture フェーズで拾い、外部リンクのみ
 * preventDefault する（アプリ内ルーティングや mailto: 等は素通し）。
 */
export function installExternalLinkHandler(): void {
  if (!isTauri()) return;
  document.addEventListener(
    "click",
    (e) => {
      // 修飾キー併用（新規タブ等の OS 操作）は尊重して素通し
      if (e.defaultPrevented || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !isExternalHttpUrl(href)) return;
      // エディタ本文（contenteditable）内のリンクはサイドピークのリーダーで開く
      // （note-app / side-peek のクリックハンドラが担当）。ここで openUrl すると
      // 「外部ブラウザとピークが同時に開く」二重動作になるので素通しする。
      if (anchor.closest('[contenteditable="true"]')) return;
      e.preventDefault();
      void openExternalUrl(anchor.href);
    },
    true,
  );
}
