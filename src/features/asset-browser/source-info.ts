// 素材の出どころ情報（著者・年・発行元・DOI）を読む・取得する・整える。
//
//   - PDF のファイル内メタデータ / 1 ページ目の本文から DOI と著者を読む（端末内で完結）
//   - DOI から Crossref で補完する（ユーザーがボタンを押したときだけ。外部通信はここだけ）
//
// 「分かれば使う、分からなければ何もしない」。年はファイルから取らない
// （PDF の CreationDate は出版年ではないため）。

import type { SourceInfo } from "./media-index";

export { sourceInfoSearchText, matchesAllTokens, formatSourceLine } from "./source-info-text";

// ---------- DOI ----------

const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const DOI_IN_TEXT_RE = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i;

/** DOI 文字列を正規化する。DOI の形でなければ undefined（小文字化はしない） */
export function normalizeDoi(raw: string): string | undefined {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  s = s.replace(/[.,;)\]]+$/, "");
  return DOI_RE.test(s) ? s : undefined;
}

/** 本文中の最初の DOI（`doi.org/10...` 形式でも裸の `10.xxxx/...` でも） */
export function findDoiInText(text: string): string | undefined {
  const m = DOI_IN_TEXT_RE.exec(text);
  return m ? normalizeDoi(m[1]) : undefined;
}

// ---------- 著者 ----------

const AUTHOR_JUNK_RE = /^(unknown|administrator|admin|user|author|anonymous)$/i;
const AUTHOR_FILE_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|tex|dvi|txt|rtf|odt|ps)$/i;
/**
 * 人ではなく、ソフト・組版・端末・部署が入ったときに出る語（どこかに含めば捨てる）。
 * 例: `Nature User`・`Owner`・`Administratör`・`Physics Dept`・`Pinnacle`（組版ソフト）
 */
const AUTHOR_NOT_PERSON_RE =
  /(^|[^\p{L}])(users?|owner|admin\p{L}*|administrat\p{L}*|dept|department|pinnacle|microsoft|windows|acrobat|adobe|printer|scanner|default)($|[^\p{L}])/iu;
/** 敬称（`Mr Mutuku` の `Mr`）。名前の前から外す */
const AUTHOR_HONORIFIC_RE = /^(mr|mrs|ms|dr|prof)\.?\s+/i;
/** 共著の省略（`T Ishikawa et al`）。名前の後ろから外す */
const AUTHOR_ET_AL_RE = /\s+et\.?\s*al\.?$/i;

/** 前後の引用符（"…" や “…”）と、末尾に残った区切りの , を落とす */
const AUTHOR_TRIM_RE = /^["'“”‘’]+|["'“”‘’,]+$/g;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** よく出る HTML の文字参照（`F. Lalibert&eacute`）。; が欠けていても直す */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", quot: '"', nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  atilde: "ã", otilde: "õ", ntilde: "ñ", ccedil: "ç", aring: "å", oslash: "ø", szlig: "ß",
  Aacute: "Á", Eacute: "É", Oacute: "Ó", Uacute: "Ú", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", Ccedil: "Ç",
};

function decodeEntities(s: string): string {
  const fromCode = (m: string, code: number) =>
    code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (m, n: string) => fromCode(m, parseInt(n, 16)))
    .replace(/&#(\d+);?/g, (m, n: string) => fromCode(m, Number(n)))
    .replace(/&([a-z]+);?/gi, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

/**
 * UTF-8 を Latin-1 として読んだ文字化け（`GarcÃa` のような形）を戻す。
 * 化けの形（Ã・Â＋続きのバイト）があり、全文字が 1 バイトに収まり、UTF-8 として正しく読めるときだけ直す。
 */
function fixMojibake(s: string): string {
  if (!/[ÃÂ][\u0080-¿]/.test(s)) return s;
  const codes = Array.from(s, (ch) => ch.codePointAt(0) ?? 0);
  if (codes.some((c) => c > 0xff)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(codes));
  } catch {
    return s;
  }
}

/**
 * 名前の後ろに付いた所属の印・メールアドレスを外す（`Eldon D. Case a * casee@egr.msu.edu`、
 * `Sanaz Abdolmohammadi 1`）。論文の組版で著者名の肩に付く印がそのまま入ったもの。
 */
function stripAffiliationMarks(s: string): string {
  return s
    .replace(/\S+@\S+/g, " ")
    .replace(/[*†‡§¶]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\s+([a-z]|\d+))+$/, "")
    .trim();
}

