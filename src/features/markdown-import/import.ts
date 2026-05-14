// Markdown import (single file / Obsidian Vault folder).
// 設計: importMarkdownToGraphiumDoc で 1 ノートに変換する。
// Obsidian の `[[Note]]` は 2 パスで解決する。1 パス目は本文中にプレースホルダで埋め込み、
// 2 パス目で baseName→noteId マップを使って実リンクへ復元する。
// 解決できなかった `[[X]]` はテキストとして残す（B-1）。

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import type { GraphiumDocument } from "../../lib/document-types";
import type { BlockLink } from "../block-link/link-types";

export type MarkdownImportOptions = {
  /** vault 内の他ファイル取得用。フォルダ一括時に画像解決で使う */
  resolveImage?: (relativePath: string) => Promise<File | null>;
  /** 画像を Graphium のメディア層にアップロードする処理 */
  uploadImage?: (file: File) => Promise<string>;
};

// プレースホルダ: 角括弧やコロン等は markdown の特別構文に当たるため避ける。
// 二重波括弧は CommonMark / Obsidian いずれも素通しする。
const SENTINEL_OPEN = "{{GWLINK_";
const SENTINEL_CLOSE = "}}";
const SENTINEL_REGEX = /\{\{GWLINK_(\d+)\}\}/g;

type WikiLinkRef = {
  /** リンク先のノート名 */
  target: string;
  /** 表示用エイリアス */
  display: string;
};

function parseWikiLinkInner(inner: string): WikiLinkRef {
  const pipe = inner.indexOf("|");
  let target = inner;
  let display: string | undefined;
  if (pipe >= 0) {
    target = inner.slice(0, pipe);
    display = inner.slice(pipe + 1);
  }
  // 見出しアンカー: "Target#Heading" → target は Target のみ
  const hash = target.indexOf("#");
  if (hash >= 0) {
    if (display === undefined) display = target;
    target = target.slice(0, hash);
  }
  return { target: target.trim(), display: (display ?? target).trim() };
}

/**
 * Pass 1: MD ファイル 1 個を Graphium ノートに変換する。
 * `[[Link]]` はプレースホルダに置き換え、wikilinks リストとして返す。
 */
export async function importMarkdownToGraphiumDoc(
  file: File,
  options: MarkdownImportOptions = {},
): Promise<{ doc: GraphiumDocument; wikilinks: WikiLinkRef[] }> {
  const baseTitle = file.name.replace(/\.(md|markdown)$/i, "") || "Untitled";
  const raw = await file.text();

  const { frontmatter, body } = splitFrontmatter(raw);

  const normalized = normalizeObsidianEmbeds(body);
  const orderedImageUrls: string[] = [];
  const withImagesRewritten = await rewriteImageReferences(normalized, options, orderedImageUrls);

  const wikilinks: WikiLinkRef[] = [];
  const withSentinels = withImagesRewritten.replace(/\[\[([^\[\]]+)\]\]/g, (_m, inner: string) => {
    const ref = parseWikiLinkInner(inner);
    const idx = wikilinks.length;
    wikilinks.push(ref);
    return `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`;
  });

  const schema = BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    styleSpecs: defaultStyleSpecs,
  });
  const editor = BlockNoteEditor.create({ schema });
  const blocks = editor.tryParseMarkdownToBlocks(withSentinels);

  // BlockNote の HTMLToBlocks は detached document 上で `imageElement.src` を読むため、
  // `media-server://` のような独自スキームは解決時に消えて空 URL になる。出現順で
  // 引き当てた upload URL を image ブロックに復元する（docx-import と同じ救済）。
  const fixedBlocks = orderedImageUrls.length > 0
    ? rewriteImageUrls(blocks as any[], orderedImageUrls)
    : (blocks as any[]);

  const finalBlocks: any[] = [];
  if (frontmatter !== null && frontmatter.trim().length > 0) {
    finalBlocks.push({
      id: crypto.randomUUID(),
      type: "codeBlock",
      props: { language: "yaml" },
      content: [{ type: "text", text: frontmatter, styles: {} }],
      children: [],
    });
  }
  finalBlocks.push(...fixedBlocks);

  const now = new Date().toISOString();
  return {
    doc: {
      version: 5,
      title: baseTitle,
      pages: [{
        id: crypto.randomUUID(),
        title: baseTitle,
        blocks: finalBlocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      }],
      createdAt: now,
      modifiedAt: now,
      source: "human",
    },
    wikilinks,
  };
}

