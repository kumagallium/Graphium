// 改ページの目安 — 本文を測る（DOM の読み取り）
//
// 印刷の本体は printNote が組むツリー（buildHeader ＋ cloneEditorContent）なので、
// 同じツリーを画面外に組んで測る（幅 170mm・同じ文字。app.css の .graphium-print-measure）。
// 印刷ルート（#graphium-print-root）の id は使わない（デスクトップでは印刷のあとも残り、
// 印刷の本物と取り違える）。測ったブロックの上下から、ページの始まりを page-breaks.ts の
// 純関数で決める。
//
// 画面側（用紙の中の本文）も同じ collectPageBlocks で読み、同じブロックの同じ行に対応させる。
// ProseMirror の DOM は読むだけで、属性もクラスも書かない。

import type { PaperSize } from "../../lib/document-types";
import {
  AVOID_BREAK_SELECTOR,
  buildHeader,
  cloneEditorContent,
  shrinkCalcBlocksToFit,
  waitForImages,
} from "../pdf-export/print-note";
import { PRINT_PAGE_CONTENT_HEIGHT_PX } from "./paper-layout";
import { computePageBreaks, type PageBlock, type PageBreak, type Span } from "./page-breaks";

/** 画像の読み込みを待つ上限（ms）。読み込めないものを待ち続けて目安が出なくならないようにする */
const IMAGE_WAIT_MS = 1500;

/** 見出しとして扱う h1〜h3（印刷の break-after: avoid が効く範囲） */
const KEEP_WITH_NEXT_HEADING = /^H[1-3]$/;

/**
 * 画面外の測る木に付けるクラス。レイアウトの規則は app.css の印刷の節が
 * `#graphium-print-root` と同じように当てる。
 */
export const MEASURE_ROOT_CLASS = "graphium-print-measure";

/** 要素の矩形（origin を 0 とした y）。 */
function spanOf(el: Element, originTop: number): Span {
  const r = el.getBoundingClientRect();
  return { top: r.top - originTop, bottom: r.bottom - originTop };
}

/**
 * 文字の行を取る。テキストノード（と行内の画像）の矩形を縦の位置でまとめて行にし、
 * 上下を隙間なく敷き詰める（先頭の上端と末尾の下端はブロックの上下に合わせ、行どうしの境は
 * 行間の真ん中）。こうしておくと「行の上端」が改ページの境目としてそのまま使える。
 */
function collectLines(content: Element, unit: Span, originTop: number): Span[] {
  const rects: Span[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || node.nodeValue.trim() === "") continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.height > 0) rects.push({ top: r.top - originTop, bottom: r.bottom - originTop });
    }
  }
  content.querySelectorAll("img").forEach((img) => {
    const r = img.getBoundingClientRect();
    if (r.height > 0) rects.push({ top: r.top - originTop, bottom: r.bottom - originTop });
  });
  if (rects.length === 0) return [];

  rects.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const lines: Span[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    const center = (r.top + r.bottom) / 2;
    if (last && center < last.bottom) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      lines.push({ top: r.top, bottom: r.bottom });
    }
  }
  // 敷き詰め
  const tiled = lines.map((l) => ({ ...l }));
  for (let i = 0; i < tiled.length; i++) {
    tiled[i].top = i === 0 ? unit.top : (lines[i - 1].bottom + lines[i].top) / 2;
    tiled[i].bottom = i === tiled.length - 1 ? unit.bottom : (lines[i].bottom + lines[i + 1].top) / 2;
  }
  return tiled;
}

/** 表の行。本文の行と同じく、上下を隙間なく敷き詰める必要は無い（行は元から隙間なく並ぶ） */
function collectRows(content: Element, originTop: number): Span[] {
  const rows: Span[] = [];
  content.querySelectorAll("tr").forEach((tr) => {
    const s = spanOf(tr, originTop);
    if (s.bottom > s.top) rows.push(s);
  });
  return rows;
}

/** 図の類か（行内の画像は文字の行の一部なので図にしない） */
function isFigureContent(content: Element): boolean {
  for (const el of content.querySelectorAll(AVOID_BREAK_SELECTOR)) {
    if (!el.closest(".bn-inline-content")) return true;
  }
  return false;
}

/**
 * エディタの本文を、上から順に（入れ子の子は親の次）ブロックの寸法の並びにして読む。
 * originTop は y の原点（測る木なら木の上端、画面なら用紙の目印の上端。ビューポートの y）。
 * 畳まれていて表示されないブロックは hidden にする（画面側だけで起きる。測る木では畳んだ所も出す）。
 */
