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

/** PDF の Author メタデータを著者名の配列にする。`;` と ` and ` で分割し、無意味な値は捨てる */
export function parseAuthorsField(raw: string): string[] {
  return raw
    .split(/;|\s+and\s+/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && !AUTHOR_JUNK_RE.test(s) && !AUTHOR_FILE_EXT_RE.test(s));
}

// ---------- PDF（ファイル内メタデータ） ----------

type PdfMeta = {
  info?: { Author?: unknown; Custom?: Record<string, unknown> };
  metadata?: { get?: (name: string) => unknown } | null;
};

type PdfDocLike = {
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
  } finally {
    void task.destroy();
  }
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
