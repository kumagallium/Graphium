// 標準ブロック → Word（docx）の要素（Paragraph / Table）
//
// 入力は normalize-blocks.ts が返す「標準ブロック（＋ docxChart）だけ」の配列。
// 画像の取得はコンテキストの関数に任せる（ここは I/O を持たない）。
// 画像が 1 枚取れなくても全体は失敗させず、その箇所だけ差し込み文字にする。

import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type NumberingDefinition,
  type ParagraphChild,
} from "docx";
import { t } from "../../i18n";
import type { NormalizedBlock } from "./normalize-blocks";

/** Word に埋め込む画像（width・height は px） */
export type DocxImage = {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
};

/** 描画側が使う画像の取得関数 */
export type DocxRenderContext = {
  captureBlockImage?: (blockId: string) => Promise<DocxImage | null>;
  loadMedia?: (url: string) => Promise<DocxImage | null>;
  loadInlineImage?: (fileId: string) => Promise<DocxImage | null>;
};

// 用紙は A4 縦・余白 1 インチ。本文の幅 = 11906 - 1440 * 2 = 9026 twips（96dpi で約 601px）
export const BODY_WIDTH_TWIPS = 9026;
export const BODY_WIDTH_PX = 601;
/** 画像 1 枚の高さの上限（A4 の本文の高さ ≒ 931px より少し小さく） */
export const MAX_IMAGE_HEIGHT_PX = 900;
const TWIPS_PER_PX = 15;
/** 階層 1 つぶんの字下げ */
const INDENT_STEP = 720;
/** 字下げの階層の上限（深い入れ子でも本文が紙の外に出ないように） */
const MAX_INDENT_LEVEL = 10;
const MAX_NUMBERING_LEVEL = 8;

export const FONT_MONO = { ascii: "Courier New", hAnsi: "Courier New", eastAsia: "Courier New", cs: "Courier New" };
/**
 * チェックの印（☑ ☐）の書体。決めておかないと、Word が印ごとに別の書体へ置き換え、
 * ☑ だけ絵文字の形になる（macOS の Word で確認）。Office に入っている書体を名指しする
 */
const FONT_MARK = { ascii: "MS Gothic", hAnsi: "MS Gothic", eastAsia: "MS Gothic", cs: "MS Gothic" };
const CODE_FILL = "F2F2F2";
const HEADER_FILL = "F2F2F2";
/** 説明・引用など、本文より一段ひかえめに見せる文字の色 */
const COLOR_MUTED = "666666";
/** 表・区切り線・引用の線の色（黒い線は本文より強く見えるので、灰色にする） */
const COLOR_RULE = "BFBFBF";
/** 箇条書き・番号・チェックの項目どうしの間（本文の段落より詰める） */
const SPACING_LIST_ITEM = { before: 0, after: 40 };
/** 表のセルの内側の余白（twips） */
const CELL_MARGINS = { top: 60, bottom: 60, left: 110, right: 110 };

/** この描画側が明示的に扱う標準ブロックの type（BlockNote が型を足したらテストが落ちる） */
export const RENDERED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem",
  "toggleListItem", "quote", "codeBlock", "divider", "image", "video", "audio", "file", "table",
]);

/** BlockNote の色名 → 16 進（@blocknote/core の defaultColors.ts COLORS_DEFAULT のライトテーマ） */
const COLOR_TEXT: Record<string, string> = {
  gray: "9b9a97", brown: "64473a", red: "e03e3e", orange: "d9730d", yellow: "dfab01",
  green: "4d6461", blue: "0b6e99", purple: "6940a5", pink: "ad1a72",
};
const COLOR_BACKGROUND: Record<string, string> = {
  gray: "ebeced", brown: "e9e5e3", red: "fbe4e4", orange: "f6e9d9", yellow: "fbf3db",
  green: "ddedea", blue: "ddebf1", purple: "eae4f2", pink: "f4dfeb",
};

function resolveColor(table: Record<string, string>, value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value === "default") return undefined;
  if (table[value]) return table[value];
  const hex = /^#?([0-9a-f]{6})$/i.exec(value);
  return hex ? hex[1] : undefined;
}

// ─────────────────────────────────────────────
// 文字の後始末
// ─────────────────────────────────────────────

