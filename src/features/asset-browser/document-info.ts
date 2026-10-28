// ドキュメント素材（PDF / Word .docx / PowerPoint .pptx）の中身から読む付加情報
//
//   - ページ数: 一覧に出して並び替えられるようにする（巨大な資料をナレッジ化に回す前に気づくため）
//   - タイトル: ファイル名の代わりに、文書自身が名乗っているタイトルで名前を付け直すため
//   - 出どころ（PDF の著者・DOI）: 読み取り自体は source-info.ts。既存素材への後追いだけここで一緒に回す
//
// どちらも「分かれば使う、分からなければ何もしない」。読めない・壊れているときは
// undefined を返し、登録や一覧表示を止めない。

import { unzipSync, strFromU8 } from "fflate";
import {
  getLatestMediaIndex,
  readMediaIndex,
  saveMediaIndex,
  documentKindOf,
  isWordDocxEntry,
  isPptxEntry,
  MEDIA_INDEX_CHANGED_EVENT,
  type MediaIndexEntry,
  type SourceInfo,
} from "./media-index";
import { MAX_HASH_BYTES } from "./dedupe";
import { resolveSlideOrder, slideNumberOf } from "../office-import/pptx";
import { cleanAuthorNames, readPdfSourceInfo, type PdfDocLike } from "./source-info";

type EntryLike = { type: MediaIndexEntry["type"]; mimeType: string };

/** タイトルの最大文字数（長すぎる行を拾ったときの保険） */
const MAX_TITLE_LENGTH = 200;

/** ページ数を数えられる素材か（PDF・.docx・.pptx。旧形式と Excel は数えない） */
export function canCountPages(entry: EntryLike): boolean {
  return documentKindOf(entry) === "pdf" || isWordDocxEntry(entry) || isPptxEntry(entry);
}

/** ファイル内のタイトルを読める素材か（ページ数と同じ対象） */
export function canExtractTitle(entry: EntryLike): boolean {
  return canCountPages(entry);
}

// ---------- 共通: zip / XML ----------

/** 必要なファイルだけを展開する（大きな zip を丸ごとメモリに広げない） */
function unzipSome(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (f) => wanted(f.name) });
}

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
}

/** 前後空白・連続空白・改行を 1 つの空白にする */
export function normalizeTitleText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

// ---------- タイトルが「使える値か」 ----------

const TITLE_FILE_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|tex|dvi|txt|rtf|odt|odp|ps|indd|key|pages)$/i;
const TITLE_APP_PREFIX_RE =
  /^(microsoft\s+(word|powerpoint|excel)|ms\s*word|powerpoint|word)\s*[-–—:]\s*/i;
const TITLE_GENERIC_RE =
  /^(untitled|title|document|presentation|powerpoint presentation|new document|slide|無題|無題のドキュメント|名称未設定|タイトル|新しいドキュメント|タイトルなし)\s*\d*$/i;

/**
 * メタデータ等のタイトルが「文書の題として使える値」か。
 * 空・ファイル名っぽい・アプリ名の接頭辞付き・汎用語・2 文字以下・数字や記号だけは使えない。
 */
export function isUsableTitle(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = normalizeTitleText(raw);
  if (Array.from(t).length <= 2) return false;
  if (TITLE_FILE_EXT_RE.test(t)) return false;
  if (TITLE_APP_PREFIX_RE.test(t)) return false;
  if (TITLE_GENERIC_RE.test(t)) return false;
  // 数字・空白・記号だけ
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return false;
  // 語が 1 つも無い（組版システムが入れた原稿 ID「au5c01087 1..12」など）
  if (!t.split(/\s+/).some(isWordToken)) return false;
  return true;
}

/**
 * 題を構成する「語」か。漢字・かな・ハングルを含めば語とみなす（「2026年度報告」も語）。
 * それ以外は、数字を含まず文字が 3 つ以上並ぶ語（「au5c01087」のような英数字の混ざった ID は語でない）。
 */
function isWordToken(token: string): boolean {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)) return true;
  return !/\d/.test(token) && /\p{L}{3,}/u.test(token);
}

/** 使える値なら整えて（空白の正規化・上限で切る）返し、使えなければ undefined */
function finalizeTitle(raw: string | null | undefined): string | undefined {
  if (!isUsableTitle(raw)) return undefined;
  const t = normalizeTitleText(raw as string);
  return Array.from(t).slice(0, MAX_TITLE_LENGTH).join("");
}

