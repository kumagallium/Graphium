// MCP Apps のノートプレビュー（会話の中に描く読み取り専用の画面）に渡すデータを作る。
//
// 画面（apps/note-preview-view.ts）は HTML を受け取らず、このデータを DOM API で組み立てる。
// ノートの文字を innerHTML に流さないので、本文に <script> などが書かれていても実行されない。
//
// ブロック走査の規則は note-text.ts の blocksToMarkdown に揃える:
//   - step コンテナは content がタイトル、children が中身
//   - columnList / column はレイアウト用ラッパーなので透過する
// 往復変換の忠実さは目的ではない。会話の中で「どんなノートか」が一目で分かる程度に絞る。

import { INLINE_LABEL_STYLE_KEYS, type InlineLabelKind } from "../features/inline-label/colors";
import { inlineMathToMarkdown, mathBlockToMarkdown } from "../features/math/markdown-math";
import { normalizeLabel } from "../features/context-label/labels";
import { latexToMathml } from "./math-mathml";

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
  /** 数式を KaTeX で組んだ MathML。組めなかったときは無く、text（LaTeX）をそのまま見せる */
  mathml?: string;
  /** リンクの文字（URL は画面から開かせないので持たない） */
  link?: boolean;
  /** 文字の範囲に付いた PROV ラベル（インプット・ツール・パラメータ・アウトプット） */
  inlineLabel?: InlineLabelKind;
};

