// 会話の中に描くノートプレビューの画面（MCP Apps の View）。
//
// Claude Desktop などのホストが iframe に読み込み、postMessage でホストとやり取りする。
// 道具の結果の structuredContent.preview（note-preview.ts の NotePreview）を受け取って描く。
// 画像は結果の _meta["graphium/previewImages"]（blockId → data URL）で別に届く。
//
// 見た目はアプリのノートに寄せる（紙と墨の色・Inter・本文 16px / 行間 1.7・見出しの大きさ）。
// アプリに暗い表示は無いので、ホストが暗い表示でも Graphium の紙の色のまま描く。
//
// ⚠️ ノートの文字は必ず textContent で入れる。本文を HTML として解釈しない。
//    例外は KaTeX が組んだ MathML だけで、これも許可した要素・属性以外を落としてから入れる。
// ⚠️ 外のサイトから何も読まない（フォント・画像・スクリプト）。CSP を空のまま通すため。

import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import type { NotePreview, PreviewBlock, PreviewRun } from "../note-preview";
import { INLINE_LABEL_COLORS } from "../../features/inline-label/colors";
import { labelColor, labelName } from "./label-style";

type Lang = "ja" | "en";

const TEXT: Record<Lang, Record<string, string>> = {
  ja: {
    loading: "ノートを読み込んでいます…",
    empty: "本文はまだありません",
    truncated: "長いノートなので途中までを表示しています。続きは Graphium で開いてください。",
    updated: "更新",
    writtenBy: "書いたもの",
    readOnly: "読み取り専用のプレビュー",
    failed: "プレビューを表示できませんでした",
    remote: "外部の画像（プレビューでは読み込みません）",
    missing: "画像はプレビューに含めていません",
  },
  en: {
    loading: "Loading the note…",
    empty: "This note has no content yet",
    truncated: "This note is long, so only the beginning is shown. Open it in Graphium for the rest.",
    updated: "Updated",
    writtenBy: "Written by",
    readOnly: "Read-only preview",
    failed: "Could not show the preview",
    remote: "External image (not loaded in the preview)",
    missing: "Image not included in the preview",
  },
};

let lang: Lang = navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
const root = document.getElementById("root")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── MathML（KaTeX の出力）を安全に入れる ─────────────────────────

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
/** KaTeX の MathML 出力に出てくる要素だけを通す */
const MATHML_TAGS = new Set([
  "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mover", "munder", "munderover",
  "mtable", "mtr", "mtd", "mstyle", "mpadded", "mphantom", "menclose", "merror", "mlabeledtr",
]);
const MATHML_ATTRS = new Set([
  "display", "encoding", "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace",
  "accent", "accentunder", "linethickness", "columnalign", "rowalign", "columnspacing",
  "rowspacing", "columnlines", "rowlines", "scriptlevel", "displaystyle", "width", "height",
  "depth", "voffset", "notation", "minsize", "maxsize", "movablelimits", "largeop", "symmetric",
  "mathcolor", "mathbackground", "mathsize", "form", "xmlns",
]);

function sanitizeMath(node: Element): Element | null {
  if (node.namespaceURI !== MATHML_NS || !MATHML_TAGS.has(node.localName)) return null;
  const out = document.createElementNS(MATHML_NS, node.localName);
  for (const attr of Array.from(node.attributes)) {
    if (MATHML_ATTRS.has(attr.name)) out.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out.appendChild(document.createTextNode(child.textContent ?? ""));
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const clean = sanitizeMath(child as Element);
      if (clean) out.appendChild(clean);
    }
  }
  return out;
}

/** KaTeX の出力（<span class="katex"><math>…</math></span>）から <math> だけを取り出して清める */
function mathNode(mathml: string): Element | null {
  const doc = new DOMParser().parseFromString(mathml, "text/html");
  const math = doc.querySelector("math");
  return math ? sanitizeMath(math) : null;
}

// ── 描画 ──────────────────────────────────────────────────