// ---------- PDF: 1 ページ目の本文から題を拾う（純関数部分） ----------

/** getTextContent の item を縮めたもの（高さは transform から求めた文字サイズ、y は基線位置） */
export type PdfTextItem = { str: string; height: number; y: number };

type TextLine = { text: string; height: number; y: number };

/** 高さの差がこれ以内なら「同じ大きさ」とみなす */
const HEIGHT_TOLERANCE = 0.5;

/**
 * 1 ページ目の item 列から、いちばん文字の大きい行（折り返しなら連続する行を連結）を題として返す。
 * 同じ高さでほぼ同じ y の連続 item は 1 行にまとめる。使える値でなければ undefined。
 */
export function pickTitleFromPdfItems(items: PdfTextItem[]): string | undefined {
  const lines: TextLine[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const blank = it.str.trim() === "";
    const last = lines[lines.length - 1];
    if (blank) {
      // 空白だけの item は語間なので、行の途中にだけ足す
      if (last) last.text += it.str;
      continue;
    }
    if (
      last &&
      Math.abs(last.height - it.height) <= HEIGHT_TOLERANCE &&
      Math.abs(last.y - it.y) <= Math.max(it.height, 1) * 0.3
    ) {
      last.text += it.str;
    } else {
      lines.push({ text: it.str, height: it.height, y: it.y });
    }
  }
  if (lines.length === 0) return undefined;

  const maxHeight = Math.max(...lines.map((l) => l.height));
  const start = lines.findIndex((l) => maxHeight - l.height <= HEIGHT_TOLERANCE);
  if (start < 0) return undefined;

  // 折り返したタイトルは、同じ高さの行が上から続く。行間は文字サイズの 2.2 倍までを「続き」とする
  const parts = [lines[start].text];
  let prev = lines[start];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (maxHeight - l.height > HEIGHT_TOLERANCE) break;
    if (prev.y - l.y > maxHeight * 2.2 || prev.y - l.y < 0) break;
    parts.push(l.text);
    prev = l;
  }
  return finalizeTitle(parts.join(" "));
}

// ---------- PDF ----------

type PdfDoc = {
  numPages: number;
  getMetadata: () => Promise<{ info?: unknown }>;
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>;
  }>;
};

/**
 * pdfjs の読み込みは 1 本にまとめる。後追い付与は数件を並べて開くので、
 * 同じ動的 import を同時に何本も投げない。失敗したら次の呼び出しで読み直す。
 */
let pdfjsLoader: Promise<[typeof import("react-pdf"), typeof import("../../lib/pdfjs-config")]> | null = null;
function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = Promise.all([import("react-pdf"), import("../../lib/pdfjs-config")]);
    pdfjsLoader.catch(() => {
      pdfjsLoader = null;
    });
  }
  return pdfjsLoader;
}

/** pdfjs で開く。呼び出し側が最後に destroy する */
async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDoc; destroy: () => void }> {
  const [{ pdfjs }, { PDFJS_DOC_OPTIONS }] = await loadPdfjs();
  // pdfjs は渡した配列を worker へ転送して使い切ることがあるので、コピーを渡す
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_DOC_OPTIONS });
  const doc = (await task.promise) as unknown as PdfDoc;
  return { doc, destroy: () => void task.destroy() };
}

async function countPdfPages(bytes: Uint8Array): Promise<number | undefined> {
  const { doc, destroy } = await openPdf(bytes);
  try {
    return doc.numPages > 0 ? doc.numPages : undefined;
  } finally {
    destroy();
  }
}

async function extractPdfTitle(bytes: Uint8Array): Promise<string | undefined> {
  const { doc, destroy } = await openPdf(bytes);
  try {
    try {
      const meta = await doc.getMetadata();
      const title = (meta.info as { Title?: unknown } | undefined)?.Title;
      const fromMeta = typeof title === "string" ? finalizeTitle(title) : undefined;
      if (fromMeta) return fromMeta;
    } catch {
      // メタデータが読めなくても本文から探す
    }
    if (doc.numPages < 1) return undefined;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: unknown; transform?: number[] };
      if (typeof it.str !== "string" || !Array.isArray(it.transform) || it.transform.length < 6) continue;
      const t = it.transform;
      items.push({ str: it.str, height: Math.hypot(t[2], t[3]), y: t[5] });
    }
    return pickTitleFromPdfItems(items);
  } finally {
    destroy();
  }
}