/**
 * Pass 2: プレースホルダを実リンクに置換する。
 * - 解決済: 青字 `@display` の inline と reference 型 BlockLink を追加
 * - 未解決: 元の `[[Link]]` テキストに戻す
 */
export function resolveWikiLinks(
  doc: GraphiumDocument,
  wikilinks: WikiLinkRef[],
  resolver: (target: string) => string | null,
): GraphiumDocument {
  const knowledgeLinks: BlockLink[] = [...(doc.pages[0].knowledgeLinks as BlockLink[])];
  const newBlocks = (doc.pages[0].blocks as any[]).map((block) =>
    rewriteBlockSentinels(block, wikilinks, resolver, knowledgeLinks),
  );
  return {
    ...doc,
    pages: [{
      ...doc.pages[0],
      blocks: newBlocks,
      knowledgeLinks,
    }, ...doc.pages.slice(1)],
    modifiedAt: new Date().toISOString(),
  };
}

export function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown)$/i.test(file.name);
}

export function buildVaultMap(files: File[]): Map<string, File> {
  const map = new Map<string, File>();
  for (const f of files) {
    if (!isMarkdownFile(f)) continue;
    const baseName = f.name.replace(/\.(md|markdown)$/i, "");
    const key = baseName.toLowerCase();
    if (!map.has(key)) map.set(key, f);
  }
  return map;
}

// ──────────────────────────────────────────────
// 内部実装
// ──────────────────────────────────────────────

function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: null, body: raw };
  }
  const afterFirst = raw.replace(/^---\r?\n/, "");
  const m = afterFirst.match(/\r?\n---\r?\n/);
  if (!m || m.index === undefined) return { frontmatter: null, body: raw };
  const fm = afterFirst.slice(0, m.index);
  const body = afterFirst.slice(m.index + m[0].length);
  return { frontmatter: fm, body };
}

function normalizeObsidianEmbeds(md: string): string {
  return md.replace(/!\[\[([^\[\]]+)\]\]/g, (_m, inner: string) => {
    const pipe = inner.indexOf("|");
    const path = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
    return `![](${encodeMarkdownUrl(path)})`;
  });
}

function encodeMarkdownUrl(p: string): string {
  return p.replace(/ /g, "%20");
}

async function rewriteImageReferences(
  md: string,
  options: MarkdownImportOptions,
  orderedImageUrls: string[],
): Promise<string> {
  if (!options.resolveImage || !options.uploadImage) return md;

  const regex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches: { full: string; alt: string; url: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(md)) !== null) {
    matches.push({ full: m[0], alt: m[1], url: m[2], index: m.index });
  }
  if (matches.length === 0) return md;

  const replacements = new Map<string, string>();
  for (const ref of matches) {
    const url = decodeURIComponent(ref.url);
    if (/^[a-z]+:\/\//i.test(url) || url.startsWith("data:")) continue;
    if (replacements.has(ref.url)) continue;
    try {
      const file = await options.resolveImage(url);
      if (!file) continue;
      const newUrl = await options.uploadImage(file);
      replacements.set(ref.url, newUrl);
    } catch (err) {
      console.warn("[markdown-import] image resolve failed:", url, err);
    }
  }

  // 出現順で upload URL を控える（docx-import 側の救済処理が image ブロックの順番で
  // 当てに行くため、source ↔ block の順序が一致するようにここで蓄積する）。
  // 解決済 URL はプレースホルダ data URL に書き換えて、BlockNote の URL 正規化を回避する。
  return md.replace(regex, (_full, alt: string, url: string) => {
    const replaced = replacements.get(url);
    if (replaced) {
      const idx = orderedImageUrls.length;
      orderedImageUrls.push(replaced);
      const placeholder = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' data-graphium-idx='${idx}'/>`;
      return `![${alt}](${placeholder})`;
    }
    // 既に http(s) / data など解決済の URL は出現順記録のみ行い、source は変更しない。
    const lower = url.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) {
      orderedImageUrls.push(url);
    }
    return `![${alt}](${url})`;
  });
}