/** XML 1.0 で使えない文字（\t \n \r 以外の制御文字・対になっていないサロゲート・非文字）を取り除く */
export function cleanXmlText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0xfffe || c === 0xffff || c === 0x7f) continue;
    out += text[i];
  }
  return out;
}

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);
/** Word のリンクにしてよい行き先 */
const isLinkableHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

// ─────────────────────────────────────────────
// 内部状態
// ─────────────────────────────────────────────

type RenderState = {
  ctx: DocxRenderContext;
  numbering: NumberingDefinition[];
  nextNumRef: number;
};

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

function alignmentOf(props: any): Align | undefined {
  switch (props?.textAlignment) {
    case "left": return AlignmentType.LEFT;
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

const indentLevel = (level: number) => Math.min(Math.max(level, 0), MAX_INDENT_LEVEL);

/** 箇条書き共通の numbering 定義（参照名 "bullets"） */
const BULLET_REF = "graphium-bullets";
function bulletDefinition(): NumberingDefinition {
  const marks = ["•", "◦", "▪"];
  return {
    reference: BULLET_REF,
    levels: Array.from({ length: MAX_NUMBERING_LEVEL + 1 }, (_, level) => ({
      level,
      format: LevelFormat.BULLET,
      text: marks[level % marks.length],
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: INDENT_STEP * (level + 1), hanging: 360 } } },
    })),
  };
}

/** 番号つきリストの並び 1 つぶんの numbering 定義（並びごとに作るので頭から振り直される） */
function numberedDefinition(reference: string, level: number, start: number): NumberingDefinition {
  return {
    reference,
    levels: Array.from({ length: MAX_NUMBERING_LEVEL + 1 }, (_, l) => ({
      level: l,
      format: LevelFormat.DECIMAL,
      text: `%${l + 1}.`,
      alignment: AlignmentType.LEFT,
      ...(l === level ? { start } : {}),
      style: { paragraph: { indent: { left: INDENT_STEP * (l + 1), hanging: 360 } } },
    })),
  };
}

// ─────────────────────────────────────────────
// inline → Run
// ─────────────────────────────────────────────

type RunBase = { bold?: boolean; size?: number; style?: string; color?: string };

function textRuns(raw: string, styles: Record<string, any>, base: RunBase): TextRun[] {
  const cleaned = cleanXmlText(raw).replace(/\r\n?/g, "\n");
  const code = Boolean(styles.code);
  const color = resolveColor(COLOR_TEXT, styles.textColor) ?? base.color;
  const fill = resolveColor(COLOR_BACKGROUND, styles.backgroundColor) ?? (code ? CODE_FILL : undefined);
  const lines = cleaned.split("\n");
  return lines.map(
    (line, i) =>
      new TextRun({
        text: line,
        ...(i > 0 ? { break: 1 } : {}),
        bold: Boolean(styles.bold) || base.bold || undefined,
        italics: Boolean(styles.italic) || undefined,
        underline: styles.underline ? {} : undefined,
        strike: Boolean(styles.strike) || undefined,
        superScript: styles.superscript ? true : undefined,
        subScript: !styles.superscript && styles.subscript ? true : undefined,
        font: code ? FONT_MONO : undefined,
        color,
        size: base.size,
        style: base.style,
        shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
      }),
  );
}

/** inline 画像の読み込み（例外は握りつぶして null） */
async function safeImage(load: (() => Promise<DocxImage | null>) | undefined): Promise<DocxImage | null> {
  if (!load) return null;
  try {
    const img = await load();
    if (!img || !(img.width > 0) || !(img.height > 0) || !img.data || img.data.length === 0) return null;
    return img;
  } catch {
    return null;
  }
}