// ---------- Word (.docx) ----------

function countDocxPages(bytes: Uint8Array): number | undefined {
  const files = unzipSome(bytes, (n) => n === "docProps/app.xml");
  const app = files["docProps/app.xml"];
  if (!app) return undefined;
  const m = strFromU8(app).match(/<Pages>\s*(\d+)\s*<\/Pages>/);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : undefined;
}

/** core.xml の dc:title（XML の文字参照は DOMParser が復号する） */
function readCoreTitle(files: Record<string, Uint8Array>): string | undefined {
  const core = files["docProps/core.xml"];
  if (!core) return undefined;
  try {
    const node = parseXml(core).getElementsByTagName("dc:title")[0];
    return finalizeTitle(node?.textContent);
  } catch {
    return undefined;
  }
}

/** styles.xml から、指定した名前（小文字）のスタイルの styleId を集める */
function styleIdsByName(styles: Uint8Array | undefined, names: string[]): Set<string> {
  const ids = new Set<string>();
  if (!styles) return ids;
  try {
    const doc = parseXml(styles);
    for (const st of Array.from(doc.getElementsByTagName("w:style"))) {
      const id = st.getAttribute("w:styleId");
      const name = st.getElementsByTagName("w:name")[0]?.getAttribute("w:val")?.toLowerCase();
      if (id && name && names.includes(name)) ids.add(id);
    }
  } catch {
    // styles が壊れていても既定の styleId で探す
  }
  return ids;
}

function extractDocxTitle(bytes: Uint8Array): string | undefined {
  const files = unzipSome(
    bytes,
    (n) =>
      n === "docProps/core.xml" || n === "word/document.xml" || n === "word/styles.xml",
  );
  const fromMeta = readCoreTitle(files);
  if (fromMeta) return fromMeta;

  const body = files["word/document.xml"];
  if (!body) return undefined;
  // 日本語版 Word の見出し 1 は styleId が "1" になることがあるので、styles.xml の名前から引く
  const titleIds = styleIdsByName(files["word/styles.xml"], ["title"]);
  titleIds.add("Title");
  const headingIds = styleIdsByName(files["word/styles.xml"], ["heading 1"]);
  headingIds.add("Heading1");

  try {
    const doc = parseXml(body);
    const paragraphs = Array.from(doc.getElementsByTagName("w:p")).map((p) => ({
      style: p.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") ?? "",
      text: Array.from(p.getElementsByTagName("w:t"))
        .map((t) => t.textContent ?? "")
        .join(""),
    }));
    // 「表題」スタイルを優先し、無ければ見出し 1。最初の段落を勝手に題とはしない
    for (const ids of [titleIds, headingIds]) {
      for (const p of paragraphs) {
        if (!ids.has(p.style)) continue;
        const t = finalizeTitle(p.text);
        if (t) return t;
      }
    }
  } catch {
    // 本文が読めなければ見つからなかった扱い
  }
  return undefined;
}

// ---------- PowerPoint (.pptx) ----------

function countPptxSlides(bytes: Uint8Array): number | undefined {
  let count = 0;
  // filter 内で名前だけ数え、展開はしない
  unzipSync(bytes, {
    filter: (f) => {
      if (slideNumberOf(f.name) !== null) count += 1;
      return false;
    },
  });
  return count > 0 ? count : undefined;
}

function extractPptxTitle(bytes: Uint8Array): string | undefined {
  const files = unzipSome(
    bytes,
    (n) =>
      n === "docProps/core.xml" ||
      n === "ppt/presentation.xml" ||
      n === "ppt/_rels/presentation.xml.rels" ||
      slideNumberOf(n) !== null,
  );
  const fromMeta = readCoreTitle(files);
  if (fromMeta) return fromMeta;

  // 1 枚目はファイル名の番号順ではなく presentation の並び順で決める
  const order =
    resolveSlideOrder(files, new DOMParser()) ??
    Object.keys(files)
      .filter((p) => slideNumberOf(p) !== null)
      .sort((a, b) => (slideNumberOf(a) ?? 0) - (slideNumberOf(b) ?? 0));
  const first = order.map((p) => files[p]).find(Boolean);
  if (!first) return undefined;

  try {
    const doc = parseXml(first);
    for (const ph of Array.from(doc.getElementsByTagName("p:ph"))) {
      const type = ph.getAttribute("type");
      if (type !== "title" && type !== "ctrTitle") continue;
      let sp: Element | null = ph;
      while (sp && sp.nodeName !== "p:sp") sp = sp.parentElement;
      if (!sp) continue;
      const text = Array.from(sp.getElementsByTagName("a:p"))
        .map((p) =>
          Array.from(p.getElementsByTagName("a:t"))
            .map((t) => t.textContent ?? "")
            .join(""),
        )
        .join(" ");
      const t = finalizeTitle(text);
      if (t) return t;
    }
  } catch {
    // 読めなければ見つからなかった扱い
  }
  return undefined;
}

