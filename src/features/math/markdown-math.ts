// Markdown ↔ 数式ブロック / インライン数式の相互変換
//
// 背景: BlockNote の tryParseMarkdownToBlocks は数式構文を知らない。論文 PDF の
// 全文翻訳では LLM が `\[ ... \]` や `$$ ... $$` で数式を出すが、そのまま食わせると
//   - `\[` のバックスラッシュが Markdown のエスケープとして消えて `[` だけ残る
//   - 中の `^` `_` `*` が強調記法として解釈されて式が壊れる
// という二重の破壊が起きる（実データで `[\n\log P = \log A - b T \tag{2}\n]` を確認）。
//
// 方針: markdown-import の wikilink と同じセンチネル 2 パス方式を取る。
//   1. パース前に数式を取り出し `{{GWMATH_n}}` に置き換える（Markdown 的に無害な文字列）
//   2. パース後にセンチネルを math ブロック / inlineMath インラインに戻す
//
// コード領域（``` フェンス / `インラインコード`）の中身は数式として扱わない。
// LaTeX のサンプルコードを載せたノートを壊さないため。

/** 退避した数式 1 個 */
export type MathStash = {
  /** LaTeX 本文（デリミタを除いた中身） */
  latex: string;
  /** ブロック数式（$$ / \[ \]）なら true、インライン数式なら false */
  display: boolean;
};

const SENTINEL_PREFIX = "{{GWMATH_";
const CODE_PREFIX = "{{GWCODE_";
const SENTINEL_SUFFIX = "}}";
const SENTINEL_REGEX = /\{\{GWMATH_(\d+)\}\}/g;

/** インライン数式として認める最大文字数（長すぎるものは誤検出とみなす） */
const MAX_INLINE_LATEX = 200;

// ─────────────────────────────────────────────
// パース前: 数式をセンチネルへ退避
// ─────────────────────────────────────────────

/**
 * Markdown 中の数式をセンチネルに退避する。
 * ブロック数式は前後を空行で挟み、パース後に「センチネルだけの段落」になるようにする。
 */
export function stashMath(markdown: string): { text: string; math: MathStash[] } {
  const math: MathStash[] = [];
  const { text: masked, codes } = maskCodeRegions(markdown);

  const push = (latex: string, display: boolean): string => {
    const idx = math.length;
    math.push({ latex, display });
    const sentinel = `${SENTINEL_PREFIX}${idx}${SENTINEL_SUFFIX}`;
    // ブロック数式は独立した段落になるよう前後に空行を足す
    return display ? `\n\n${sentinel}\n\n` : sentinel;
  };

  let text = masked;

  // ブロック数式: $$ ... $$ / \[ ... \]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (full, inner: string) => {
    const latex = inner.trim();
    return latex ? push(latex, true) : full;
  });
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (full, inner: string) => {
    const latex = inner.trim();
    return latex ? push(latex, true) : full;
  });

  // インライン数式: \( ... \) （デリミタが明示的なので条件なしで拾う）
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (full, inner: string) => {
    const latex = inner.trim();
    return latex && latex.length <= MAX_INLINE_LATEX ? push(latex, false) : full;
  });

  // インライン数式: $ ... $
  // 金額（"$100 と $200"）を誤って数式にしないよう、remark-math と同じく
  // 「開きの直後が非空白」「閉じの直前が非空白」「中に改行を含まない」を課す。
  text = text.replace(/(?<![$\\])\$(?!\s)([^$\n]*[^\s$])\$(?!\$)/g, (full, inner: string) => {
    const latex = inner.trim();
    return latex && latex.length <= MAX_INLINE_LATEX ? push(latex, false) : full;
  });

  return { text: unmaskCodeRegions(text, codes), math };
}