function fitSize(width: number, height: number, desired: number): { width: number; height: number } {
  let w = desired > 0 ? desired : width;
  if (w > BODY_WIDTH_PX) w = BODY_WIDTH_PX;
  if (w < 1) w = 1;
  let h = (w * height) / width;
  // 縦に長い画像はページの高さに収まるよう、縦横比を保って縮める
  if (h > MAX_IMAGE_HEIGHT_PX) {
    w = (w * MAX_IMAGE_HEIGHT_PX) / h;
    h = MAX_IMAGE_HEIGHT_PX;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

function imageRun(img: DocxImage, size: { width: number; height: number }, name: string): ImageRun {
  return new ImageRun({
    type: img.type,
    data: img.data,
    transformation: size,
    altText: { name: cleanXmlText(name) || "image", description: cleanXmlText(name), title: cleanXmlText(name) },
  });
}

async function inlinesToChildren(
  inlines: unknown,
  state: RenderState,
  base: RunBase = {},
): Promise<ParagraphChild[]> {
  const out: ParagraphChild[] = [];
  if (!Array.isArray(inlines)) return out;
  for (const item of inlines) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text") {
      out.push(...textRuns(typeof item.text === "string" ? item.text : "", item.styles ?? {}, base));
    } else if (item.type === "link") {
      const href = typeof item.href === "string" ? item.href : "";
      const children = await inlinesToChildren(item.content, state, isLinkableHref(href) ? { ...base, style: "Hyperlink" } : base);
      if (isLinkableHref(href)) {
        const inner = children.filter((c): c is TextRun | ImageRun => c instanceof TextRun || c instanceof ImageRun);
        out.push(new ExternalHyperlink({ link: cleanXmlText(href), children: inner }));
      } else {
        // アプリ内の行き先（#note/… など）はリンクにせず文字だけ
        out.push(...children);
      }
    } else if (item.type === "inlineImage") {
      const fileId = String(item.props?.fileId ?? "");
      const name = String(item.props?.name ?? "");
      const img = fileId ? await safeImage(state.ctx.loadInlineImage ? () => state.ctx.loadInlineImage!(fileId) : undefined) : null;
      if (img) {
        const w = Number(item.props?.width) > 0 ? Number(item.props.width) : 96;
        out.push(imageRun(img, fitSize(img.width, img.height, w), name));
      } else {
        out.push(...textRuns(`[${name}]`, {}, base));
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// ブロック
// ─────────────────────────────────────────────

type Rendered = Paragraph | Table;

/** 画像 1 枚ぶんの段落（取れたときの形） */
function imageParagraph(img: DocxImage, desiredWidth: number, name: string, level: number, alignment?: Align): Paragraph {
  return new Paragraph({
    alignment,
    indent: level > 0 ? { left: indentLevel(level) * INDENT_STEP } : undefined,
    // 図の上は少し空け、下は説明が離れないよう詰める
    spacing: { before: 120, after: 60 },
    children: [imageRun(img, fitSize(img.width, img.height, desiredWidth), name)],
  });
}

/** 説明の段落。寄せは画像と揃える（画像は左、グラフは中央が既定）。ずれると説明が画像から離れて見える */
function captionParagraph(caption: string, level: number, alignment: Align = AlignmentType.LEFT): Paragraph {
  return new Paragraph({
    alignment,
    indent: level > 0 ? { left: indentLevel(level) * INDENT_STEP } : undefined,
    spacing: { before: 0, after: 200 },
    children: textRuns(caption, {}, { size: 18, color: COLOR_MUTED }),
  });
}

function placeholderParagraph(kind: "image" | "video" | "audio" | "file", name: string, url: string, level: number): Paragraph {
  const label = cleanXmlText(t(`docx.placeholder.${kind}`, { name }));
  // リンクの見た目（Hyperlink スタイル）は、実際にリンクにするときだけ付ける
  const linked = isHttpUrl(url);
  const run = new TextRun({ text: label, ...(linked ? { style: "Hyperlink" } : {}) });
  return new Paragraph({
    indent: level > 0 ? { left: indentLevel(level) * INDENT_STEP } : undefined,
    children: linked
      ? [new ExternalHyperlink({ link: cleanXmlText(url), children: [run] })]
      : [run],
  });
}

function mediaName(props: any): string {
  const name = typeof props?.name === "string" ? props.name : "";
  if (name) return name;
  const url = typeof props?.url === "string" ? props.url : "";
  if (url.startsWith("data:")) return "";
  return url.split(/[?#]/)[0].split("/").pop() ?? "";
}

async function renderImageBlock(
  block: NormalizedBlock,
  img: DocxImage | null,
  state: RenderState,
  level: number,
): Promise<Rendered[]> {
  const props = block.props ?? {};
  const name = mediaName(props);
  const caption = typeof props.caption === "string" ? props.caption : "";
  const out: Rendered[] = [];
  const alignment = alignmentOf(props);
  if (img) {
    const preview = Number(props.previewWidth);
    out.push(imageParagraph(img, preview > 0 ? preview : img.width, name, level, alignment));
  } else {
    out.push(placeholderParagraph("image", name, typeof props.url === "string" ? props.url : "", level));
  }
  if (caption) out.push(captionParagraph(caption, level, img ? alignment : undefined));
  return out;
}

function plainText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let s = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string") s += item.text;
    else if (Array.isArray(item.content)) s += plainText(item.content);
  }
  return s;
}

/** 子ブロック列を描画する。リスト項目の並び（番号の振り直し）は同じ階層の連続で区切る */
async function renderBlocks(blocks: NormalizedBlock[], state: RenderState, level: number): Promise<Rendered[]> {
  const out: Rendered[] = [];
  let numRef: string | null = null; // 現在の番号つきの並びの参照名
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type !== "numberedListItem") numRef = null;
    if (block.type === "numberedListItem" && numRef === null) {
      numRef = `graphium-num-${state.nextNumRef++}`;
      const start = Number(block.props?.start);
      state.numbering.push(
        numberedDefinition(
          numRef,
          Math.min(level, MAX_NUMBERING_LEVEL),
          Number.isFinite(start) && start >= 0 ? Math.floor(start) : 1,
        ),
      );
    }
    out.push(...(await renderBlock(block, state, level, numRef)));
  }
  return out;
}

async function renderBlock(
  block: NormalizedBlock,
  state: RenderState,
  level: number,
  numRef: string | null,
): Promise<Rendered[]> {
  const props = block.props ?? {};
  const children: NormalizedBlock[] = Array.isArray(block.children) ? block.children : [];
  const alignment = alignmentOf(props);
  const left = indentLevel(level) * INDENT_STEP;
  const out: Rendered[] = [];

  switch (block.type) {
    case "docxChart": {
      let img: DocxImage | null = null;
      if (block.blockId) {
        img = await safeImage(state.ctx.captureBlockImage ? () => state.ctx.captureBlockImage!(block.blockId) : undefined);
      }
      if (img) {
        // グラフは画面でも中央に置くので、図も説明も中央に寄せる
        out.push(imageParagraph(img, img.width, "chart", level, AlignmentType.CENTER));
        const caption = typeof block.caption === "string" ? block.caption : "";
        if (caption) out.push(captionParagraph(caption, level, AlignmentType.CENTER));
        // 子ブロックは画像のあとにそのまま出す
        out.push(...(await renderBlocks(Array.isArray(block.chartChildren) ? block.chartChildren : [], state, level + 1)));
      } else {
        out.push(...(await renderBlocks(Array.isArray(block.fallback) ? block.fallback : [], state, level)));
      }
      return out;
    }
    case "heading": {
      const lv = Math.min(Math.max(Number(props.level) || 1, 1), 6);
      const headings = [
        HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
      ];
      out.push(
        new Paragraph({
          heading: headings[lv - 1],
          alignment,
          indent: left > 0 ? { left } : undefined,
          children: await inlinesToChildren(block.content, state),
        }),
      );
      break;
    }
    case "bulletListItem":
    case "numberedListItem": {
      const bullet = block.type === "bulletListItem";
      out.push(
        new Paragraph({
          numbering: {
            reference: bullet ? BULLET_REF : (numRef ?? BULLET_REF),
            level: Math.min(level, MAX_NUMBERING_LEVEL),
          },
          alignment,
          spacing: SPACING_LIST_ITEM,
          children: await inlinesToChildren(block.content, state),
        }),
      );
      // リスト項目の子はレベルを 1 つ深く
      out.push(...(await renderBlocks(children, state, level + 1)));
      return out;
    }
    case "checkListItem":
    case "toggleListItem": {
      const toggle = block.type === "toggleListItem";
      const mark = toggle ? "▸" : props.checked ? "☑" : "☐";
      out.push(
        new Paragraph({
          alignment,
          // 印をぶら下げて、折り返した行が本文の頭に揃うようにする
          indent: { left: left + 720, hanging: 360 },
          tabStops: [{ type: TabStopType.LEFT, position: left + 720 }],
          spacing: SPACING_LIST_ITEM,
          children: [
            new TextRun({ text: mark, ...(toggle ? {} : { font: FONT_MARK }) }),
            new TextRun({ children: [new Tab()] }),
            ...(await inlinesToChildren(block.content, state)),
          ],
        }),
      );
      break;
    }
    case "quote": {
      out.push(
        new Paragraph({
          alignment,
          indent: { left: left + 360 },
          spacing: { before: 80, after: 160 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: COLOR_RULE, space: 8 } },
          children: await inlinesToChildren(block.content, state, { color: COLOR_MUTED }),
        }),
      );
      break;
    }
    case "codeBlock": {
      // 地の色と同じ色の枠で囲み、文字が地の端に貼り付かないようにする（枠の space が内側の余白になる）
      const pad = { style: BorderStyle.SINGLE, size: 4, color: CODE_FILL, space: 4 };
      out.push(
        new Paragraph({
          indent: { left: left + 120, right: 120 },
          spacing: { before: 120, after: 200 },
          shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" },
          border: { top: pad, bottom: pad, left: pad, right: pad },
          children: textRuns(plainText(block.content), { code: true }, { size: 19 }),
        }),
      );
      break;
    }
    case "divider": {
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_RULE, space: 1 } },
          children: [],
        }),
      );
      break;
    }
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const img = url ? await safeImage(state.ctx.loadMedia ? () => state.ctx.loadMedia!(url) : undefined) : null;
      out.push(...(await renderImageBlock(block, img, state, level)));
      break;
    }
    case "video":
    case "audio":
    case "file": {
      out.push(placeholderParagraph(block.type, mediaName(props), typeof props.url === "string" ? props.url : "", level));
      const caption = typeof props.caption === "string" ? props.caption : "";
      if (caption) out.push(captionParagraph(caption, level));
      break;
    }
    case "table": {
      out.push(...(await renderTable(block, state)));
      break;
    }
    default: {
      // paragraph と、描画側が知らない型（インラインの文字だけを段落にする）
      out.push(
        new Paragraph({
          alignment,
          indent: left > 0 ? { left } : undefined,
          children: await inlinesToChildren(block.content, state),
        }),
      );
    }
  }
  // それ以外の子は親より字下げして続ける
  out.push(...(await renderBlocks(children, state, level + 1)));
  return out;
}