export function collectPageBlocks(editorEl: Element, originTop: number): PageBlock[] {
  const blocks: PageBlock[] = [];

  const walkGroup = (group: Element) => {
    for (const child of group.children) {
      const nodeType = child.getAttribute("data-node-type");
      const id = child.getAttribute("data-id");
      if (nodeType === "columnList" && id) {
        // 段組みは 1 つの図として扱う（中の入れ子は降りない）
        const hidden = child.getClientRects().length === 0;
        const span = hidden ? { top: 0, bottom: 0 } : spanOf(child, originTop);
        blocks.push({ id, kind: "figure", ...span, hidden });
        continue;
      }
      if (nodeType !== "blockOuter" || !id) continue;

      const content = child.querySelector(".bn-block-content");
      if (content) {
        const hidden = content.getClientRects().length === 0;
        const span = hidden ? { top: 0, bottom: 0 } : spanOf(content, originTop);
        const type = content.getAttribute("data-content-type");
        if (hidden) {
          blocks.push({ id, kind: "text", ...span, hidden: true });
        } else if (type === "table") {
          const table = content.querySelector("table");
          blocks.push({
            id,
            kind: "table",
            ...span,
            rows: collectRows(content, originTop),
            tableHeight: table ? table.getBoundingClientRect().height : undefined,
          });
        } else if (isFigureContent(content)) {
          blocks.push({ id, kind: "figure", ...span });
        } else {
          const heading = content.querySelector(":scope > h1, :scope > h2, :scope > h3");
          const isHeading = type === "heading" && heading !== null && KEEP_WITH_NEXT_HEADING.test(heading.tagName);
          blocks.push({
            id,
            kind: isHeading ? "heading" : "text",
            ...span,
            lines: collectLines(content, span, originTop),
          });
        }
      }
      const children = child.querySelector(":scope > .bn-block > .bn-block-group");
      if (children) walkGroup(children);
    }
  };

  const root = editorEl.querySelector(":scope > .bn-block-group");
  if (root) walkGroup(root);
  return blocks;
}

/**
 * 測る木の動画・音声・iframe から読み込み元を外す。複製して body に付けるたびにブラウザが
 * 取得を始めるので（目安は編集のたびに測る）、高さだけ画面の比率で固定して src を落とす。
 * 画面（original）とクローンは同じ並びなので、添字で対応させる。
 */
function detachMedia(original: Element, clone: Element): void {
  const selector = "video, audio, iframe";
  const origs = original.querySelectorAll<HTMLElement>(selector);
  clone.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
    const r = origs[i]?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0 && el.tagName !== "AUDIO") {
      el.style.aspectRatio = `${r.width} / ${r.height}`;
      el.style.height = "auto";
    }
    el.removeAttribute("src");
    el.removeAttribute("srcdoc");
    el.removeAttribute("poster");
    if (el.tagName !== "IFRAME") el.setAttribute("preload", "none");
    el.querySelectorAll("source").forEach((s) => s.remove());
  });
}

/**
 * 印刷と同じ木を画面外に組んで測り、ページの始まりを返す。
 * 組んだ木は測り終えたら捨てる。editorElement は画面のエディタ（クローンして使い、書き換えない）。
 * paperSize は印刷の幅（A4 は 170mm、標準は 180mm）を決める。
 */
export async function measurePageBreaks(options: {
  title: string;
  editorElement: HTMLElement;
  labels?: Map<string, string>;
  paperSize?: PaperSize;
}): Promise<PageBreak[]> {
  const { title, editorElement, labels, paperSize } = options;
  const root = document.createElement("div");
  root.className = MEASURE_ROOT_CLASS;
  root.setAttribute("aria-hidden", "true");
  if (paperSize === "a4") root.dataset.paper = "a4";
  root.appendChild(buildHeader(title, labels));
  const clone = cloneEditorContent(editorElement);
  detachMedia(editorElement, clone);
  root.appendChild(clone);
  document.body.appendChild(root);
  try {
    // 読み込みを待たずに測ると、画像の高さが 0 のまま次の行が詰まる
    await Promise.race([
      waitForImages(root),
      new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_MS)),
    ]);
    shrinkCalcBlocksToFit(root);
    return pageBreaksOfTree(root, clone);
  } finally {
    root.remove();
  }
}

/** 組んだ木（root）から、ページの始まりを決める（テストから直接叩く） */
export function pageBreaksOfTree(root: HTMLElement, editorClone: Element): PageBreak[] {
  const originTop = root.getBoundingClientRect().top;
  const blocks = collectPageBlocks(editorClone, originTop);
  return computePageBreaks(blocks, PRINT_PAGE_CONTENT_HEIGHT_PX);
}
