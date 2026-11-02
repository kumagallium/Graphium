// ──────────────────────────────────────────────
// ブロック → 平文（PROV の rdfs:comment / 本文 Entity 用）
//
// 手順の自由記述（段落・箇条書き・引用・コールアウト・コード・数式・計算・チャート・
// ブックマーク・表・メディアなど）を PROV に残すため、ブロックを 1 本の文字列にする。
// エディタや DOM に依存しない純関数 — MCP サーバー（Node）からも import する。
// prov-generator/index.ts（バレル）経由でなく、このファイルを直接 import すること。
// ──────────────────────────────────────────────

import { inlineContentToText, tableContentToText } from "../markdown-export/inline-text";

const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/** props から文字列を取り出す（文字列でなければ空文字） */
function propStr(block: any, key: string): string {
  const v = block?.props?.[key];
  return typeof v === "string" ? v : "";
}

/** URL の末尾（ファイル名）を取り出す。デコードに失敗したらそのまま返す */
function urlBasename(url: string): string {
  const last = url.split("/").pop()?.split("?")[0] ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** チャートブロックの config(JSON) から caption を取る。parse できなければ空文字 */
function chartCaption(block: any): string {
  const raw = propStr(block, "config");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.caption === "string" ? parsed.caption : "";
  } catch {
    return "";
  }
}

/** 1 ブロック（children は含めない）を平文にする。空なら "" */
export function blockToPlainText(block: any): string {
  if (!block || typeof block !== "object") return "";
  const type: string = block.type;

  switch (type) {
    case "paragraph":
    case "heading":
    case "bulletListItem":
    case "numberedListItem":
    case "quote":
    case "callout":
    case "codeBlock":
      return inlineContentToText(block.content);
    case "checkListItem": {
      const text = inlineContentToText(block.content);
      if (!text.trim()) return "";
      return `${block.props?.checked ? "[x]" : "[ ]"} ${text}`.trimEnd();
    }
    case "math":
      return propStr(block, "latex");
    case "calc": {
      const name = propStr(block, "name").trim();
      const source = propStr(block, "source");
      return [name, source].filter((s) => s !== "").join("\n");
    }
    case "chart":
      return chartCaption(block);
    case "bookmark": {
      const title = propStr(block, "title").trim();
      const description = propStr(block, "description").trim();
      return [title, description].filter((s) => s !== "").join(" — ");
    }
    case "dataTable":
      return propStr(block, "caption");
    case "table":
      return tableContentToText(block.content);
    default:
      break;
  }

  if (MEDIA_TYPES.has(type)) {
    const url = propStr(block, "url");
    const name = propStr(block, "name") || (url ? urlBasename(url) : "");
    const caption = propStr(block, "caption").trim();
    const head = name ? `[${type}: ${name}]` : `[${type}]`;
    return caption ? `${head} ${caption}` : head;
  }

  // それ以外は inline content が取れれば読む（取れなければ空）
  return inlineContentToText(block.content);
}

/** 見出しは "# " を level 数だけ前置する。他はそのまま */
function withHeadingPrefix(block: any, text: string): string {
  if (block?.type !== "heading") return text;
  const level = Math.min(6, Math.max(1, Number(block.props?.level) || 1));
  return `${"#".repeat(level)} ${text}`;
}

/** 深さ優先（children を含む）でブロックごとの平文を集める。空のブロックは除く */
export function collectBlockTexts(blocks: any[]): { blockId: string; text: string }[] {
  const out: { blockId: string; text: string }[] = [];
  const walk = (list: any[]) => {
    for (const block of list ?? []) {
      if (!block || typeof block !== "object") continue;
      const text = blockToPlainText(block);
      if (text.trim() !== "") {
        out.push({ blockId: String(block.id ?? ""), text: withHeadingPrefix(block, text) });
      }
      if (Array.isArray(block.children)) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

/** ページ全体を改行連結の平文にする（深さ優先・空行なし） */
export function blocksToPlainText(blocks: any[]): string {
  return collectBlockTexts(blocks)
    .map((e) => e.text)
    .join("\n");
}
