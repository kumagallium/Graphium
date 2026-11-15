// 外部リンクの開き方（Web / Tauri 両対応）。
//
// Tauri v2 の WebView では `<a target="_blank">` も `window.open()` も
// OS のブラウザを開かない（受け手のハンドラが無く、クリックしても何も起きない）。
// 世界照合の出典リンク（Wikipedia / DOI / arXiv）が開けない原因がこれ。
//
// 部品は揃っている（@tauri-apps/plugin-opener インストール済み・opener:default 許可済み）
// が、クライアントが openUrl() を一度も呼んでいなかった。ここで橋渡しする。

import { isTauri } from "./platform";
import { safeExternalHref } from "./safe-href";

/**
 * 外部 URL を OS のデフォルトブラウザで開く。
 * - Tauri: opener プラグインの openUrl() に流す（動的 import で web バンドルを汚さない）
 * - Web:   従来どおり window.open(_blank)
 *
 * openUrl が失敗したら window.open にフォールバックする（取りこぼしより誤動作の方がマシ）。
 */
export async function openExternalUrl(rawUrl: string): Promise<void> {
  // 入口で検査する。外部由来の URL（javascript: / data: / file: 等）はここで止める
  const url = safeExternalHref(rawUrl);
  if (!url) {
    console.warn("[external-link] 許可されないスキームの URL は開かない");
    return;
  }
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

/** HTML の <a href> と SVG の <a href> / <a xlink:href> のどれからでも href 文字列を取る。 */
function anchorHref(anchor: Element): string | null {
  return anchor.getAttribute("href") ?? anchor.getAttribute("xlink:href");
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
      // SVG の <a>（href が SVGAnimatedString・xlink:href のみの場合もある）と <area> も拾う。
      // 拾わないと既定動作でメインウィンドウ自体が外部ページへ遷移する。
      const anchor = target?.closest?.("a, area") as Element | null;
      if (!anchor) return;
      const href = anchorHref(anchor);
      if (!href) return;
      if (!isExternalHttpUrl(href)) {
        // 実行できるスキーム（javascript: / vbscript:）は遷移させない
        // eslint-disable-next-line no-control-regex
        const norm = href.replace(/[\u0000-\u0020\u007f-\u009f]+/g, "");
        if (/^(javascript|vbscript):/i.test(norm)) e.preventDefault();
        return;
      }
      // エディタ本文（contenteditable）内のリンクはサイドピークのリーダーで開く
      // （note-app / side-peek のクリックハンドラが担当）。ここで openUrl すると
      // 「外部ブラウザとピークが同時に開く」二重動作になるので素通しする。
      if (anchor.closest('[contenteditable="true"]')) return;
      e.preventDefault();
      void openExternalUrl(new URL(href, window.location.href).toString());
    },
    true,
  );
}
