// ブロックした外部メディアの代わりに置く枠。
//
// 「壊れた画像」ではなく「まだ取りに行っていない」と読めることが要件なので、
// 何のメディアか・どのホストから読むのか・押すとどうなるのかを文字で出す。
// パスとクエリは出さない（計測用のトークンが載っていることが多い）ので、
// remoteRefHost が返すホスト名だけを表示する。
//
// 高さを固定しているのは、読み込み後に本文が大きく動かないようにするため。
// 画像の実寸は取りに行くまで判らないので一致はしないが、行の高さの倍程度に
// 収めておけばスクロール位置が飛ばない。

import { remoteRefHost } from "../../features/asset-browser/local-media-ref";
// BlockNote のブロック render は React ツリー外でも呼ばれ得るため、Context 不要の t を使う
import { t } from "../../i18n";

/** プレースホルダに出す「何のメディアか」の見出しキー */
export type BlockedMediaKind = "image" | "video" | "audio" | "pdf";

const KIND_LABEL_KEY: Record<BlockedMediaKind, string> = {
  image: "block.remoteContent.image",
  video: "block.remoteContent.video",
  audio: "block.remoteContent.audio",
  pdf: "block.remoteContent.pdf",
};

/** 目のアイコン（斜線入り）。lucide の eye-off と同じ形。 */
const EYE_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A11 11 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a10.9 10.9 0 0 0 5.4-1.4"/><path d="M9.9 4.2 2 2m20 20L2 2"/></svg>`;

/**
 * ブロック中の外部メディアを表す枠を作る。押すとそのノートの読み込みを許可する。
 *
 * onLoad は「このノートの外部メディアを読み込む」を呼ぶ関数。枠そのものをボタンに
 * しているのは、上部のバーまで視線を動かさずにその場で決められるようにするため。
 */
export function createBlockedMediaPlaceholder(
  kind: BlockedMediaKind,
  url: string,
  onLoad: () => void,
): HTMLElement {
  const host = remoteRefHost(url);

  const root = document.createElement("div");
  root.className = "graphium-remote-blocked";
  root.setAttribute("role", "button");
  root.setAttribute("tabindex", "0");
  root.setAttribute("contenteditable", "false");
  root.setAttribute("data-remote-content-blocked", "");
  root.title = t("block.remoteContent.action");
  Object.assign(root.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "72px",
    padding: "12px 14px",
    border: "1px dashed var(--color-border)",
    borderRadius: "8px",
    background: "var(--color-surface)",
    cursor: "pointer",
    userSelect: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const icon = document.createElement("span");
  icon.innerHTML = EYE_OFF_SVG;
  Object.assign(icon.style, {
    display: "inline-flex",
    flexShrink: "0",
    color: "var(--color-text-tertiary)",
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(icon);

  const body = document.createElement("div");
  Object.assign(body.style, {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: "0",
    flex: "1",
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement("span");
  title.textContent = host
    ? `${t(KIND_LABEL_KEY[kind])} — ${host}`
    : t(KIND_LABEL_KEY[kind]);
  Object.assign(title.style, {
    fontSize: "13px",
    fontWeight: "500",
    color: "var(--color-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  body.appendChild(title);

  const why = document.createElement("span");
  why.textContent = t("block.remoteContent.why");
  Object.assign(why.style, {
    fontSize: "12px",
    lineHeight: "1.4",
    color: "var(--color-text-tertiary)",
  } satisfies Partial<CSSStyleDeclaration>);
  body.appendChild(why);
  root.appendChild(body);

  const action = document.createElement("span");
  action.textContent = t("block.remoteContent.action");
  Object.assign(action.style, {
    flexShrink: "0",
    padding: "4px 10px",
    borderRadius: "var(--r-1)",
    border: "1px solid var(--color-border)",
    background: "var(--color-card)",
    fontSize: "12px",
    fontWeight: "500",
    color: "var(--color-foreground)",
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(action);

  root.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLoad();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onLoad();
  });

  return root;
}
