// 上付き・下付き（superscript / subscript）の共通定義と Markdown との相互変換
//
// ノート本文では BlockNote の boolean style（content[].styles.superscript / .subscript）
// として持つ。エディタ側の定義（style spec・ショートカット・ツールバーのボタン）は
// base/script-styles.ts。ここにはエディタに依存しない純ロジックだけを置く。
//
// Markdown には上付き・下付きの記法が無いので HTML の <sup> / <sub> で表す。
// GitHub・Obsidian・VitePress などの Markdown 表示でもそのまま上付き・下付きになり、
// AI もそのまま読める。書式を捨てて素のテキストにすると「10⁵」が「105」、
// 「x₁₀」が「x10」になり、AI への引用やエクスポートで意味が変わってしまう。

import { maskCodeRegions, unmaskCodeRegions } from "./markdown-code-regions";

export type ScriptStyle = "superscript" | "subscript";

/** 上付き → 下付きの順（ツールバーに並べる順でもある） */
export const SCRIPT_STYLES: readonly ScriptStyle[] = ["superscript", "subscript"];

const TAGS: Record<ScriptStyle, "sup" | "sub"> = { superscript: "sup", subscript: "sub" };

/** 表示・書き出しに使う HTML タグ名 */
export function scriptStyleTag(style: ScriptStyle): "sup" | "sub" {
  return TAGS[style];
}

/** 上付きと下付きは同時に付けない。片方を付けるときに外す側を返す */
export function oppositeScriptStyle(style: ScriptStyle): ScriptStyle {
  return style === "superscript" ? "subscript" : "superscript";
}

/** styles に付いている上付き・下付き（両方ある壊れたデータは上付きを優先） */
function activeScriptStyle(styles: Record<string, unknown> | undefined): ScriptStyle | null {
  if (styles?.superscript) return "superscript";
  if (styles?.subscript) return "subscript";
  return null;
}

function withoutScriptStyles(styles: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styles ?? {})) {
    if (key !== "superscript" && key !== "subscript") rest[key] = value;
  }
  return rest;
}

// ─────────────────────────────────────────────
// 書き出し（ブロック → Markdown）
// ─────────────────────────────────────────────

