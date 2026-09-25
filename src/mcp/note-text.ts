// ノート本体（BlockNote の JSON）からテキスト・手順・アウトラインを取り出す。
//
// src/features/markdown-export は BlockNoteEditor を実体化して Markdown を作るが、
// MCP サーバーは stdio で spawn されるたびに起動するため、エディタの初期化コスト
// （と DOM 前提の依存）を持ち込めない。ここでは Claude が読める程度の軽量な
// Markdown 化に絞って自前で実装する。往復変換の忠実さは目的ではない。
// inline の文字列化と数式の表記だけは、Markdown 書き出しと同じ純関数
// （inline-text.ts / markdown-math.ts。エディタに依存しない）を借りて表記を揃える。
//
// ブロック走査の規則は src/features/navigation/index-file.ts の collectOutline に揃える:
//   - step コンテナは content がタイトル、children が中身
//   - columnList / column はレイアウト用ラッパーなので透過する
//
// 既定は AI（MCP の外部エージェント）に渡す本文で、上付き・下付きを <sup> / <sub> で包む
// （落とすと「10⁵」が「105」になる）。検索索引や照合キーのようにタグを入れたくない所は
// { scripts: false } を渡す。数式（$…$ / $$…$$）はどちらでも残す。

import { inlineContentToText, type InlineTextOptions } from "../features/markdown-export/inline-text";
import { mathBlockToMarkdown } from "../features/math/markdown-math";

const FOR_AI: InlineTextOptions = { scripts: true };

/** inline content からテキストを取り出す（inlineMath は LaTeX を $ で囲む） */
export function extractInlineText(content: unknown, options: InlineTextOptions = FOR_AI): string {
  return inlineContentToText(content, options);
}