function renderRuns(parent: HTMLElement, runs: PreviewRun[]): void {
  for (const run of runs) {
    let node: HTMLElement;
    const math = run.mathml ? mathNode(run.mathml) : null;
    if (math) {
      node = el("span", "math");
      node.appendChild(math);
    } else if (run.math) node = el("code", "math-src", run.text);
    else if (run.code) node = el("code", undefined, run.text);
    else if (run.script) node = el(run.script, undefined, run.text);
    else node = el("span", undefined, run.text);
    if (run.bold) node.style.fontWeight = "600";
    if (run.italic) node.style.fontStyle = "italic";
    if (run.strike) node.style.textDecoration = "line-through";
    if (run.link) node.classList.add("link");
    if (run.inlineLabel) {
      // アプリのエディタと同じ描き方（薄い背景と下線）。名前はホバーで出す
      const colors = INLINE_LABEL_COLORS[run.inlineLabel];
      node.classList.add("inline-label");
      node.style.backgroundColor = colors.bg;
      node.style.borderBottomColor = colors.border;
      node.title = labelName(run.inlineLabel, lang);
    }
    parent.appendChild(node);
  }
}

function labelBadge(label: string): HTMLElement {
  const badge = el("span", "label", labelName(label, lang));
  badge.style.setProperty("--label-color", labelColor(label));
  return badge;
}

