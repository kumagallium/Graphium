// MCP Apps のノートプレビュー（会話の中に描く読み取り専用の画面）に渡すデータを作る。
//
// 画面（apps/note-preview-view.ts）は HTML を受け取らず、このデータを DOM API で組み立てる。
// ノートの文字を innerHTML に流さないので、本文に <script> などが書かれていても実行されない。
//
// ブロック走査の規則は note-text.ts の blocksToMarkdown に揃える:
//   - step コンテナは content がタイトル、children が中身
//   - columnList / column はレイアウト用ラッパーなので透過する
// 往復変換の忠実さは目的ではない。会話の中で「どんなノートか」が一目で分かる程度に絞る。

import { inlineMathToMarkdown, mathBlockToMarkdown } from "../features/math/markdown-math";
import { normalizeLabel } from "../features/context-label/labels";

/** 文字の一続き。書式は見た目に効くものだけ持つ */
export type PreviewRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** 上付き・下付き */
  script?: "sup" | "sub";
  /** 数式（LaTeX のまま見せる） */
  math?: boolean;
  /** リンクの文字（URL は画面から開かせないので持たない） */
  link?: boolean;
};

export type PreviewBlock =
  | { kind: "heading"; level: number; runs: PreviewRun[]; label?: string }
  | { kind: "paragraph"; runs: PreviewRun[]; label?: string; depth: number }
  | { kind: "bullet" | "numbered"; runs: PreviewRun[]; label?: string; depth: number }
  | { kind: "check"; runs: PreviewRun[]; checked: boolean; label?: string; depth: number }
  | { kind: "step"; order: number; runs: PreviewRun[]; label?: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "math"; text: string }
  | { kind: "table"; rows: PreviewRun[][][]; label?: string }
  | { kind: "media"; mediaType: string; name: string }
  | { kind: "divider" }
  /** 描き方を持たないブロック（計算・チャート・データ表など）は種類名だけ見せる */
  | { kind: "other"; blockType: string };

export type NotePreview = {
  noteId: string;
  title: string;
  modifiedAt?: string;
  /** 書いたもの（AI なら agent / model）。人なら undefined */
  generatedBy?: string;
  folder?: string;
  blocks: PreviewBlock[];
  /** 描いたブロック数の上限で切ったか */
  truncated: boolean;
};

/** 会話の中の画面は短く保つ。長いノートは頭だけ見せて「続きはアプリで」に任せる */
export const PREVIEW_MAX_BLOCKS = 200;
const TABLE_MAX_ROWS = 30;

function stylesToRun(text: string, styles: Record<string, unknown> | undefined): PreviewRun {
  const run: PreviewRun = { text };
  if (!styles) return run;
  if (styles.bold) run.bold = true;
  if (styles.italic) run.italic = true;
  if (styles.code) run.code = true;
  if (styles.strike) run.strike = true;
  if (styles.superscript) run.script = "sup";
  else if (styles.subscript) run.script = "sub";
  return run;
}

/** inline content 配列を文字の一続きに直す */
export function inlineToRuns(content: unknown, inLink = false): PreviewRun[] {
  if (!Array.isArray(content)) return [];
  const runs: PreviewRun[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, any>;
    if (it.type === "inlineMath") {
      runs.push({ text: inlineMathToMarkdown(String(it.props?.latex ?? "")), math: true });
    } else if (typeof it.text === "string") {
      const run = stylesToRun(it.text, it.styles);
      if (inLink) run.link = true;
      runs.push(run);
    } else if (Array.isArray(it.content)) {
      // link など、中身を content に持つもの
      runs.push(...inlineToRuns(it.content, inLink || it.type === "link"));
    }
  }
  return runs;
}

function runsText(runs: PreviewRun[]): string {
  return runs.map((r) => r.text).join("");
}

function tableRows(content: unknown): PreviewRun[][][] {
  const rows = (content as any)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, TABLE_MAX_ROWS).map((row: any) =>
    (Array.isArray(row?.cells) ? row.cells : []).map((cell: unknown) => {
      if (Array.isArray(cell)) return inlineToRuns(cell);
      if (cell && typeof cell === "object" && Array.isArray((cell as any).content)) {
        return inlineToRuns((cell as any).content);
      }
      return [];
    }),
  );
}