/**
 * 人名らしくない 1 語か。PDF の Author には、作った人の名前ではなく
 * パソコンのアカウント名（`kumagai`・`RUHIA_B`・`Ja`）や、ソフト・端末の名前
 * （`ZiMac`・`IntuitionLabs`・`NANOTIGP`）が入っていることが多い。
 * 空白を含まない 1 語で、すべて小文字・数字や _ @ を含む・2 文字以下・すべて大文字・
 * 語の途中に大文字がある（Mc / Mac / De などの姓の頭は除く）のどれかなら捨てる。
 * 漢字・かなを含むもの（「宮本博之」）と、大文字で始まる普通の 1 語（`Tsuji`）は名前として残す。
 */
function looksLikeAccountName(s: string): boolean {
  if (CJK_RE.test(s) || /\s/.test(s)) return false;
  if (s === s.toLowerCase() || /[\d_@]/.test(s) || Array.from(s).length <= 2) return true;
  if (s === s.toUpperCase()) return true;
  const inner = s.replace(/^(Mc|Mac|De|Di|Da|La|Le|Van|Von|O')/, "");
  return /\p{Ll}\p{Lu}/u.test(inner);
}

/**
 * , 区切りで複数人が 1 つに入っていれば分ける（「A. Smith, B. Lee, C. Wu」「Chinatsu Okamura, Takashi Ueda」）。
 * 「Smith, John」のような「姓, 名」1 人分と見分けるため、分けたどれもが空白を含む
 * （＝それぞれが姓名になっている）ときだけ分ける。
 */
function splitCommaList(s: string): string[] {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /\s/.test(p))) return parts;
  return [s];
}

/**
 * 区切りなしで何人も並んだもの（`Kengo Kishimoto Naoya Ikeda Koji Akai Tsuyoshi Koyanagi`）を
 * 2 語ずつに分ける。大文字で始まる普通の語（頭文字やピリオドを含まない）だけが 6 語以上・偶数個
 * 並ぶときに限る（4 語までは長い 1 人の名前と見分けられないので分けない）。
 */
function splitSpaceJoinedNames(s: string): string[] {
  const words = s.split(" ");
  if (words.length < 6 || words.length % 2 !== 0) return [s];
  if (!words.every((w) => /^\p{Lu}[\p{Ll}'’-]+$/u.test(w))) return [s];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 2) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** 1 人分の名前を整える。人名として使えなければ undefined */
function cleanAuthorName(raw: string): string | undefined {
  let s = fixMojibake(decodeEntities(raw)).replace(/\s+/g, " ").trim().replace(AUTHOR_TRIM_RE, "").trim();
  s = stripAffiliationMarks(s).replace(AUTHOR_HONORIFIC_RE, "").replace(AUTHOR_ET_AL_RE, "").trim();
  if (!s) return undefined;
  if (AUTHOR_JUNK_RE.test(s) || AUTHOR_FILE_EXT_RE.test(s) || AUTHOR_NOT_PERSON_RE.test(s)) return undefined;
  // 組版・印刷の印（`IOP Publishing #4 1068 2000 Jul 12 14:56:10`）。人名は数字や # を含まない
  if (/[#\d]/.test(s)) return undefined;
  if (looksLikeAccountName(s)) return undefined;
  return s;
}

/**
 * ファイルから読んだ著者名の並びを整える（分ける・印を外す・人名でないものを捨てる・重複を除く）。
 * 保存済みの著者（origin: "file"）を新しい規則で整え直すときにも使う。
 */
export function cleanAuthorNames(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const piece of splitCommaList(name.replace(/\s+/g, " ").trim().replace(AUTHOR_TRIM_RE, ""))) {
      const cleaned = cleanAuthorName(piece);
      if (!cleaned) continue;
      for (const person of splitSpaceJoinedNames(cleaned)) {
        if (!out.includes(person)) out.push(person);
      }
    }
  }
  return out;
}

/**
 * PDF の Author メタデータを著者名の配列にする。`;` と ` and ` で分割し、無意味な値は捨てる。
 * 文字参照（`&#246;` の ; ）で名前が切れないよう、分ける前に戻しておく。
 */
export function parseAuthorsField(raw: string): string[] {
  return cleanAuthorNames(decodeEntities(raw).split(/;|\s+and\s+/i));
}

// ---------- PDF（ファイル内メタデータ） ----------

type PdfMeta = {
  info?: { Author?: unknown; Custom?: Record<string, unknown> };
  metadata?: { get?: (name: string) => unknown } | null;
};

export type PdfDocLike = {
  numPages: number;
  getMetadata: () => Promise<PdfMeta>;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
};

/**
 * PDF のメタデータと 1 ページ目から DOI・著者を読む。何も取れなければ undefined。
 * 取れたものには origin: "file" を付ける。
 */
export async function extractPdfSourceInfo(bytes: Uint8Array): Promise<SourceInfo | undefined> {
  const [{ pdfjs }, { PDFJS_DOC_OPTIONS }] = await Promise.all([
    import("react-pdf"),
    import("../../lib/pdfjs-config"),
  ]);
  // pdfjs は渡した配列を worker へ転送して使い切ることがあるので、コピーを渡す
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_DOC_OPTIONS });
  try {
    const doc = (await task.promise) as unknown as PdfDocLike;
    return await readPdfSourceInfo(doc);
  } finally {
    void task.destroy();
  }
}

/**
 * 開いた PDF から DOI・著者を読む（開く・閉じるは呼び出し側）。
 * ページ数と一緒に読む後追い付与が、同じ PDF を二度開かずに済むよう分けてある。
 */
export async function readPdfSourceInfo(doc: PdfDocLike): Promise<SourceInfo | undefined> {
  let doi: string | undefined;
  let authors: string[] = [];
  try {
    const meta = await doc.getMetadata();
    const custom = meta.info?.Custom ?? {};
    const candidates: unknown[] = [
      custom["prism:doi"],
      custom.doi,
      meta.metadata?.get?.("prism:doi"),
      meta.metadata?.get?.("dc:identifier"),
    ];
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      doi = normalizeDoi(c);
      if (doi) break;
    }
    const author = meta.info?.Author;
    if (typeof author === "string") authors = parseAuthorsField(author);
  } catch {
    // メタデータが読めなくても本文から探す
  }
  if (!doi && doc.numPages >= 1) {
    try {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => (typeof (it as { str?: unknown }).str === "string" ? (it as { str: string }).str : ""))
        .join(" ");
      doi = findDoiInText(text);
    } catch {
      // 本文が読めなければ DOI 無しのまま
    }
  }
  if (!doi && authors.length === 0) return undefined;
  return {
    ...(authors.length > 0 ? { authors } : {}),
    ...(doi ? { doi } : {}),
    origin: "file",
  };
}

