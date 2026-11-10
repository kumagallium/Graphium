// 会話の中に描くノートプレビューの画面（MCP Apps の View）。
//
// Claude Desktop などのホストが iframe に読み込み、postMessage でホストとやり取りする。
// 道具の結果の structuredContent.preview（note-preview.ts の NotePreview）を受け取って描く。
//
// ⚠️ ノートの文字は必ず textContent で入れる。innerHTML は使わない（本文の <script> 等を実行させない）。
// ⚠️ 外のサイトから何も読まない（フォント・画像・スクリプト）。CSP を空のまま通すため。

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

import type { NotePreview, PreviewBlock, PreviewRun } from "../note-preview";
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
  },
  en: {
    loading: "Loading the note…",
    empty: "This note has no content yet",
    truncated: "This note is long, so only the beginning is shown. Open it in Graphium for the rest.",
    updated: "Updated",
    writtenBy: "Written by",
    readOnly: "Read-only preview",
    failed: "Could not show the preview",
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

function renderRuns(parent: HTMLElement, runs: PreviewRun[]): void {
  for (const run of runs) {
    let node: HTMLElement;
    if (run.math) node = el("code", "math", run.text);
    else if (run.code) node = el("code", undefined, run.text);
    else if (run.script) node = el(run.script, undefined, run.text);
    else node = el("span", undefined, run.text);
    if (run.bold) node.style.fontWeight = "600";
    if (run.italic) node.style.fontStyle = "italic";
    if (run.strike) node.style.textDecoration = "line-through";
    if (run.link) node.classList.add("link");
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

function renderBlock(block: PreviewBlock): HTMLElement {
  switch (block.kind) {
    case "heading": {
      const h = el(`h${Math.min(block.level + 1, 5)}` as "h2");
      renderRuns(h, block.runs);
      return withLabel(h, block.label);
    }
    case "step": {
      const s = el("div", "step");
      s.appendChild(el("span", "step-no", String(block.order)));
      const title = el("span", "step-title");
      renderRuns(title, block.runs);
      s.appendChild(title);
      // 手順は番号の丸がラベルの役を兼ねるので、札は付けず左の線と色だけにする
      s.classList.add("labeled");
      s.style.setProperty("--label-color", labelColor(block.label ?? "procedure"));
      return s;
    }
    case "paragraph":
    case "bullet":
    case "numbered":
    case "check": {
      const p = el("div", `line ${block.kind}`);
      p.style.marginLeft = `${block.depth * 18}px`;
      if (block.kind === "bullet") p.appendChild(el("span", "marker", "•"));
      if (block.kind === "numbered") p.appendChild(el("span", "marker", "–"));
      if (block.kind === "check") p.appendChild(el("span", "marker", block.checked ? "☑" : "☐"));
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
    case "math":
      return el("pre", "math-block", block.text);
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
      return el("div", "media", `[${block.mediaType}] ${block.name}`.trim());
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
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.locale) lang = ctx.locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function isPreview(value: unknown): value is NotePreview {
  const v = value as NotePreview | undefined;
  return !!v && typeof v.noteId === "string" && Array.isArray(v.blocks);
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
