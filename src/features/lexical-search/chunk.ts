// 語彙インデックスの索引単位（チャンク）を作る
//
// ノート 1 件を丸ごと 1 文書にすると、長いノートほど BM25 の長さ正規化で沈み、
// スニペットも「どこが当たったか」を示せない。ここではブロック列を ~600 文字の
// 塊に切り、先頭ブロック id を chunkId にする（将来ブロックへジャンプする導線に
// そのまま使える）。Wiki は embedding と同じ H2 セクション単位を別経路で渡すので
// ここでは扱わない。素材（OCR / PDF 抽出 / URL 抜粋）は段落境界で同じ幅に切る。

import type { GraphiumDocument } from "../../lib/document-types";
import { extractInlineText } from "../markdown-export/sanitize-blocks";

export type TextChunk = {
  /** チャンク id。ノートは先頭ブロック id、素材は `c0`, `c1`, … */
  chunkId: string;
  /** 索引・スニペット用の本文 */
  text: string;
  /** チャンクが属する直近の見出し（表示用の文脈。無ければ undefined） */
  heading?: string;
};

export type ChunkOptions = {
  /** これを超えたら次のチャンクへ（目安） */
  targetChars?: number;
  /** 1 段落がこれを超えるときは文境界で強制分割 */
  maxChars?: number;
  /** 見出しで区切るとき、直前チャンクがこれ未満なら区切らず続ける（小さすぎる塊を避ける） */
  minCharsBeforeHeadingBreak?: number;
};

const DEFAULTS: Required<ChunkOptions> = {
  targetChars: 600,
  maxChars: 900,
  minCharsBeforeHeadingBreak: 200,
};

/** ブロック 1 つの本文をテキストにする（inline / 表 / メディアのキャプション） */
function blockText(block: any): string {
  if (!block || typeof block !== "object") return "";
  const c = block.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) text = extractInlineText(c);
  else if (c && typeof c === "object" && Array.isArray(c.rows)) {
    // 表: セルを " | " で、行を改行で繋ぐ
    text = c.rows
      .map((row: any) =>
        (Array.isArray(row?.cells) ? row.cells : [])
          .map((cell: any) => (Array.isArray(cell) ? extractInlineText(cell) : extractInlineText(cell?.content)))
          .join(" | "),
      )
      .join("\n");
  }
  const props = block.props ?? {};
  // 一部のブロック型は本文を props.text に持つ（navigation/index-file の extractBlockText と同じ扱い）
  if (!text && typeof props.text === "string") text = props.text;
  // shared:// 引用カードは引用先タイトル・ファイル名で当たるようにする
  if (!text && block.type === "sharedCitation") {
    text = [props.cachedTitle, props.fileName].filter((s: unknown) => typeof s === "string" && s).join(" ");
  }
  // メディア系ブロックはキャプション / 名前を拾う（本文の代わり）
  const extras: string[] = [];
  if (typeof props.caption === "string" && props.caption.trim()) extras.push(props.caption.trim());
  if (!text && typeof props.name === "string" && props.name.trim()) extras.push(props.name.trim());
  if (extras.length > 0) text = [text, ...extras].filter(Boolean).join(" ");
  return text.trim();
}

type Line = { blockId: string; text: string; headingLevel?: number };

/** ブロック木を行に平坦化する（children / カラム / step コンテナも再帰） */
function flattenToLines(blocks: any[], out: Line[]): void {
  for (const b of blocks ?? []) {
    if (!b || typeof b !== "object") continue;
    const text = blockText(b);
    const isHeading = b.type === "heading";
    if (text) {
      out.push({
        blockId: String(b.id ?? ""),
        text: isHeading ? `${"#".repeat(Number(b.props?.level ?? 2))} ${text}` : text,
        headingLevel: isHeading ? Number(b.props?.level ?? 2) : undefined,
      });
    }
    if (Array.isArray(b.children) && b.children.length > 0) flattenToLines(b.children, out);
  }
}

/** 長い段落を文境界（。．.!?！？ / 改行）で maxChars 以下に割る */
export function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  const sentences = text.split(/(?<=[。．.!?！？])\s*|\n+/).filter((s) => s.length > 0);
  let cur = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) parts.push(cur);
      cur = "";
      for (let i = 0; i < s.length; i += maxChars) parts.push(s.slice(i, i + maxChars));
      continue;
    }
    if (cur.length + s.length > maxChars && cur) {
      parts.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur}${cur.endsWith("\n") ? "" : " "}${s}` : s;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** 行の列をチャンクに畳む。見出しで区切りつつ、小さすぎる塊は作らない */
function foldLines(lines: Line[], opts: Required<ChunkOptions>): TextChunk[] {
  const chunks: TextChunk[] = [];
  let curLines: string[] = [];
  let curChars = 0;
  let curId: string | null = null;
  let curHeading: string | undefined;
  let lastHeading: string | undefined;

  const flush = () => {
    if (curId !== null && curLines.length > 0) {
      const text = curLines.join("\n").trim();
      if (text) chunks.push({ chunkId: curId, text, heading: curHeading });
    }
    curLines = [];
    curChars = 0;
    curId = null;
    curHeading = undefined;
  };

  for (const line of lines) {
    const isSectionHeading = line.headingLevel !== undefined && line.headingLevel <= 2;
    if (isSectionHeading && curChars >= opts.minCharsBeforeHeadingBreak) flush();
    if (line.headingLevel !== undefined) lastHeading = line.text.replace(/^#+\s*/, "");

    const pieces = splitLongText(line.text, opts.maxChars);
    for (const piece of pieces) {
      if (curId !== null && curChars > 0 && curChars + piece.length > opts.targetChars) flush();
      if (curId === null) {
        curId = line.blockId || `c${chunks.length}`;
        // 見出し行そのものから始まるチャンクは、その見出しを文脈にする
        curHeading = line.headingLevel !== undefined ? line.text.replace(/^#+\s*/, "") : lastHeading;
      }
      curLines.push(piece);
      curChars += piece.length;
    }
  }
  flush();
  return chunks;
}

/** ノート本文（先頭ページ）をチャンク列にする */
export function chunkNoteDocument(doc: GraphiumDocument, options: ChunkOptions = {}): TextChunk[] {
  const opts = { ...DEFAULTS, ...options };
  const lines: Line[] = [];
  flattenToLines(doc.pages?.[0]?.blocks ?? [], lines);
  return foldLines(lines, opts);
}

/** プレーンテキスト（OCR / PDF 抽出 / URL 抜粋）を段落境界でチャンク列にする */
export function chunkPlainText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const opts = { ...DEFAULTS, ...options };
  const paragraphs = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}|\n(?=\S)/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length > 0);
  const lines: Line[] = paragraphs.map((p, i) => ({ blockId: `c${i}`, text: p }));
  const chunks = foldLines(lines, opts);
  // 素材のチャンク id は連番に揃える（段落番号は内部都合で外に見せない）
  return chunks.map((c, i) => ({ ...c, chunkId: `c${i}` }));
}