// ─────────────────────────────────────────────
// 表
// ─────────────────────────────────────────────

/** 1 つの表の列数の上限（colspan の暴走よけ） */
const MAX_TABLE_COLS = 200;

type PlacedCell = { r: number; c: number; colspan: number; rowspan: number; cell: any };

async function renderTable(block: NormalizedBlock, state: RenderState): Promise<Rendered[]> {
  const content = block.content;
  const rows: any[] = content && typeof content === "object" && Array.isArray(content.rows) ? content.rows : [];
  if (rows.length === 0) return [];

  const headerRows = Number(content.headerRows ?? block.props?.headerRows) || 0;
  const headerCols = Number(content.headerCols ?? block.props?.headerCols) || 0;
  const givenWidths: unknown[] = Array.isArray(content.columnWidths) ? content.columnWidths : [];

  // 列数の見積もり（colspan の暴走を抑えるため、セル数と columnWidths の多いほうを上限にする）
  let colLimit = givenWidths.length;
  for (const row of rows) {
    const cells: any[] = Array.isArray(row?.cells) ? row.cells : [];
    // セルの数と、colspan を足した幅のうち大きいほうで見積もる
    let span = 0;
    for (const cell of cells) {
      const cs = cell && !Array.isArray(cell) && typeof cell === "object" ? Math.floor(Number(cell.props?.colspan)) : NaN;
      span += cs >= 1 ? cs : 1;
    }
    colLimit = Math.max(colLimit, cells.length, Math.min(span, MAX_TABLE_COLS));
  }
  colLimit = Math.max(colLimit, 1);

  // 配置: colspan / rowspan で埋まった升を避けながら、セルを升目に置く
  const covered: boolean[][] = rows.map(() => []);
  const placed: PlacedCell[][] = rows.map(() => []);
  let colCount = colLimit;
  rows.forEach((row, r) => {
    const cells: any[] = Array.isArray(row?.cells) ? row.cells : [];
    let c = 0;
    for (const cell of cells) {
      while (covered[r][c]) c++;
      const cp = cell && !Array.isArray(cell) && typeof cell === "object" ? cell.props ?? {} : {};
      const colspan = Math.min(Math.max(Math.floor(Number(cp.colspan)) || 1, 1), Math.max(colLimit - c, 1));
      const rowspan = Math.min(Math.max(Math.floor(Number(cp.rowspan)) || 1, 1), rows.length - r);
      placed[r].push({ r, c, colspan, rowspan, cell });
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) covered[r + dr][c + dc] = true;
      }
      colCount = Math.max(colCount, c + colspan);
      c += colspan;
    }
  });

  // 列幅（px）→ twips。未指定は等分、合計が本文幅を超えたら全体を縮める
  const px: number[] = [];
  for (let i = 0; i < colCount; i++) {
    const w = Number(givenWidths[i]);
    px.push(Number.isFinite(w) && w > 0 ? w : BODY_WIDTH_PX / colCount);
  }
  const total = px.reduce((a, b) => a + b, 0);
  const scale = total > BODY_WIDTH_PX ? BODY_WIDTH_PX / total : 1;
  const widths = px.map((w) => Math.max(1, Math.floor(w * scale * TWIPS_PER_PX)));
  const tableWidth = widths.reduce((a, b) => a + b, 0);

  const tableRows: TableRow[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells: TableCell[] = [];
    let c = 0;
    const byCol = new Map(placed[r].map((p) => [p.c, p]));
    // 上の行の rowspan に覆われた升は docx 側が補うので出さない
    const coveredFromAbove = (col: number) => {
      for (let pr = 0; pr < r; pr++) {
        for (const p of placed[pr]) {
          if (p.r + p.rowspan > r && col >= p.c && col < p.c + p.colspan) return true;
        }
      }
      return false;
    };
    while (c < colCount) {
      const p = byCol.get(c);
      if (p) {
        cells.push(await renderCell(p, widths, headerRows, headerCols, state));
        c += p.colspan;
      } else if (coveredFromAbove(c)) {
        c++;
      } else {
        // セル数が足りない行は空のセルで埋める
        cells.push(
          new TableCell({
            width: { size: widths[c], type: WidthType.DXA },
            children: [new Paragraph({ children: [] })],
          }),
        );
        c++;
      }
    }
    tableRows.push(new TableRow({ children: cells }));
  }

  const rule = { style: BorderStyle.SINGLE, size: 4, color: COLOR_RULE };
  return [
    new Table({
      rows: tableRows,
      width: { size: tableWidth, type: WidthType.DXA },
      columnWidths: widths,
      margins: CELL_MARGINS,
      borders: { top: rule, bottom: rule, left: rule, right: rule, insideHorizontal: rule, insideVertical: rule },
    }),
    // 表の直後に空段落を置く（Word は文書末尾の表の後ろに段落が無いと開けず、表が続くと 1 つに結合するため）。
    // 1 行ぶん空くと間延びするので、行の高さを決め打ちして小さな間にする
    new Paragraph({ children: [], spacing: { after: 0, before: 0, line: 200, lineRule: LineRuleType.EXACT } }),
  ];
}

