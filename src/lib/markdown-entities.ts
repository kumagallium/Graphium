// Markdown から作ったブロックの文字参照（&amp; &lt; &#60; &copy; など）を元の文字に戻す。
//
// BlockNote 0.47 の Markdown パーサ（unified / remark）は CommonMark どおり本文の文字参照を
// 戻していたが、0.51 で置き換わった自前パーサは戻さない（`\*` のような \ エスケープは戻す）。
// そのままだと、取り込んだ Markdown や AI の回答に `&amp;` があると本文に `&amp;` が残る。
//
// CommonMark と同じく、コード（コードブロック・インラインコード）の中は戻さない。
// 上付き・下付きの中は lib/script-styles.ts の restoreScriptTags が戻し済みなので触らない
// （二重に戻すと、書き手が意図した「&amp;lt;」が「<」になってしまう）。

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

/** 名前付きの文字参照を DOM に解かせる（textarea の innerHTML は実行されない）。DOM が無ければ主要なものだけ */
const FALLBACK_NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®",
};
let decoder: HTMLTextAreaElement | null = null;
function decodeNamed(name: string): string | null {
  if (typeof document !== "undefined") {
    decoder ??= document.createElement("textarea");
    decoder.innerHTML = `&${name};`;
    const out = decoder.value;
    return out === `&${name};` ? null : out;
  }
  return FALLBACK_NAMED[name] ?? null;
}

/** 1 つの文字列の文字参照を戻す。知らない名前はそのまま残す */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
      // CommonMark: 0 と範囲外・サロゲートは U+FFFD
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return decodeNamed(name!) ?? whole;
  });
}

function decodeInlines(inlines: any[]): any[] {
  let changed = false;
  const out = inlines.map((inline) => {
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      const content = decodeInlines(inline.content);
      if (content === inline.content) return inline;
      changed = true;
      return { ...inline, content };
    }
    if (!inline || inline.type !== "text" || typeof inline.text !== "string") return inline;
    const styles = inline.styles ?? {};
    if (styles.code || styles.superscript || styles.subscript) return inline;
    const text = decodeEntities(inline.text);
    if (text === inline.text) return inline;
    changed = true;
    return { ...inline, text };
  });
  return changed ? out : inlines;
}

function decodeContent(content: any): any {
  if (Array.isArray(content)) return decodeInlines(content);
  if (content && typeof content === "object" && Array.isArray(content.rows)) {
    let changed = false;
    const rows = content.rows.map((row: any) => {
      if (!Array.isArray(row?.cells)) return row;
      let rowChanged = false;
      const cells = row.cells.map((cell: any) => {
        if (Array.isArray(cell)) {
          const next = decodeInlines(cell);
          if (next !== cell) rowChanged = true;
          return next;
        }
        if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
          const next = decodeInlines(cell.content);
          if (next === cell.content) return cell;
          rowChanged = true;
          return { ...cell, content: next };
        }
        return cell;
      });
      if (!rowChanged) return row;
      changed = true;
      return { ...row, cells };
    });
    return changed ? { ...content, rows } : content;
  }
  return content;
}

function decodeBlock(block: any): any {
  if (!block || typeof block !== "object") return block;
  let next = block;
  // コードブロックの中身は書かれたとおり（CommonMark のコードと同じ）
  if (block.type !== "codeBlock") {
    const content = decodeContent(block.content);
    if (content !== block.content) next = { ...next, content };
  }
  if (Array.isArray(block.children) && block.children.length > 0) {
    const children = block.children.map(decodeBlock);
    if (children.some((c: any, i: number) => c !== block.children[i])) next = { ...next, children };
  }
  return next;
}

/** パース済みブロック配列の本文の文字参照を戻す（コード・上付き・下付きの中は除く） */
export function decodeEntitiesInBlocks(blocks: unknown): any[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(decodeBlock);
}