/** コード領域をセンチネルに退避する（数式判定から除外するため） */
function maskCodeRegions(markdown: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const stash = (m: string): string => {
    codes.push(m);
    return `${CODE_PREFIX}${codes.length - 1}${SENTINEL_SUFFIX}`;
  };
  const text = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, stash)
    .replace(/`[^`\n]*`/g, stash);
  return { text, codes };
}

/** maskCodeRegions で退避したコード領域を元に戻す */
function unmaskCodeRegions(text: string, codes: string[]): string {
  if (codes.length === 0) return text;
  return text.replace(/\{\{GWCODE_(\d+)\}\}/g, (full, n: string) => {
    const code = codes[Number(n)];
    return code === undefined ? full : code;
  });
}

// ─────────────────────────────────────────────
// パース後: センチネルを数式に復元
// ─────────────────────────────────────────────

/**
 * パース済みブロック配列のセンチネルを数式に戻す。
 * - センチネル 1 個だけの段落 かつ ブロック数式 → math ブロックに差し替え
 * - それ以外の位置に残ったセンチネル → inlineMath インラインに展開
 */
export function restoreMath(blocks: unknown, math: MathStash[]): any[] {
  if (!Array.isArray(blocks)) return [];
  if (math.length === 0) return blocks as any[];
  return blocks.map((b) => restoreBlock(b, math));
}

function restoreBlock(block: any, math: MathStash[]): any {
  if (!block || typeof block !== "object") return block;

  const children = Array.isArray(block.children) && block.children.length > 0
    ? block.children.map((c: any) => restoreBlock(c, math))
    : block.children;

  // 段落まるごとがブロック数式のケース
  const soleIndex = soleSentinelIndex(block, math);
  if (soleIndex !== null) {
    return {
      id: block.id,
      type: "math",
      props: { latex: math[soleIndex].latex },
      content: undefined,
      children: children ?? [],
    };
  }

  const next = { ...block };
  if (children !== block.children) next.children = children;
  if (Array.isArray(block.content)) {
    next.content = expandSentinelInlines(block.content, math);
  } else if (block.content && typeof block.content === "object" && Array.isArray(block.content.rows)) {
    // テーブルのセルにも数式が入りうる
    next.content = {
      ...block.content,
      rows: block.content.rows.map((row: any) => ({
        ...row,
        cells: Array.isArray(row?.cells)
          ? row.cells.map((cell: any) => {
              if (Array.isArray(cell)) return expandSentinelInlines(cell, math);
              if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
                return { ...cell, content: expandSentinelInlines(cell.content, math) };
              }
              return cell;
            })
          : row?.cells,
      })),
    };
  }
  return next;
}

/**
 * 「その段落の中身がブロック数式センチネル 1 個だけ」なら、その stash index を返す。
 * 見出しやリスト項目は数式ブロックに化けさせない（構造を保つ）。
 */
function soleSentinelIndex(block: any, math: MathStash[]): number | null {
  if (block.type !== "paragraph" || !Array.isArray(block.content)) return null;
  const text = block.content
    .map((c: any) => (c && typeof c.text === "string" ? c.text : ""))
    .join("");
  if (block.content.some((c: any) => !c || c.type !== "text")) return null;
  const m = text.trim().match(/^\{\{GWMATH_(\d+)\}\}$/);
  if (!m) return null;
  const idx = Number(m[1]);
  const entry = math[idx];
  if (!entry || !entry.display) return null;
  return idx;
}

/** inline content 配列内のセンチネルを inlineMath に展開する */
function expandSentinelInlines(inlines: any[], math: MathStash[]): any[] {
  const result: any[] = [];
  for (const inline of inlines) {
    if (!inline || typeof inline !== "object") {
      result.push(inline);
      continue;
    }
    // link の中身にも数式が入りうるので再帰する
    if (inline.type === "link" && Array.isArray(inline.content)) {
      result.push({ ...inline, content: expandSentinelInlines(inline.content, math) });
      continue;
    }
    if (inline.type !== "text" || typeof inline.text !== "string" || !inline.text.includes(SENTINEL_PREFIX)) {
      result.push(inline);
      continue;
    }

    const text: string = inline.text;
    let lastIdx = 0;
    SENTINEL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTINEL_REGEX.exec(text)) !== null) {
      const before = text.slice(lastIdx, m.index);
      if (before) result.push({ ...inline, text: before });
      const entry = math[Number(m[1])];
      if (!entry) {
        // 対応する stash が無い（ありえないが）場合は元のテキストを残す
        result.push({ ...inline, text: m[0] });
      } else {
        result.push({ type: "inlineMath", props: { latex: entry.latex } });
      }
      lastIdx = m.index + m[0].length;
    }
    const tail = text.slice(lastIdx);
    if (tail) result.push({ ...inline, text: tail });
  }
  return result;
}

// ─────────────────────────────────────────────
// エディタ経由の入口
// ─────────────────────────────────────────────

/**
 * `editor.tryParseMarkdownToBlocks` の数式対応版。
 * Markdown → ブロック変換をする箇所はこの関数を通すこと（素の tryParse は数式を壊す）。
 */
export function parseMarkdownToBlocksWithMath(editor: any, markdown: string): any[] {
  const { text, math } = stashMath(markdown);
  const blocks = editor.tryParseMarkdownToBlocks(text) as any[];
  return restoreMath(blocks, math);
}

// ─────────────────────────────────────────────
// 書き出し（ブロック → Markdown）
// ─────────────────────────────────────────────

/**
 * math ブロックの LaTeX を Markdown のブロック数式表記にする。
 *
 * 改行を空白に潰して 1 行にするのが要点。BlockNote の blocksToMarkdownLossy は
 * 段落内の改行を hard break（行末バックスラッシュ）として書き出すため、
 * `$$\n...\n$$` のまま渡すと `$$\` という壊れた行になり、読み戻せなくなる。
 * LaTeX は空白区切りなので 1 行化しても式の意味は変わらない（行列の `\\` は残る）。
 */
export function mathBlockToMarkdown(latex: string): string {
  const body = (latex ?? "").trim().replace(/\s*\n\s*/g, " ");
  return body ? `$$ ${body} $$` : "";
}

/** inlineMath の LaTeX を Markdown のインライン数式表記にする */
export function inlineMathToMarkdown(latex: string): string {
  const body = (latex ?? "").trim();
  return body ? `$${body}$` : "";
}