async function renderCell(
  p: PlacedCell,
  widths: number[],
  headerRows: number,
  headerCols: number,
  state: RenderState,
): Promise<TableCell> {
  const cell = p.cell;
  const inlines = Array.isArray(cell) ? cell : cell && typeof cell === "object" ? cell.content : [];
  const cp = cell && !Array.isArray(cell) && typeof cell === "object" ? cell.props ?? {} : {};
  const isHeader = p.r < headerRows || p.c < headerCols;
  const width = widths.slice(p.c, p.c + p.colspan).reduce((a, b) => a + b, 0);
  const bg = resolveColor(COLOR_BACKGROUND, cp.backgroundColor);
  const fill = bg ?? (isHeader ? HEADER_FILL : undefined);
  const children = await inlinesToChildren(inlines, state, { bold: isHeader });
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: p.colspan > 1 ? p.colspan : undefined,
    rowSpan: p.rowspan > 1 ? p.rowspan : undefined,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    children: [
      new Paragraph({
        alignment: alignmentOf(cp),
        // セルの中は余白で間を取るので、段落の後ろは空けない
        spacing: { before: 0, after: 0 },
        children,
      }),
    ],
  });
}

// ─────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────

/** 標準ブロック列を Word の本文要素にする。番号つきリストの定義も返す */
export async function renderBlocksToDocx(
  blocks: NormalizedBlock[],
  ctx: DocxRenderContext,
): Promise<{ children: Rendered[]; numbering: NumberingDefinition[] }> {
  const state: RenderState = { ctx, numbering: [bulletDefinition()], nextNumRef: 1 };
  const children = await renderBlocks(blocks, state, 0);
  return { children, numbering: state.numbering };
}