// ---------- 公開 API ----------

/**
 * ページ数を数える（PDF / .docx / .pptx のみ）。数えられない・壊れているときは undefined。
 * 例外は投げない（登録や一覧表示を止めない）。
 */
export async function countDocumentPages(
  bytes: Uint8Array,
  entry: EntryLike,
): Promise<number | undefined> {
  try {
    if (documentKindOf(entry) === "pdf") return await countPdfPages(bytes);
    if (isWordDocxEntry(entry)) return countDocxPages(bytes);
    if (isPptxEntry(entry)) return countPptxSlides(bytes);
  } catch (err) {
    console.warn("ページ数を数えられませんでした:", err);
  }
  return undefined;
}

/**
 * ファイル内のタイトルを取り出す（メタデータ → 本文の順）。
 * 見つからない・読めないときは undefined。例外は投げない。
 */
export async function extractDocumentTitle(
  bytes: Uint8Array,
  entry: EntryLike,
): Promise<string | undefined> {
  try {
    if (documentKindOf(entry) === "pdf") return await extractPdfTitle(bytes);
    if (isWordDocxEntry(entry)) return extractDocxTitle(bytes);
    if (isPptxEntry(entry)) return extractPptxTitle(bytes);
  } catch (err) {
    console.warn("ファイル内のタイトルを読めませんでした:", err);
  }
  return undefined;
}

// ---------- 名前の組み立て ----------

const NAME_EXT_RE = /\.(pdf|docx?|pptx?)$/i;

/**
 * タイトルに元の名前の拡張子（.pdf / .docx など）を付けた新しい名前を返す。
 * 元の名前がそれらで終わっていなければ付けない。ファイル名に使えない文字はそのまま
 * （名前は表示名のため）。
 */
export function titleToName(title: string, currentName: string): string {
  const ext = currentName.match(NAME_EXT_RE)?.[0] ?? "";
  const base = normalizeTitleText(title);
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) return base;
  return base + ext;
}

/** 新しい名前がいまの名前と同じか（変更なし扱いにするか） */
export function isSameName(a: string, b: string): boolean {
  return normalizeTitleText(a) === normalizeTitleText(b);
}

// ---------- ページ数の後追い付与 ----------

/**
 * このセッションでページ数を読めなかった素材（壊れている・上限超過・実体が無い）。
 * 警告を何度も出さないためと、一覧の「—」に「読めなかった」理由を出すために持つ。
 */
const pageCountFailures = new Set<string>();

/** この素材は後追いで読もうとして読めなかったか（一覧の「—」のヒント用） */
export function hasPageCountFailed(fileId: string): boolean {
  return pageCountFailures.has(fileId);
}

/**
 * ファイルから読んで保存済みの著者（origin: "file"）を、いまの規則で整え直す。
 * 規則を直したとき（人名でない語・所属の印・文字化けの扱い等）に、既に保存した分へも効かせるため。
 * 実体は読まない（保存済みの名前を整え直すだけ）。整えた結果が同じなら書かないので、毎回呼んでよい。
 * 著者が全部消えて出どころが空になったら欄ごと落とす（読み終えた印は残し、読み直さない）。
 *
 * @returns 整え直した素材の件数
 */
export async function recleanFileAuthors(): Promise<number> {
  const current = getLatestMediaIndex() ?? (await readMediaIndex());
  if (!current) return 0;
  let changed = 0;
  const media = current.media.map((m) => {
    const info = m.sourceInfo;
    if (info?.origin !== "file" || !info.authors?.length) return m;
    const before = info.authors;
    const authors = cleanAuthorNames(before);
    if (authors.length === before.length && authors.every((a, i) => a === before[i])) return m;
    changed += 1;
    const { authors: _drop, ...rest } = info;
    const next: SourceInfo = authors.length > 0 ? { ...rest, authors } : rest;
    if (next.year === undefined && !next.venue && !next.doi && !next.authors) {
      const { sourceInfo: _omit, ...withoutInfo } = m;
      return withoutInfo;
    }
    return { ...m, sourceInfo: next };
  });
  if (changed === 0) return 0;
  await saveMediaIndex({ ...current, updatedAt: new Date().toISOString(), media });
  notifyMediaIndexChanged({ reason: "source-info-reclean", count: changed });
  return changed;
}