/** docx-import と同じ救済処理: image ブロックの url を出現順で差し替える */
function rewriteImageUrls(blocks: any[], orderedSrcs: string[]): any[] {
  let cursor = 0;
  const visit = (b: any): any => {
    if (!b || typeof b !== "object") return b;
    let next = b;
    if (b.type === "image" && cursor < orderedSrcs.length) {
      const src = orderedSrcs[cursor++];
      if (src) next = { ...b, props: { ...(b.props ?? {}), url: src } };
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      next = { ...next, children: b.children.map(visit) };
    }
    return next;
  };
  return blocks.map(visit);
}

function rewriteBlockSentinels(
  block: any,
  wikilinks: WikiLinkRef[],
  resolver: (target: string) => string | null,
  knowledgeLinks: BlockLink[],
): any {
  if (!block) return block;
  const newBlock = { ...block };
  if (Array.isArray(block.content)) {
    newBlock.content = expandSentinelInlines(block.content, block.id, wikilinks, resolver, knowledgeLinks);
  }
  if (Array.isArray(block.children) && block.children.length > 0) {
    newBlock.children = block.children.map((c: any) =>
      rewriteBlockSentinels(c, wikilinks, resolver, knowledgeLinks),
    );
  }
  return newBlock;
}

function expandSentinelInlines(
  inlines: any[],
  sourceBlockId: string,
  wikilinks: WikiLinkRef[],
  resolver: (target: string) => string | null,
  knowledgeLinks: BlockLink[],
): any[] {
  const result: any[] = [];
  for (const inline of inlines) {
    if (!inline || typeof inline !== "object" || inline.type !== "text" || typeof inline.text !== "string") {
      result.push(inline);
      continue;
    }
    const text: string = inline.text;
    if (!text.includes(SENTINEL_OPEN)) {
      result.push(inline);
      continue;
    }
    let lastIdx = 0;
    SENTINEL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTINEL_REGEX.exec(text)) !== null) {
      const before = text.slice(lastIdx, m.index);
      if (before) result.push({ ...inline, text: before });
      const refIdx = Number(m[1]);
      const ref = wikilinks[refIdx];
      if (!ref) {
        result.push({ ...inline, text: m[0] });
      } else {
        const resolvedNoteId = resolver(ref.target);
        if (resolvedNoteId) {
          result.push({
            type: "text",
            text: `@${ref.display}`,
            styles: { ...(inline.styles ?? {}), textColor: "blue" },
          });
          knowledgeLinks.push({
            id: `link-${Date.now()}-${knowledgeLinks.length}`,
            sourceBlockId,
            targetBlockId: "",
            targetNoteId: resolvedNoteId,
            type: "reference",
            layer: "knowledge",
            createdBy: "system",
          });
        } else {
          const restored = ref.display === ref.target
            ? `[[${ref.target}]]`
            : `[[${ref.target}|${ref.display}]]`;
          result.push({ ...inline, text: restored });
        }
      }
      lastIdx = m.index + m[0].length;
    }
    const tail = text.slice(lastIdx);
    if (tail) result.push({ ...inline, text: tail });
  }
  return result;
}
