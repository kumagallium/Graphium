// 同梱ユーザーマニュアル（manual/*.md）を「節」に割って AI に渡せる形にする。
// parseManualPage は純粋関数。loadManualSections は import.meta.glob で遅延読み込みする。

import { splitLongText } from "../lexical-search";
import { MANUAL_BASE_URL } from "./manual-url";

export type ManualLocale = "ja" | "en";

export type ManualSection = {
  id: string;
  page: string;
  pageTitle: string;
  heading: string;
  anchor?: string;
  url: string;
  text: string;
};


/** 検索対象から外すページ（evaluations/ 配下は glob に入らない） */
export const EXCLUDED_MANUAL_PAGES = ["release-history", "roadmap"];

/** 1 節の最大文字数。超えたら分ける */
const MAX_SECTION_CHARS = 2400;

/** 中身ごと消すタグ（Badge は版の印で、本文ではない） */
const DROP_WITH_CONTENT = new Set(["script", "style", "badge"]);

/**
 * 見出し・本文から HTML / Vue のタグを消す（タグだけ消して中の文字は残す）。
 * script・style・Badge は中身ごと、コメントも丸ごと消す。正規表現ではなく 1 文字ずつ読む
 * （閉じタグの書き方の揺れで取りこぼさないように）。残った < と > も落とす。AI に渡す
 * 地の文なので要らず、包みのタグ（<graphium-manual>）を本文が閉じたように見せることもなくなる
 */
function stripInlineMarkup(s: string): string {
  const lower = s.toLowerCase();
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== "<") {
      if (ch !== ">") out += ch;
      i += 1;
      continue;
    }
    if (lower.startsWith("<!--", i)) {
      const end = lower.indexOf("-->", i + 4);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    const name = /^<\/?([a-z][a-z0-9-]*)/.exec(lower.slice(i, i + 40))?.[1];
    const tagEnd = name ? lower.indexOf(">", i) : -1;
    if (!name || tagEnd === -1) {
      // ただの「<」（不等号など）は落とすだけ
      i += 1;
      continue;
    }
    const isOpen = lower[i + 1] !== "/";
    const selfClosing = lower[tagEnd - 1] === "/";
    if (isOpen && !selfClosing && DROP_WITH_CONTENT.has(name)) {
      // 閉じタグ（名前の後に空白や属性があってもよい）まで飛ばす
      const close = lower.indexOf(`</${name}`, tagEnd);
      const closeEnd = close === -1 ? -1 : lower.indexOf(">", close);
      i = closeEnd === -1 ? s.length : closeEnd + 1;
      continue;
    }
    i = tagEnd + 1;
  }
  return out;
}

/** 本文の前処理（コードフェンスの外側だけに適用する） */
function cleanProse(chunk: string): string {
  let s = stripInlineMarkup(chunk);
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return s;
}

/** コードフェンスの内外を分けて、外側だけ cleanProse を掛ける。コンテナ行（:::）も外側だけ処理する */
function cleanMarkdown(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length === 0) return;
    out.push(cleanProse(buf.join("\n")));
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  // コンテナ行（::: tip 題 → 題、::: 単独 → 消す）。フェンス内は触らない
  let fence = false;
  const lines2: string[] = [];
  for (const line of out.join("\n").split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && /^\s*:::/.test(line)) {
      const rest = line.replace(/^\s*:::+\s*[A-Za-z-]*\s*/, "").trim();
      if (rest) lines2.push(rest);
      continue;
    }
    lines2.push(line);
  }
  return lines2.join("\n").replace(/\n{3,}/g, "\n\n");
}