/** 後追い付与の進め方（テストで小さくするため外から変えられる） */
export type DocumentInfoBackfillOptions = {
  /** 同時に読む件数。巨大な実体を同時に抱えすぎないよう小さく保つ */
  concurrency?: number;
  /** この件数たまったら保存する */
  flushEvery?: number;
  /** 前回の保存からこの時間が過ぎたら、件数に届かなくても保存する（一覧が進んで見えるように） */
  flushIntervalMs?: number;
};

const DEFAULT_BACKFILL_OPTIONS: Required<DocumentInfoBackfillOptions> = {
  concurrency: 3,
  flushEvery: 25,
  flushIntervalMs: 1500,
};

/** ページ数がまだ無く、数えられる素材か */
function needsPageCount(m: MediaIndexEntry): boolean {
  return m.pageCount === undefined && canCountPages(m);
}

/** 出どころをまだ読んでいない PDF か（読んで何も無かったものは印で飛ばす） */
function needsSourceScan(m: MediaIndexEntry): boolean {
  return documentKindOf(m) === "pdf" && !m.sourceInfo && !m.sourceInfoScanned;
}

/** 1 件分の読み取り結果。読めなかった項目は持たない */
type DocumentInfoResult = {
  pageCount?: number;
  /** 出どころを読み終えた（何も無かった場合も true） */
  sourceScanned?: boolean;
  sourceInfo?: SourceInfo;
};

/** 1 件を読む。PDF は 1 回だけ開いて、ページ数と出どころを一緒に取る */
async function readDocumentInfo(
  bytes: Uint8Array,
  entry: EntryLike,
  want: { pages: boolean; source: boolean },
): Promise<DocumentInfoResult> {
  if (documentKindOf(entry) !== "pdf") {
    return want.pages ? { pageCount: await countDocumentPages(bytes, entry) } : {};
  }
  const { doc, destroy } = await openPdf(bytes);
  try {
    const out: DocumentInfoResult = {};
    if (want.pages && doc.numPages > 0) out.pageCount = doc.numPages;
    if (want.source) {
      out.sourceInfo = await readPdfSourceInfo(doc as unknown as PdfDocLike);
      out.sourceScanned = true;
    }
    return out;
  } finally {
    destroy();
  }
}

/**
 * 登録済みのドキュメント素材へ、後追いでページ数と出どころ（PDF の中の著者・DOI）を付ける。
 * それぞれの欄ができる前に登録した素材は持たないので、起動後に裏で埋める。
 *
 * 進め方:
 *   - 対象は開始時のスナップショットで決める（走査中に増えた素材は登録時に付く）
 *   - 実体は数件ずつ並べて読む。PDF は 1 回だけ開いて、ページ数と出どころを一緒に取る
 *   - 結果はためておき、一定件数か一定時間ごとにまとめて保存して一覧へ通知する。
 *     1 件ごとに保存すると、素材一覧のファイル全体の書き直しと一覧の読み直しが件数ぶん走り、
 *     数百件で目に見えて遅くなる（v0.99 までの作り）
 *   - 保存は毎回「その時点の最新インデックス」に重ね、走査中に消えた／既に付いたものは触らない
 *
 * 出どころは端末の中で読むだけで、外には何も送らない（Crossref は人が押したときだけ）。
 * 読んでも何も無かった PDF には `sourceInfoScanned` の印を付け、次の起動で読み直さない。
 * ページ数は、数える対象で失敗したもの（壊れた PDF 等）を毎回試すことになるが、警告は 1 回だけ。
 * 読めなかったものがあれば最後に 1 回通知して、一覧の「—」のヒントを「読めなかった」に切り替える。
 *
 * @returns 新たに付けた件数（ページ数・出どころそれぞれ）
 */
