// 空のリスト項目に「複数行のテキスト」を貼ったときの扱い。
//
// 空のリスト項目への貼り付けは、BlockNote に任せるとブロックが paragraph に
// 置き換わってリスト項目が消えるため、メイン（note-app.tsx）とサイドピーク
// （side-peek.tsx）でブロック型を保ったまま文字を差し込む救済をしている。
// ただし複数行のテキストまで 1 つのブロックに流し込むと、別のページからコピーした
// 箇条書きの「* 子項目」がそのまま文字として残り、ブロックに分かれない。
// 複数行のときは Markdown として読み、カーソルのリスト項目を最初の項目にして
// ブロック（入れ子のリスト・見出し・引用など）に分けて差し込む。

import { parseMarkdownToBlocksWithMath } from "../math/markdown-math";

type ListType = "bulletListItem" | "numberedListItem" | "checkListItem";

// 行頭のリスト記号（Markdown の * - +、番号、ワープロ系のプレーンテキストに出る •・‣ ◦ ▪）
const LIST_MARKER_RE = /^\s*(?:[*+\-]|\d+[.)])\s/;
const WORD_BULLET_RE = /^(\s*)[•‣◦▪●・](?:\s+|(?=\S))/;

/** 末尾の改行を除いた結果が 2 行以上か */
export function isMultilinePaste(plain: string): boolean {
  return /\r?\n/.test(plain.replace(/[\r\n]+$/g, "").replace(/^(?:[ \t]*\r?\n)+/, ""));
}

/**
 * 空のリスト項目に貼る複数行テキストを Markdown にそろえる。
 * - 改行を \n に、タブを 4 つの空白にする（入れ子の深さを Markdown が読めるように）
 * - 「•」「・」などの記号は Markdown の「* 」に置き換える
 * - 1 行目にリスト記号が無ければ、貼った先のリスト項目の種類の記号を付ける
 *   （1 行目が貼った先の項目そのものになり、続く「  * 子」がその子になる）
 */
export function toListPasteMarkdown(plain: string, listType: ListType): string {
  const lines = plain
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "")
    .replace(/^(?:[ \t]*\n)+/, "")
    .split("\n")
    .map((line) => line.replace(/\t/g, "    ").replace(WORD_BULLET_RE, "$1* "));
  const first = lines[0] ?? "";
  if (!LIST_MARKER_RE.test(first)) {
    const marker =
      listType === "numberedListItem" ? "1. " : listType === "checkListItem" ? "* [ ] " : "* ";
    // 1 行目の字下げは捨てる（字下げが残ると 4 つ以上でコードブロックになる）
    lines[0] = marker + first.trimStart();
  }
  return lines.join("\n");
}

function lastDescendant(block: any): any {
  let cur = block;
  while (Array.isArray(cur?.children) && cur.children.length > 0) {
    cur = cur.children[cur.children.length - 1];
  }
  return cur;
}

/**
 * 空のリスト項目に複数行のテキストを貼ったとき、Markdown としてブロックに分けて
 * 差し込む。扱ったら true（呼び出し側は preventDefault 済みにすること）。
 * 1 行だけの貼り付けや、解析で何も出なかったときは false（従来の救済に任せる）。
 */
export function pasteMultilineIntoEmptyListItem(
  editor: any,
  cursorBlock: any,
  plain: string,
): boolean {
  if (!isMultilinePaste(plain)) return false;
  const listType = cursorBlock?.type as ListType;
  const markdown = toListPasteMarkdown(plain, listType);
  let parsed: any[];
  try {
    parsed = parseMarkdownToBlocksWithMath(editor, markdown);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  // 貼った先の項目が子を持っていたら、最後に差し込んだブロックの子として残す
  const existingChildren = Array.isArray(cursorBlock.children) ? cursorBlock.children : [];
  if (existingChildren.length > 0) {
    const last = parsed[parsed.length - 1];
    parsed[parsed.length - 1] = {
      ...last,
      children: [...(Array.isArray(last.children) ? last.children : []), ...existingChildren],
    };
  }
  const result = editor.replaceBlocks([cursorBlock], parsed);
  const inserted: any[] = result?.insertedBlocks ?? [];
  // カーソルは貼った中身の最後（いちばん深い最後の項目の末尾）へ。
  // 元の子を付けたときは、その手前（貼った分の最後）に置く
  const lastInserted = inserted[inserted.length - 1];
  if (lastInserted) {
    const target =
      existingChildren.length > 0
        ? lastInserted
        : lastDescendant(lastInserted);
    try {
      editor.setTextCursorPosition(target, "end");
    } catch {
      // カーソルの移動に失敗しても、貼り付けそのものは済んでいる
    }
  }
  return true;
}

/**
 * 複数行で、HTML 側にリスト・見出し・表の構造があるときは BlockNote の貼り付けに任せる
 * （Web ページや他のエディタからのコピー。HTML のほうが入れ子や太字・リンクを正しく運ぶ）。
 */
export function hasStructuredHtml(plain: string, html: string | undefined | null): boolean {
  if (!html || !isMultilinePaste(plain)) return false;
  return /<(?:li|h[1-6]|table|blockquote|pre)[\s>]/i.test(html);
}