function stripFrontmatter(md: string): string {
  const m = /^﻿?---\s*\n[\s\S]*?\n---\s*(\n|$)/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

function buildUrl(locale: ManualLocale, page: string, anchor?: string): string {
  return (
    MANUAL_BASE_URL +
    (locale === "ja" ? "ja/" : "") +
    (page === "index" ? "" : page) +
    (anchor ? `#${anchor}` : "")
  );
}

type RawSection = { heading: string; anchor?: string; lines: string[] };

export function parseManualPage(page: string, markdown: string, locale: ManualLocale): ManualSection[] {
  // 先にコメント・script・style を落とす（見出し判定が巻き込まれないように）
  const src = stripFrontmatter(markdown.replace(/\r\n?/g, "\n"));

  // 見出し判定はコードフェンスの外だけ
  let pageTitle = "";
  const raws: RawSection[] = [];
  let cur: RawSection = { heading: "", lines: [] }; // 先頭（最初の ## より前）
  raws.push(cur);
  let inFence = false;
  let inBlockComment = false;
  // 見出しの入れ子（## → ### → ####）。節の見出しは親からの道（「親 › 子」）にし、
  // 自分にアンカーが無い節は、いちばん近い親のアンカーへリンクする
  const stack: { level: number; title: string; anchor?: string }[] = [];
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.lines.push(line);
      continue;
    }
    if (inFence) {
      cur.lines.push(line);
      continue;
    }
    // 複数行の HTML コメント内は見出し扱いしない
    if (inBlockComment) {
      cur.lines.push(line);
      if (line.includes("-->")) inBlockComment = false;
      continue;
    }
    if (line.includes("<!--") && !line.includes("-->")) {
      inBlockComment = true;
      cur.lines.push(line);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      let title = h[2].trim();
      let anchor: string | undefined;
      const am = /\s*\{#([^}\s]+)\}\s*$/.exec(title);
      if (am) {
        anchor = am[1];
        title = title.slice(0, am.index);
      }
      title = stripInlineMarkup(title).replace(/\s+/g, " ").trim();
      if (level === 1) {
        if (!pageTitle) {
          pageTitle = title;
          continue;
        }
        cur.lines.push(line);
        continue;
      }
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title, anchor });
      const inherited = [...stack].reverse().find((s) => s.anchor)?.anchor;
      cur = { heading: stack.map((s) => s.title).join(" › "), anchor: inherited, lines: [] };
      raws.push(cur);
      continue;
    }
    cur.lines.push(line);
  }
  if (!pageTitle) pageTitle = page;

  const out: ManualSection[] = [];
  let seq = 0;
  for (const raw of raws) {
    const heading = raw === raws[0] ? pageTitle : raw.heading;
    const text = cleanMarkdown(raw.lines.join("\n")).trim();
    if (!text) continue;
    const anchor = raw === raws[0] ? undefined : raw.anchor;
    const url = buildUrl(locale, page, anchor);
    const parts = splitLongText(text, MAX_SECTION_CHARS)
      .map((p) => p.trim())
      .filter(Boolean);
    parts.forEach((part, i) => {
      seq += 1;
      out.push({
        id: `${locale}:${page}:${seq}${i > 0 ? `#${i + 1}` : ""}`,
        page,
        pageTitle,
        heading,
        anchor,
        url,
        text: part,
      });
    });
  }
  return out;
}

const cache = new Map<ManualLocale, Promise<ManualSection[]>>();

/** manual 配下の md を遅延読み込みし、全ページを節にして返す（locale ごとにキャッシュ） */
export function loadManualSections(locale: ManualLocale): Promise<ManualSection[]> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const p = (async () => {
    const files: Record<string, () => Promise<unknown>> =
      locale === "ja"
        ? import.meta.glob("/manual/ja/*.md", { query: "?raw", import: "default" })
        : import.meta.glob("/manual/*.md", { query: "?raw", import: "default" });
    const result: ManualSection[] = [];
    for (const path of Object.keys(files).sort()) {
      const page = path.replace(/^.*\//, "").replace(/\.md$/, "");
      if (EXCLUDED_MANUAL_PAGES.includes(page)) continue;
      const raw = await files[path]();
      if (typeof raw !== "string") continue;
      result.push(...parseManualPage(page, raw, locale));
    }
    return result;
  })();
  cache.set(locale, p);
  p.catch(() => cache.delete(locale));
  return p;
}
