// Markdown -> BlockNote ブロック配列への最小変換。
//
// これは scripts/claude-code-skill/save-to-graphium/save.mjs の変換ロジック
// （74〜330 行あたり）を TypeScript に移植したもの。
// **save.mjs とは重複実装であり、片方のロジックを変えたらもう片方も必ず直すこと。**
// save.mjs は Node 標準ライブラリのみで動く軽量スクリプトとして独立に保つ必要があり、
// このファイルへの一本化はしていない（背景は save.mjs 冒頭コメント参照）。
//
// 挙動は save.mjs と完全に一致させる（同じ Markdown を入れたら同じブロック JSON
// が出る）。ブロック ID の生成（randomUUID）も踏襲する。

import { randomUUID } from "node:crypto";

/** BlockNote のインライン content の 1 要素（text / link）を緩く表す型 */
export type InlineContent = Record<string, unknown>;

/** BlockNote のブロック 1 件を緩く表す型（type ごとに構造が異なるため緩い形で受ける） */
export type Block = Record<string, unknown>;

/** BlockNote のブロックひな形を作る共通部分 */
export function makeProps(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    textColor: "default",
    backgroundColor: "default",
    textAlignment: "left",
    ...extra,
  };
}

/**
 * BlockNote のインライン content にパースする。
 * 対応: **bold**, *italic*, `code`, [text](url)
 * 未クローズや他の記法は plain text として扱う。
 */
export function parseInlineContent(text: string): InlineContent[] {
  if (!text) return [{ type: "text", text: "", styles: {} }];

  const result: InlineContent[] = [];
  let remaining = text;

  const pushText = (t: string, styles: Record<string, unknown> = {}) => {
    if (!t) return;
    // 直前と同じ styles ならマージして出力量を抑える
    const last = result[result.length - 1];
    if (
      last &&
      last.type === "text" &&
      JSON.stringify(last.styles) === JSON.stringify(styles)
    ) {
      last.text = `${last.text as string}${t}`;
    } else {
      result.push({ type: "text", text: t, styles });
    }
  };

  while (remaining.length > 0) {
    // **bold**
    const boldMatch = remaining.match(/^\*\*([^*\n]+?)\*\*/);
    if (boldMatch) {
      pushText(boldMatch[1], { bold: true });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // `code`
    const codeMatch = remaining.match(/^`([^`\n]+?)`/);
    if (codeMatch) {
      pushText(codeMatch[1], { code: true });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // [text](url)
    const linkMatch = remaining.match(/^\[([^\]\n]+?)\]\(([^)\n]+?)\)/);
    if (linkMatch) {
      result.push({
        type: "link",
        href: linkMatch[2],
        content: [{ type: "text", text: linkMatch[1], styles: {} }],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // *italic* (bold より後でチェックし、** を巻き込まないように)
    const italicMatch = remaining.match(/^\*([^*\n]+?)\*/);
    if (italicMatch) {
      pushText(italicMatch[1], { italic: true });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // plain text: 次の特殊記号まで取り込む
    const nextSpecial = remaining.search(/\*\*|`|\[|\*/);
    if (nextSpecial === -1) {
      pushText(remaining);
      break;
    } else if (nextSpecial === 0) {
      // 特殊記号で始まるが match できなかった（未クローズ）→ 1文字だけ plain として消費
      pushText(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      pushText(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return result.length > 0 ? result : [{ type: "text", text: "", styles: {} }];
}

export function headingBlock(level: number, text: string): Block {
  return {
    id: randomUUID(),
    type: "heading",
    props: makeProps({ level }),
    content: parseInlineContent(text),
    children: [],
  };
}

export function paragraphBlock(text: string): Block {
  return {
    id: randomUUID(),
    type: "paragraph",
    props: makeProps(),
    content: parseInlineContent(text),
    children: [],
  };
}

export function bulletListItemBlock(text: string): Block {
  return {
    id: randomUUID(),
    type: "bulletListItem",
    props: makeProps(),
    content: parseInlineContent(text),
    children: [],
  };
}

export function codeBlock(lang: string, code: string): Block {
  return {
    id: randomUUID(),
    type: "codeBlock",
    props: { language: lang || "text" },
    // コードブロックはインライン装飾を解釈しない（そのまま出力）
    content: [{ type: "text", text: code, styles: {} }],
    children: [],
  };
}

/** "| a | b | c |" → ["a", "b", "c"] */
export function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** テーブルセパレータ行の判定（|---|---|---| 形式、: で alignment） */
export function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s\-:|]+\|\s*$/.test(line) && /-/.test(line);
}

export function tableBlock(rows: string[][]): Block {
  return {
    id: randomUUID(),
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: cells.map((cell) => parseInlineContent(cell)),
      })),
    },
    children: [],
  };
}

/**
 * Markdown -> BlockNote ブロック配列の最小変換。
 * 対応: h1-h3, 箇条書き (-,*), 番号なしと番号付きは区別せず bulletListItem として扱う,
 *       フェンス付きコードブロック (```lang), 空行区切りのパラグラフ。
 * それ以外はすべて paragraph として保持する。
 */
export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // コードブロック
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "text";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(codeBlock(lang, buf.join("\n")));
      continue;
    }

    // 見出し
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (heading) {
      blocks.push(headingBlock(heading[1].length, heading[2]));
      i++;
      continue;
    }

    // テーブル（| col | col | ...  +  次行が |---|---| セパレータ）
    if (
      /^\s*\|(.+)\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const rows = [splitTableRow(line)];
      i += 2; // ヘッダー行とセパレータ行をスキップ
      while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(tableBlock(rows));
      continue;
    }

    // 箇条書き (ネスト非対応: 先頭記号をそのまま除去)
    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(bulletListItemBlock(line.replace(/^\s*[-*]\s+/, "")));
      i++;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      blocks.push(bulletListItemBlock(line.replace(/^\s*\d+\.\s+/, "")));
      i++;
      continue;
    }

    // 空行はスキップ
    if (line.trim() === "") {
      i++;
      continue;
    }

    // パラグラフ (空行または別種ブロックまで連結)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*\|.+\|\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(paragraphBlock(buf.join(" ")));
  }

  if (blocks.length === 0) {
    blocks.push(paragraphBlock(""));
  }
  return blocks;
}