export type PreviewBlock =
  | { kind: "heading"; level: number; runs: PreviewRun[]; label?: string }
  | { kind: "paragraph"; runs: PreviewRun[]; label?: string; depth: number }
  | { kind: "bullet" | "numbered"; runs: PreviewRun[]; label?: string; depth: number }
  | { kind: "check"; runs: PreviewRun[]; checked: boolean; label?: string; depth: number }
  /** 手順はアプリと同じくカード。中身（children）をカードの中に持つ */
  | { kind: "step"; order: number; runs: PreviewRun[]; label?: string; children: PreviewBlock[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "math"; text: string; mathml?: string }
  | { kind: "table"; rows: PreviewRun[][][]; label?: string }
  | {
      kind: "media";
      mediaType: string;
      name: string;
      caption?: string;
      /** 手元の素材の id（media/ のファイル名）。画像なら app-tools.ts が中身を data URL にして別に渡す */
      mediaId?: string;
      /** 外のサイトを指す参照のホスト名。画面からは読みに行かず、どこにあるかだけを見せる */
      remoteHost?: string;
      blockId: string;
    }
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
  for (const [key, label] of Object.entries(INLINE_LABEL_STYLE_KEYS)) {
    if (typeof styles[key] === "string" && styles[key]) {
      run.inlineLabel = label;
      break;
    }
  }
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
      const latex = String(it.props?.latex ?? "");
      const mathml = latexToMathml(latex, false);
      runs.push({ text: inlineMathToMarkdown(latex), math: true, ...(mathml ? { mathml } : {}) });
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

/**
 * メディアブロックの url から手元の素材の id を取り出す。手元を指していなければ null。
 *
 * 手元の参照は features/asset-browser/local-media-ref.ts の許可リストと同じ接頭辞
 * （file-media:// / local-media:// / media-server:// / media://）。Google Drive 保存時代の
 * `https://lh3.googleusercontent.com/d/<id>=s0` も、同じ id の素材が media/ にあれば手元として扱う
 * （media/ に無ければ app-tools.ts が見つからないとして名前だけ見せる。外へは読みに行かない）。
 */
export function localMediaIdOf(url: string): string | null {
  const trimmed = url.trim();
  const local = /^(?:file-media|local-media|media-server|media):\/\/([^/?#]+)/i.exec(trimmed);
  if (local) return decodeURIComponent(local[1]);
  const drive = /^https:\/\/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (drive) return drive[1];
  return null;
}

/** 表示用のホスト名だけ（パス・クエリは出さない。トークンが載っていることがあるため） */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return "";
  }
}

type Walk = {
  /** いま書き込む先（手順の中ではその手順の children） */
  out: PreviewBlock[];
  labels: Record<string, string>;
  truncated: boolean;
  /** 入れ子も含めて描いたブロックの数（上限の判定用） */
  count: number;
};

function walk(blocks: any[], depth: number, w: Walk): void {
  let stepNo = 0;
  for (const block of blocks || []) {
    if (w.count >= PREVIEW_MAX_BLOCKS) {
      w.truncated = true;
      return;
    }
    if (!block || typeof block !== "object") continue;
    const type = String(block.type ?? "");
    const label = block.id && w.labels[block.id] ? normalizeLabel(w.labels[block.id]) : undefined;
    const withLabel = <T extends object>(b: T): T => (label ? { ...b, label } : b);
    const push = (b: PreviewBlock) => {
      w.out.push(b);
      w.count += 1;
    };

    if (type === "columnList" || type === "column") {
      walk(block.children ?? [], depth, w);
      continue;
    }

    if (type === "step") {
      stepNo += 1;
      const step = withLabel({
        kind: "step" as const,
        order: stepNo,
        runs: inlineToRuns(block.content),
        children: [] as PreviewBlock[],
      });
      push(step);
      const parent = w.out;
      w.out = step.children;
      walk(block.children ?? [], 0, w);
      w.out = parent;
      continue;
    }

    const runs = inlineToRuns(block.content);
    const hasText = runsText(runs).trim().length > 0;

    switch (type) {
      case "heading":
        if (hasText) {
          const level = Math.min(Math.max(Number(block.props?.level) || 2, 1), 4);
          push(withLabel({ kind: "heading" as const, level, runs }));
        }
        break;
      case "paragraph":
        if (hasText) push(withLabel({ kind: "paragraph" as const, runs, depth }));
        break;
      case "bulletListItem":
        if (hasText) push(withLabel({ kind: "bullet" as const, runs, depth }));
        break;
      case "numberedListItem":
        if (hasText) push(withLabel({ kind: "numbered" as const, runs, depth }));
        break;
      case "checkListItem":
        if (hasText) {
          push(withLabel({ kind: "check" as const, runs, checked: !!block.props?.checked, depth }));
        }
        break;
      case "codeBlock":
        push({
          kind: "code",
          text: runsText(runs),
          ...(block.props?.language ? { language: String(block.props.language) } : {}),
        });
        break;
      case "math": {
        // 数式ブロックは式を props.latex に持つ（content は無い）
        const latex = String(block.props?.latex ?? "");
        const text = mathBlockToMarkdown(latex);
        const mathml = latexToMathml(latex, true);
        if (text) push({ kind: "math", text, ...(mathml ? { mathml } : {}) });
        break;
      }
      case "table": {
        const rows = tableRows(block.content);
        if (rows.length > 0) push(withLabel({ kind: "table" as const, rows }));
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "file":
      case "pdf": {
        const url = String(block.props?.url ?? "");
        const mediaId = localMediaIdOf(url);
        const caption = String(block.props?.caption ?? "").trim();
        push({
          kind: "media",
          mediaType: type,
          name: String(block.props?.name || caption || ""),
          ...(caption ? { caption } : {}),
          ...(mediaId ? { mediaId } : {}),
          ...(!mediaId && url ? { remoteHost: hostOf(url) } : {}),
          blockId: String(block.id ?? ""),
        });
        break;
      }
      case "divider":
        push({ kind: "divider" });
        break;
      default:
        if (hasText) push(withLabel({ kind: "paragraph" as const, runs, depth }));
        else push({ kind: "other", blockType: type });
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
  const blocks: PreviewBlock[] = [];
  const w: Walk = { out: blocks, labels: {}, truncated: false, count: 0 };
  for (const page of doc.pages ?? []) {
    w.labels = page?.labels ?? {};
    if (blocks.length > 0 && !w.truncated) blocks.push({ kind: "divider" });
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
    blocks,
    truncated: w.truncated,
  };
}

/** 手順の中も含めて、プレビューのブロックを文書順に平たく並べる */
export function flattenPreviewBlocks(blocks: PreviewBlock[]): PreviewBlock[] {
  return blocks.flatMap((b) => (b.kind === "step" ? [b, ...flattenPreviewBlocks(b.children)] : [b]));
}