// タグの中で Markdown 記法として働いてしまう文字。* や _ は同じ行の別の * と組になって
// 強調に化けうる（「p* と q*」の上付きアスタリスク同士が斜体の範囲を作ってしまう）。
const MARKDOWN_SPECIALS = /[\\`*_[\]~]/g;

function escapeForScriptTag(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MARKDOWN_SPECIALS, (c) => `\\${c}`);
}

/**
 * テキスト 1 片を Markdown 用に <sup> / <sub> で包む。
 * 戻り値の styles からは上付き・下付きを除く（残りの書式だけを呼び出し側が扱う）。
 * コード書式（styles.code）の片は包まない — コードの中ではタグが文字のまま出るため。
 */
export function scriptStyleToMarkdown(
  text: string,
  styles: Record<string, unknown> | undefined,
): { text: string; styles: Record<string, unknown> } {
  const style = activeScriptStyle(styles);
  if (!style) return { text, styles: styles ?? {} };
  const rest = withoutScriptStyles(styles);
  if (!text || styles?.code) return { text, styles: rest };
  const tag = TAGS[style];
  return { text: `<${tag}>${escapeForScriptTag(text)}</${tag}>`, styles: rest };
}

// ─────────────────────────────────────────────
// 取り込み（Markdown → ブロック）
// ─────────────────────────────────────────────

// パース前にタグを置き換える目印。Markdown として無害な文字列にする
// （数式の {{GWMATH_n}}・wikilink の {{GWLINK_n}} と同じ流儀）
const MARKERS: Record<ScriptStyle, { open: string; close: string }> = {
  superscript: { open: "{{GWSUP_OPEN}}", close: "{{GWSUP_CLOSE}}" },
  subscript: { open: "{{GWSUB_OPEN}}", close: "{{GWSUB_CLOSE}}" },
};
const MARKER_REGEX = /\{\{GW(SUP|SUB)_(OPEN|CLOSE)\}\}/g;
const MARKER_HEAD = "{{GWSU";

// 1 行の中で閉じている <sup>…</sup> / <sub>…</sub>。中身に改行・表の区切り（|）・
// 入れ子の sup / sub タグを含むものは対象外にして、従来どおり BlockNote に任せる
// （目印の片方だけが別の段落やセルに分かれないようにするため）。
const SCRIPT_TAG_PAIR = /<(sup|sub)(?:\s[^<>]*)?>((?:(?!<\/?(?:sup|sub)\b)[^\n|])+?)<\/\1\s*>/gi;

/**
 * Markdown 中の <sup>…</sup> / <sub>…</sub> を目印に置き換える（パース前）。
 *
 * BlockNote の Markdown パーサは生の HTML タグを捨てて中身だけを残す。そこでタグの
 * 位置だけを目印として残し、中身は通常どおり Markdown として解釈させる。脚注リンク
 * （<sup>[1](#fn1)</sup>）や \* のエスケープ、&amp; などの文字参照もそのまま効く。
 * コード領域の中は置き換えない（HTML のサンプルコードを壊さないため）。
 */
export function markScriptTags(markdown: string): string {
  if (!/<su[pb]\b/i.test(markdown)) return markdown;
  const { text, codes } = maskCodeRegions(markdown);
  const marked = text.replace(SCRIPT_TAG_PAIR, (_full, tag: string, inner: string) => {
    const marker = MARKERS[tag.toLowerCase() === "sup" ? "superscript" : "subscript"];
    return `${marker.open}${inner}${marker.close}`;
  });
  return unmaskCodeRegions(marked, codes);
}

/**
 * パース済みブロック配列から目印を取り除き、目印に挟まれたテキストに上付き・下付きを付ける。
 * 目印は markScriptTags が同じ行の中で対にしたものなので、段落・見出し・セルの
 * inline 配列 1 つの中で閉じる。リンクの中身にまたがることはあるので、
 * 「いま上付きの中か」は配列の中で持ち越す。
 */
export function restoreScriptTags(blocks: unknown): any[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(restoreBlock);
}

function restoreBlock(block: any): any {
  if (!block || typeof block !== "object") return block;
  let next = block;
  if (Array.isArray(block.children) && block.children.length > 0) {
    const children = block.children.map(restoreBlock);
    if (children.some((c: any, i: number) => c !== block.children[i])) next = { ...next, children };
  }
  const content = restoreContent(block.content);
  if (content !== block.content) next = { ...next, content };
  return next;
}

function restoreContent(content: any): any {
  if (Array.isArray(content)) return restoreInlines(content);
  if (content && typeof content === "object" && Array.isArray(content.rows)) {
    // テーブルはセル（inline 配列 / { type: "tableCell", content }）ごとに戻す
    const rows = content.rows.map((row: any) => {
      if (!Array.isArray(row?.cells)) return row;
      const cells = row.cells.map((cell: any) => {
        if (Array.isArray(cell)) return restoreInlines(cell);
        if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
          const inner = restoreInlines(cell.content);
          return inner === cell.content ? cell : { ...cell, content: inner };
        }
        return cell;
      });
      return cells.some((c: any, i: number) => c !== row.cells[i]) ? { ...row, cells } : row;
    });
    return rows.some((r: any, i: number) => r !== content.rows[i]) ? { ...content, rows } : content;
  }
  return content;
}

function containsMarker(inline: any): boolean {
  if (!inline || typeof inline !== "object") return false;
  if (typeof inline.text === "string" && inline.text.includes(MARKER_HEAD)) return true;
  return Array.isArray(inline.content) && inline.content.some(containsMarker);
}

function restoreInlines(inlines: any[]): any[] {
  if (!inlines.some(containsMarker)) return inlines;
  return applyMarkers(inlines, { active: null });
}

function applyMarkers(inlines: any[], state: { active: ScriptStyle | null }): any[] {
  const out: any[] = [];
  for (const inline of inlines) {
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      out.push({ ...inline, content: applyMarkers(inline.content, state) });
      continue;
    }
    if (!inline || inline.type !== "text" || typeof inline.text !== "string") {
      out.push(inline);
      continue;
    }
    const text: string = inline.text;
    let last = 0;
    MARKER_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_REGEX.exec(text)) !== null) {
      pushPiece(out, inline, text.slice(last, m.index), state.active);
      const style: ScriptStyle = m[1] === "SUP" ? "superscript" : "subscript";
      if (m[2] === "OPEN") state.active = style;
      else if (state.active === style) state.active = null;
      last = m.index + m[0].length;
    }
    pushPiece(out, inline, text.slice(last), state.active);
  }
  return out;
}

function pushPiece(out: any[], inline: any, text: string, active: ScriptStyle | null): void {
  if (!text) return;
  if (!active) {
    out.push(text === inline.text ? inline : { ...inline, text });
    return;
  }
  out.push({ ...inline, text, styles: { ...withoutScriptStyles(inline.styles), [active]: true } });
}