function withLabel(node: HTMLElement, label: string | undefined): HTMLElement {
  if (label) {
    node.classList.add("labeled");
    node.style.setProperty("--label-color", labelColor(label));
    node.prepend(labelBadge(label));
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** アプリの手順ブロックのアイコン（lucide の ListChecks と同じ線） */
function listChecksIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("step-icon");
  for (const d of ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

let images: Record<string, string> = {};

function renderMedia(block: Extract<PreviewBlock, { kind: "media" }>): HTMLElement {
  const t = TEXT[lang];
  const src = images[block.blockId];
  // data URL 以外は描かない（外へ読みに行かない）
  if (block.mediaType === "image" && src?.startsWith("data:image/")) {
    const fig = el("figure", "image");
    const img = el("img");
    img.src = src;
    img.alt = block.caption || block.name;
    fig.appendChild(img);
    if (block.caption) fig.appendChild(el("figcaption", undefined, block.caption));
    return fig;
  }
  const box = el("div", "media");
  box.appendChild(el("span", "media-name", block.name || `[${block.mediaType}]`));
  if (block.mediaType === "image") {
    box.appendChild(
      el("span", "media-note", block.remoteHost ? `${t.remote} · ${block.remoteHost}` : t.missing),
    );
  }
  return box;
}

function renderBlock(block: PreviewBlock): HTMLElement {
  switch (block.kind) {
    case "heading": {
      const h = el(`h${Math.min(block.level + 1, 4)}` as "h2");
      renderRuns(h, block.runs);
      return withLabel(h, block.label);
    }
    case "step": {
      // アプリの手順ブロックと同じ「カード」: 左に太い線・薄い全周枠、ステップ名は塗りのある帯
      const card = el("section", "step");
      const head = el("div", "step-head");
      head.appendChild(listChecksIcon());
      const title = el("span", "step-title");
      renderRuns(title, block.runs);
      head.appendChild(title);
      card.appendChild(head);
      const body = el("div", "step-body");
      for (const child of block.children) body.appendChild(renderBlock(child));
      card.appendChild(body);
      return card;
    }
    case "paragraph":
    case "bullet":
    case "numbered":
    case "check": {
      const p = el("div", `line ${block.kind}`);
      p.style.marginLeft = `${block.depth * 24}px`;
      if (block.kind === "bullet") p.appendChild(el("span", "marker", "•"));
      if (block.kind === "numbered") p.appendChild(el("span", "marker", "–"));
      if (block.kind === "check") {
        const box = el("span", `checkbox${block.checked ? " checked" : ""}`, block.checked ? "✓" : "");
        p.appendChild(box);
        if (block.checked) p.classList.add("done");
      }
      const body = el("span", "line-body");
      renderRuns(body, block.runs);
      p.appendChild(body);
      return withLabel(p, block.label);
    }
    case "code": {
      const pre = el("pre");
      pre.appendChild(el("code", undefined, block.text));
      return pre;
    }
    case "math": {
      const math = block.mathml ? mathNode(block.mathml) : null;
      if (math) {
        const box = el("div", "math-block");
        box.appendChild(math);
        return box;
      }
      return el("pre", "math-src", block.text);
    }
    case "table": {
      const wrap = el("div", "table-wrap");
      const table = el("table");
      block.rows.forEach((row, i) => {
        const tr = el("tr");
        for (const cell of row) {
          const td = el(i === 0 ? "th" : "td");
          renderRuns(td, cell);
          tr.appendChild(td);
        }
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      return withLabel(wrap, block.label);
    }
    case "media":
      return renderMedia(block);
    case "divider":
      return el("hr");
    case "other":
      return el("div", "other", `[${block.blockType}]`);
  }
}

function render(preview: NotePreview): void {
  const t = TEXT[lang];
  root.replaceChildren();
  const card = el("article", "card");

  const header = el("header");
  header.appendChild(el("h1", "title", preview.title));
  const meta = el("div", "meta");
  const metaParts: string[] = [];
  if (preview.folder) metaParts.push(preview.folder);
  if (preview.modifiedAt) metaParts.push(`${t.updated} ${preview.modifiedAt.slice(0, 10)}`);
  if (preview.generatedBy) metaParts.push(`${t.writtenBy}: ${preview.generatedBy}`);
  meta.textContent = metaParts.join(" · ");
  if (metaParts.length > 0) header.appendChild(meta);
  card.appendChild(header);

  const body = el("div", "body");
  if (preview.blocks.length === 0) body.appendChild(el("p", "muted", t.empty));
  for (const block of preview.blocks) body.appendChild(renderBlock(block));
  card.appendChild(body);

  const footer = el("footer");
  if (preview.truncated) footer.appendChild(el("p", "muted", t.truncated));
  footer.appendChild(el("span", "muted", `${t.readOnly} · Graphium · ${preview.noteId}`));
  card.appendChild(footer);

  root.appendChild(card);
}

function renderMessage(message: string): void {
  root.replaceChildren(el("p", "muted", message));
}

function applyContext(ctx: McpUiHostContext | undefined): void {
  // 色・フォントはホストに合わせない（アプリのノートと同じ見た目にする）。言語だけ合わせる
  if (ctx?.locale) lang = ctx.locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function isPreview(value: unknown): value is NotePreview {
  const v = value as NotePreview | undefined;
  return !!v && typeof v.noteId === "string" && Array.isArray(v.blocks);
}

function imagesOf(meta: unknown): Record<string, string> {
  const raw = (meta as Record<string, unknown> | undefined)?.["graphium/previewImages"];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [blockId, src] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof src === "string" && src.startsWith("data:image/")) out[blockId] = src;
  }
  return out;
}

renderMessage(TEXT[lang].loading);

const app = new App({ name: "Graphium note preview", version: "1.0.0" });
/** 言語が後から分かったときに描き直すため、最後に描いたものを持っておく */
let current: NotePreview | null = null;

// 結果の通知は connect の直後に来ることがあるので、connect より先に受け口を付ける
app.ontoolresult = (result) => {
  const preview = (result.structuredContent as { preview?: unknown } | undefined)?.preview;
  if (isPreview(preview)) {
    current = preview;
    images = imagesOf(result._meta);
    render(preview);
  } else {
    renderMessage(TEXT[lang].failed);
  }
};
app.onhostcontextchanged = (ctx) => {
  const before = lang;
  applyContext(ctx);
  if (current && lang !== before) render(current);
};

app
  .connect()
  .then(() => {
    const before = lang;
    applyContext(app.getHostContext());
    if (current && lang !== before) render(current);
  })
  .catch(() => renderMessage(TEXT[lang].failed));