type Walk = {
  out: PreviewBlock[];
  labels: Record<string, string>;
  truncated: boolean;
};

function walk(blocks: any[], depth: number, w: Walk): void {
  let stepNo = 0;
  for (const block of blocks || []) {
    if (w.out.length >= PREVIEW_MAX_BLOCKS) {
      w.truncated = true;
      return;
    }
    if (!block || typeof block !== "object") continue;
    const type = String(block.type ?? "");
    const label = block.id && w.labels[block.id] ? normalizeLabel(w.labels[block.id]) : undefined;
    const withLabel = <T extends object>(b: T): T => (label ? { ...b, label } : b);

    if (type === "columnList" || type === "column") {
      walk(block.children ?? [], depth, w);
      continue;
    }

    if (type === "step") {
      stepNo += 1;
      w.out.push(withLabel({ kind: "step" as const, order: stepNo, runs: inlineToRuns(block.content) }));
      walk(block.children ?? [], depth, w);
      continue;
    }

    const runs = inlineToRuns(block.content);
    const hasText = runsText(runs).trim().length > 0;

    switch (type) {
      case "heading":
        if (hasText) {
          const level = Math.min(Math.max(Number(block.props?.level) || 2, 1), 4);
          w.out.push(withLabel({ kind: "heading" as const, level, runs }));
        }
        break;
      case "paragraph":
        if (hasText) w.out.push(withLabel({ kind: "paragraph" as const, runs, depth }));
        break;
      case "bulletListItem":
        if (hasText) w.out.push(withLabel({ kind: "bullet" as const, runs, depth }));
        break;
      case "numberedListItem":
        if (hasText) w.out.push(withLabel({ kind: "numbered" as const, runs, depth }));
        break;
      case "checkListItem":
        if (hasText) {
          w.out.push(withLabel({ kind: "check" as const, runs, checked: !!block.props?.checked, depth }));
        }
        break;
      case "codeBlock":
        w.out.push({
          kind: "code",
          text: runsText(runs),
          ...(block.props?.language ? { language: String(block.props.language) } : {}),
        });
        break;
      case "math": {
        // 数式ブロックは式を props.latex に持つ（content は無い）
        const text = mathBlockToMarkdown(String(block.props?.latex ?? ""));
        if (text) w.out.push({ kind: "math", text });
        break;
      }
      case "table": {
        const rows = tableRows(block.content);
        if (rows.length > 0) w.out.push(withLabel({ kind: "table" as const, rows }));
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "file":
      case "pdf":
        w.out.push({
          kind: "media",
          mediaType: type,
          name: String(block.props?.name || block.props?.caption || ""),
        });
        break;
      case "divider":
        w.out.push({ kind: "divider" });
        break;
      default:
        if (hasText) w.out.push(withLabel({ kind: "paragraph" as const, runs, depth }));
        else w.out.push({ kind: "other", blockType: type });
        break;
    }

    if (block.children?.length) walk(block.children, depth + 1, w);
  }
}

export type NotePreviewInput = {
  noteId: string;
  doc: {
    title?: string;
    pages?: { blocks?: any[]; labels?: Record<string, string> }[];
    generatedBy?: unknown;
    noteContexts?: string[];
  };
  modifiedAt?: string;
};

/** ノートの JSON からプレビューのデータを作る（純関数） */
export function buildNotePreview({ noteId, doc, modifiedAt }: NotePreviewInput): NotePreview {
  const w: Walk = { out: [], labels: {}, truncated: false };
  for (const page of doc.pages ?? []) {
    w.labels = page?.labels ?? {};
    if (w.out.length > 0 && !w.truncated) w.out.push({ kind: "divider" });
    walk(page?.blocks ?? [], 0, w);
    if (w.truncated) break;
  }
  const g = doc.generatedBy as { agent?: string; model?: string } | undefined;
  return {
    noteId,
    title: doc.title?.trim() || "(untitled)",
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(g?.agent || g?.model ? { generatedBy: [g.agent, g.model].filter(Boolean).join(" / ") } : {}),
    ...(doc.noteContexts?.[0] ? { folder: doc.noteContexts[0] } : {}),
    blocks: w.out,
    truncated: w.truncated,
  };
}
