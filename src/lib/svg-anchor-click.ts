// Reader 本文の SVG <a>（href が SVGAnimatedString・xlink:href のみの場合もある）のクリック処理。
//
// 何もしないと既定動作でメインのタブ（ウィンドウ）自体が外部ページへ遷移する。
// 常に既定動作を止め、http(s) / mailto だけ新しいタブ（Tauri は OS ブラウザ）で開く。
// HTML の <a href> は従来どおり（ここでは触らない）。

import { openExternalUrl } from "./external-link";
import { safeExternalHref } from "./safe-href";

const SVG_NS = "http://www.w3.org/2000/svg";

export function interceptSvgAnchorClick(e: {
  target: EventTarget | null;
  defaultPrevented: boolean;
  preventDefault: () => void;
}): void {
  if (e.defaultPrevented) return; // Tauri のグローバルハンドラが処理済み
  const anchor = (e.target as Element | null)?.closest?.("a, area") ?? null;
  if (!anchor) return;
  const isSvg = anchor.namespaceURI === SVG_NS;
  if (!isSvg && anchor.tagName.toLowerCase() !== "area") return;
  e.preventDefault();
  const href = anchor.getAttribute("href") ?? anchor.getAttribute("xlink:href") ?? "";
  const safe = safeExternalHref(href);
  if (safe) void openExternalUrl(safe);
}