/** table content（{ rows: [{ cells }] }）を Markdown テーブルに落とす */
function tableToMarkdown(content: unknown, options: InlineTextOptions): string {
  const rows = (content as any)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cellText = (cell: unknown): string => {
    if (Array.isArray(cell)) return extractInlineText(cell, options);
    if (cell && typeof cell === "object" && Array.isArray((cell as any).content)) {
      return extractInlineText((cell as any).content, options);
    }
    return "";
  };
  const lines: string[] = [];
  rows.forEach((row: any, i: number) => {
    const cells = Array.isArray(row?.cells) ? row.cells.map(cellText) : [];
    lines.push(`| ${cells.join(" | ")} |`);
    if (i === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n");
}

export type StepInfo = {
  blockId: string;
  /** step コンテナのタイトル（content 由来） */
  title: string;
  /** step の中身をテキスト化したもの */
  body: string;
  /** step 配下の全ブロック ID。index の inlineLabels を手順単位に絞るのに使う */
  childBlockIds: string[];
  /** 文書順の連番（1 始まり）。工程は並びなので順序が意味を持つ */
  order: number;
};

/** ブロック配下の ID を再帰的に集める */
function collectBlockIds(blocks: any[], out: string[]): void {
  for (const b of blocks || []) {
    if (b?.id) out.push(b.id);
    if (b?.children?.length) collectBlockIds(b.children, out);
  }
}

/**
 * ブロック列を Markdown 文字列にする。
 * step は「### n. タイトル」として出し、中身をインデントせず続けて並べる。
 */
export function blocksToMarkdown(blocks: any[], depth = 0, options: InlineTextOptions = FOR_AI): string {
  const out: string[] = [];
  let stepNo = 0;

  for (const block of blocks || []) {
    if (!block || typeof block !== "object") continue;
    const type = block.type as string;

    // レイアウト用ラッパーは透過（中身だけ出す）
    if (type === "columnList" || type === "column") {
      if (block.children?.length) out.push(blocksToMarkdown(block.children, depth, options));
      continue;
    }

    if (type === "step") {
      stepNo += 1;
      const title = extractInlineText(block.content, options) || `(step ${stepNo})`;
      out.push(`### ${stepNo}. ${title}`);
      if (block.children?.length) out.push(blocksToMarkdown(block.children, depth, options));
      continue;
    }

    const text = extractInlineText(block.content, options);

    switch (type) {
      case "heading": {
        const level = Number(block.props?.level) || 2;
        if (text) out.push(`${"#".repeat(Math.min(level, 6))} ${text}`);
        break;
      }
      case "bulletListItem":
        if (text) out.push(`${"  ".repeat(depth)}- ${text}`);
        break;
      case "numberedListItem":
        if (text) out.push(`${"  ".repeat(depth)}1. ${text}`);
        break;
      case "checkListItem":
        if (text) out.push(`${"  ".repeat(depth)}- [${block.props?.checked ? "x" : " "}] ${text}`);
        break;
      case "codeBlock":
        out.push(`\`\`\`${block.props?.language ?? ""}\n${text}\n\`\`\``);
        break;
      case "table": {
        const table = tableToMarkdown(block.content, options);
        if (table) out.push(table);
        break;
      }
      case "math": {
        // 数式ブロックは式を props.latex に持つ（content は無い）ので、ここで拾わないと消える
        const math = mathBlockToMarkdown(String(block.props?.latex ?? ""));
        if (math) out.push(math);
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "file": {
        const name = block.props?.name || block.props?.url || "";
        if (name) out.push(`[${type}: ${name}]`);
        break;
      }
      default:
        if (text) out.push(text);
        break;
    }

    // リストの入れ子は深さを足して辿る（step 以外の子）
    if (block.children?.length && type !== "step") {
      out.push(blocksToMarkdown(block.children, depth + 1, options));
    }
  }

  return out.filter((s) => s.trim()).join("\n\n");
}

/** ノート全体（全ページ）を Markdown にする */
export function noteToMarkdown(
  doc: { pages?: { blocks?: any[] }[] },
  options: InlineTextOptions = FOR_AI,
): string {
  const pages = doc?.pages ?? [];
  return pages
    .map((p) => blocksToMarkdown(p?.blocks ?? [], 0, options))
    .filter((s) => s.trim())
    .join("\n\n---\n\n");
}

/** columnList / column を透過し、中身のブロックだけを文書順に並べる */
function flattenColumnsShallow(blocks: any[]): any[] {
  return (blocks ?? []).flatMap((b) =>
    b?.type === "columnList" || b?.type === "column" ? flattenColumnsShallow(b.children) : [b],
  );
}

/**
 * Wiki ドキュメントから「1 行」の概要を取り出す（list_topics などの索引用）。
 * "## 定義 / Definition" 見出し直後の最初の段落の先頭文を優先し、無ければ本文最初の
 * 非空段落の先頭文を使う。見つからなければ空文字列。
 *
 * src/features/wiki/wiki-service.ts の extractTopicOneLiner と同じ考え方の
 * 軽量版（MCP は stdio 起動のたびに立ち上がるため、wiki-service.ts の重い依存
 * （embedding-store / settings / platform 等）を持ち込まずここで自己完結させる）。
 */
export function extractOneLiner(doc: { pages?: { blocks?: any[] }[] }): string {
  const blocks = flattenColumnsShallow(doc?.pages?.[0]?.blocks ?? []);

  const firstSentence = (text: string): string => {
    const idx = text.search(/[。.!?！？]/);
    return idx === -1 ? text : text.slice(0, idx + 1);
  };

  let inDefinition = false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "heading") {
      const headingText = extractInlineText(block.content).trim();
      if (inDefinition) break; // 定義節の終わり（次の見出しに入った）
      if (/^(定義|Definition)$/i.test(headingText)) inDefinition = true;
      continue;
    }
    if (!inDefinition) continue;
    const t = extractInlineText(block.content).trim();
    if (t) return firstSentence(t);
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object" || block.type === "heading") continue;
    const t = extractInlineText(block.content).trim();
    if (t) return firstSentence(t);
  }
  return "";
}

/** ノートから step コンテナを文書順に取り出す */
export function collectSteps(doc: { pages?: { blocks?: any[] }[] }): StepInfo[] {
  const steps: StepInfo[] = [];

  const walk = (blocks: any[]): void => {
    for (const block of blocks || []) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "step") {
        const childBlockIds: string[] = [];
        if (block.children?.length) collectBlockIds(block.children, childBlockIds);
        steps.push({
          blockId: block.id,
          title: extractInlineText(block.content) || "",
          body: block.children?.length ? blocksToMarkdown(block.children) : "",
          childBlockIds,
          order: steps.length + 1,
        });
        // 入れ子の step も拾う（index-file.ts の collectOutline と同じ）
        if (block.children?.length) walk(block.children);
        continue;
      }
      if (block.children?.length) walk(block.children);
    }
  };

  for (const page of doc?.pages ?? []) walk(page?.blocks ?? []);
  return steps;
}
