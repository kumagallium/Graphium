// ノート本体（BlockNote の JSON）からテキスト・手順・アウトラインを取り出す。
//
// src/features/markdown-export は BlockNoteEditor を実体化して Markdown を作るが、
// MCP サーバーは stdio で spawn されるたびに起動するため、エディタの初期化コスト
// （と DOM 前提の依存）を持ち込めない。ここでは Claude が読める程度の軽量な
// Markdown 化に絞って自前で実装する。往復変換の忠実さは目的ではない。
//
// ブロック走査の規則は src/features/navigation/index-file.ts の collectOutline に揃える:
//   - step コンテナは content がタイトル、children が中身
//   - columnList / column はレイアウト用ラッパーなので透過する

/** inline content からプレーンテキストを取り出す（inlineMath は LaTeX を $ で囲む） */
export function extractInlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, any>;
    if (it.type === "inlineMath") {
      const latex = String(it.props?.latex ?? "");
      if (latex) text += `$${latex}$`;
    } else if (typeof it.text === "string") {
      text += it.text;
    } else if (Array.isArray(it.content)) {
      text += extractInlineText(it.content);
    }
  }
  return text;
}

/** table content（{ rows: [{ cells }] }）を Markdown テーブルに落とす */
function tableToMarkdown(content: unknown): string {
  const rows = (content as any)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cellText = (cell: unknown): string => {
    if (Array.isArray(cell)) return extractInlineText(cell);
    if (cell && typeof cell === "object" && Array.isArray((cell as any).content)) {
      return extractInlineText((cell as any).content);
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
export function blocksToMarkdown(blocks: any[], depth = 0): string {
  const out: string[] = [];
  let stepNo = 0;

  for (const block of blocks || []) {
    if (!block || typeof block !== "object") continue;
    const type = block.type as string;

    // レイアウト用ラッパーは透過（中身だけ出す）
    if (type === "columnList" || type === "column") {
      if (block.children?.length) out.push(blocksToMarkdown(block.children, depth));
      continue;
    }

    if (type === "step") {
      stepNo += 1;
      const title = extractInlineText(block.content) || `(step ${stepNo})`;
      out.push(`### ${stepNo}. ${title}`);
      if (block.children?.length) out.push(blocksToMarkdown(block.children, depth));
      continue;
    }

    const text = extractInlineText(block.content);

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
        const table = tableToMarkdown(block.content);
        if (table) out.push(table);
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
      out.push(blocksToMarkdown(block.children, depth + 1));
    }
  }

  return out.filter((s) => s.trim()).join("\n\n");
}

/** ノート全体（全ページ）を Markdown にする */
export function noteToMarkdown(doc: { pages?: { blocks?: any[] }[] }): string {
  const pages = doc?.pages ?? [];
  return pages
    .map((p) => blocksToMarkdown(p?.blocks ?? []))
    .filter((s) => s.trim())
    .join("\n\n---\n\n");
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