// ---------- Crossref ----------

/** Crossref に該当する DOI が無かった */
export class CrossrefNotFoundError extends Error {
  constructor(doi: string) {
    super(`Crossref に見つかりません: ${doi}`);
    this.name = "CrossrefNotFoundError";
  }
}

const CROSSREF_TIMEOUT_MS = 10_000;

type CrossrefDate = { "date-parts"?: (number | null)[][] };
type CrossrefMessage = {
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  publisher?: string;
  title?: string[];
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  issued?: CrossrefDate;
};

function yearOf(d: CrossrefDate | undefined): number | undefined {
  const y = d?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" && Number.isFinite(y) ? y : undefined;
}

/**
 * DOI から Crossref で著者・年・発行元・題名を取得する（DOI だけを送る。ヘッダは付けない）。
 * 見つからなければ CrossrefNotFoundError、それ以外の失敗は Error を投げる。
 */
export async function fetchCrossrefSourceInfo(
  doi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ info: SourceInfo; title?: string }> {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error(`DOI の形式が正しくありません: ${doi}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CROSSREF_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new Error("Crossref の応答がありませんでした（タイムアウト）");
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new CrossrefNotFoundError(normalized);
  if (!res.ok) throw new Error(`Crossref の取得に失敗しました（HTTP ${res.status}）`);
  const body = (await res.json()) as { message?: CrossrefMessage };
  const msg = body.message ?? {};

  const authors = (msg.author ?? [])
    .map((a) => {
      const full = [a.given, a.family].filter(Boolean).join(" ").trim();
      return full || a.name?.trim() || "";
    })
    .filter(Boolean);
  const venue = msg["container-title"]?.[0]?.trim() || msg.publisher?.trim() || undefined;
  const year = yearOf(msg["published-print"]) ?? yearOf(msg["published-online"]) ?? yearOf(msg.issued);
  const title = msg.title?.[0]?.replace(/\s+/g, " ").trim() || undefined;

  return {
    info: {
      ...(authors.length > 0 ? { authors } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(venue ? { venue } : {}),
      doi: normalized,
      origin: "crossref",
    },
    ...(title ? { title } : {}),
  };
}

// ---------- 重ねる ----------

/** patch の定義済み項目で base を上書きする（Crossref の結果を既存に重ねる用） */
export function mergeSourceInfo(base: SourceInfo | undefined, patch: SourceInfo | undefined): SourceInfo {
  const out: SourceInfo = { ...(base ?? {}) };
  if (!patch) return out;
  for (const key of Object.keys(patch) as (keyof SourceInfo)[]) {
    if (patch[key] !== undefined) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}
