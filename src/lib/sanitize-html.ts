// 外部由来の HTML 断片（.docx を mammoth で変換した結果など）を、許可リストで清めてから差し込む。
//
// DOMParser は scripts を実行せず画像も取りに行かないので、解釈してから要素ごとに検査できる。
// 許可する要素・属性は文書の読み取りに要る最小限。許可外の要素は子だけ残して外す
// （script / style など中身ごと危険なものは丸ごと落とす）。依存は足さない。

import { isClobberingId } from "./clobber-id";
import { safeExternalHref } from "./safe-href";

const ALLOWED_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "strong", "b", "em", "i", "u", "s", "strike", "sub", "sup",
  "a", "img",
]);

/** 中身ごと落とす要素（子を残すと文字として見えてしまうもの・実行や外部読み込みにつながるもの） */
const DROP_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "template", "noscript", "svg", "math", "link", "meta", "base", "form", "input",
  "button", "textarea", "select", "title", "audio", "video", "source", "track", "canvas",
]);

/** 要素ごとの許可属性（ここに無い属性は落とす。on* / style / class も含めて落ちる） */
const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  a: ["href", "id", "title"],
  // mammoth の脚注は li の id、コメントは dt / dd の id へ # リンクで飛ぶ
  li: ["id"],
  dt: ["id"],
  dd: ["id"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  col: ["span"],
  colgroup: ["span"],
};

function isSafeImgSrc(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase();
  return v.startsWith("data:image/") || v.startsWith("blob:");
}

function sanitizeChildren(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      // コメント・CDATA・処理命令は落とす
      parent.removeChild(child);
      continue;
    }
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      parent.removeChild(el);
      continue;
    }
    // 先に子を清めてから、許可外なら子だけ残して要素を外す
    sanitizeChildren(el);
    if (!ALLOWED_TAGS.has(tag)) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      continue;
    }
    const allowed = ALLOWED_ATTRS[tag] ?? [];
    for (const name of el.getAttributeNames()) {
      if (!allowed.includes(name.toLowerCase())) el.removeAttribute(name);
    }
    // window / document の既存名を隠す id（DOM クロバリング）は落とす
    if (el.hasAttribute("id") && isClobberingId(el.getAttribute("id") ?? "")) el.removeAttribute("id");
    if (tag === "a" && el.hasAttribute("href")) {
      const href = el.getAttribute("href") ?? "";
      if (href.startsWith("#")) continue; // 文書内のしおり
      const safe = safeExternalHref(href);
      if (safe) {
        el.setAttribute("href", safe);
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      } else {
        el.removeAttribute("href");
      }
    }
    if (tag === "img") {
      if (!isSafeImgSrc(el.getAttribute("src") ?? "")) {
        parent.removeChild(el);
      }
    }
  }
}

/** HTML 断片を許可リストで清めた HTML 文字列にして返す。 */
export function sanitizeHtmlFragment(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}