export async function backfillDocumentInfo(
  readBytes: (fileId: string, maxBytes: number) => Promise<Uint8Array | undefined>,
  signal?: { aborted: boolean },
  options: DocumentInfoBackfillOptions = {},
): Promise<{ pageCounts: number; sourceInfos: number }> {
  const opts = { ...DEFAULT_BACKFILL_OPTIONS, ...options };
  const result = { pageCounts: 0, sourceInfos: 0 };
  const start = getLatestMediaIndex() ?? (await readMediaIndex());
  if (!start) return result;

  const targets = start.media
    .filter((m) => needsPageCount(m) || needsSourceScan(m))
    .map((m) => ({
      fileId: m.fileId,
      type: m.type,
      mimeType: m.mimeType,
      want: { pages: needsPageCount(m), source: needsSourceScan(m) },
    }));
  if (targets.length === 0) return result;

  let failed = 0;
  const pending = new Map<string, DocumentInfoResult>();
  let lastFlush = Date.now();
  // 保存は 1 本ずつ（並んだ読み手が同時に保存して、互いの結果を上書きしないように）
  let flushChain: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (pending.size === 0) return flushChain;
    const batch = new Map(pending);
    pending.clear();
    lastFlush = Date.now();
    flushChain = flushChain.then(async () => {
      const current = getLatestMediaIndex();
      if (!current) return; // サインアウト等でインデックスが無くなった
      let pages = 0;
      let sources = 0;
      const media = current.media.map((m) => {
        const r = batch.get(m.fileId);
        if (!r) return m;
        let next = m;
        if (r.pageCount !== undefined && m.pageCount === undefined) {
          next = { ...next, pageCount: r.pageCount };
          pages += 1;
        }
        // 走査中に人が出どころを入れていたら、そちらを残す（印だけ付ける）
        if (r.sourceScanned && !m.sourceInfoScanned) {
          next = { ...next, sourceInfoScanned: true };
          if (r.sourceInfo && !m.sourceInfo) {
            next = { ...next, sourceInfo: r.sourceInfo };
            sources += 1;
          }
        }
        return next;
      });
      if (media.every((m, i) => m === current.media[i])) return;
      try {
        await saveMediaIndex({ ...current, updatedAt: new Date().toISOString(), media });
      } catch (err) {
        console.warn("ページ数・出どころの後追い付与に失敗:", err);
        return;
      }
      result.pageCounts += pages;
      result.sourceInfos += sources;
      notifyMediaIndexChanged({
        reason: "page-count-backfill",
        filled: result.pageCounts,
        sourceInfos: result.sourceInfos,
      });
    });
    return flushChain;
  };

  const handle = async (target: (typeof targets)[number]) => {
    const markFailed = () => {
      if (!target.want.pages) return; // 出どころだけの対象は、読めなくても次回また試すだけ
      failed += 1;
      if (!pageCountFailures.has(target.fileId)) {
        pageCountFailures.add(target.fileId);
        console.warn("ページ数を数えられない素材:", target.fileId);
      }
    };

    let bytes: Uint8Array | undefined;
    try {
      bytes = await readBytes(target.fileId, MAX_HASH_BYTES);
    } catch {
      bytes = undefined; // 消えた・権限が無い等。次の起動でまた試す
    }
    if (!bytes) {
      markFailed(); // 上限超過 or 実体が無い
      return;
    }
    let info: DocumentInfoResult;
    try {
      info = await readDocumentInfo(bytes, target, target.want);
    } catch {
      // 実体は読めたのに PDF として開けない＝壊れている。出どころは読み直しても同じなので
      // 読み終えた扱いにして、起動のたびに開き直さない（ページ数は従来どおり毎回試す）
      info = target.want.source ? { sourceScanned: true } : {};
    }
    if (target.want.pages && info.pageCount === undefined) markFailed();
    if (info.pageCount === undefined && !info.sourceScanned) return;

    pending.set(target.fileId, info);
    if (pending.size >= opts.flushEvery || Date.now() - lastFlush >= opts.flushIntervalMs) {
      await flush();
    }
  };

  // 数件ずつ並べて読む（読み込みと PDF の解析の待ちを重ねる）
  let next = 0;
  const worker = async () => {
    while (!signal?.aborted && next < targets.length) {
      const target = targets[next++];
      await handle(target);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  // 中断されても、読み終えた分は残す（次回はその続きから）
  await flush();

  if (failed > 0) notifyMediaIndexChanged({ reason: "page-count-backfill-done", filled: result.pageCounts, failed });
  return result;
}

function notifyMediaIndexChanged(detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail }));
}
