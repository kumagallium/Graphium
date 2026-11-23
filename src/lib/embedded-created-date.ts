// ファイルの中に記録された「作成日」を読む（素材の資料の日付の自動入力に使う）。
//
// 読むのは文書の中に書き込まれた作成日だけ:
//   - Word / PowerPoint / Excel（.docx / .pptx / .xlsx）: docProps/core.xml の dcterms:created
//   - PDF: 情報辞書の /CreationDate（D:YYYYMMDD…）。読めなければ XMP の xmp:CreateDate
// 最終保存日（dcterms:modified・ModDate）とファイルの更新日（File.lastModified）は使わない。
// どちらも開いて保存し直すだけで新しくなり、「その資料がいつのものか」を表さないため
// （2026-11-24 の利用者の判断）。作成日が無い形式（画像・テキストなど）は何も返さない。
//
// 戻り値は保存形の "YYYY-MM-DD"。時差の書かれていない日時は書かれた暦日のまま、時差の書かれた日時は
// 端末の暦日に直す。読めない・あり得ない日付（未来・1980 年より前・実在しない日）は null。
// 1980 年より前を捨てるのは、ZIP の既定時刻（1980-01-01）や壊れた値を資料の日付にしないため。

import { unzipSync, strFromU8 } from "fflate";

const OOXML_EXTS = [".docx", ".pptx", ".xlsx"];
const MIN_YEAR = 1980;
/** core.xml として読む上限（普通は 1〜2 KB） */
const CORE_XML_MAX_BYTES = 256 * 1024;

/** ファイル名と MIME から、中の作成日を読める形式か */
export function embeddedDateKind(name: string, mimeType?: string): "ooxml" | "pdf" | null {
  const lower = name.toLowerCase();
  if (OOXML_EXTS.some((e) => lower.endsWith(e))) return "ooxml";
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  return null;
}

/** 暦日の部品が実在する日か（2016-02-30 や 13 月を弾く） */
function isRealDay(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 日付の部品を保存形の暦日に。
 *   - 時差が書かれていない: 書かれた暦日をそのまま採る（作者の現地の日付。端末の時差で動かさない）
 *   - 時差が書かれている（Z / +09:00 など）: その瞬間を端末の暦日に直す（Word は作成日時を UTC で持つ）
 * 未来（今から 36 時間より先）・1980 年より前・実在しない日は null
 */
function partsToDay(
  p: { y: number; mo: number; d: number; h: number; mi: number; s: number; offsetMin: number | null },
  now: Date,
): string | null {
  if (!isRealDay(p.y, p.mo, p.d) || p.h > 24 || p.mi > 59 || p.s > 60) return null;
  let y = p.y;
  let mo = p.mo;
  let d = p.d;
  let instant: number;
  if (p.offsetMin === null) {
    instant = Date.UTC(y, mo - 1, d, p.h, p.mi, p.s) - 14 * 3600 * 1000; // 最も早い時差でも未来かを見る
  } else {
    instant = Date.UTC(y, mo - 1, d, p.h, p.mi, p.s) - p.offsetMin * 60 * 1000;
    const local = new Date(instant);
    y = local.getFullYear();
    mo = local.getMonth() + 1;
    d = local.getDate();
  }
  if (instant > now.getTime() + 36 * 3600 * 1000) return null;
  if (y < MIN_YEAR) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** W3CDTF / ISO 8601 の日時（"2016-05-03" / "2016-05-03T01:02:03Z" / "…+09:00"）を保存形の暦日に */
export function isoLikeToDay(raw: string, now = new Date()): string | null {
  const m = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", sec = "0", zone] = m;
  let offsetMin: number | null = null;
  if (zone) {
    if (zone.toUpperCase() === "Z") offsetMin = 0;
    else {
      const z = zone.replace(":", "");
      offsetMin = (z[0] === "-" ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
    }
  }
  return partsToDay({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +sec, offsetMin }, now);
}

/** docProps/core.xml の文字列から dcterms:created を読む */
export function createdFromCoreXml(xml: string, now = new Date()): string | null {
  const m = xml.match(/<dcterms:created\b[^>]*>\s*([^<\s]+)\s*<\/dcterms:created>/);
  if (!m) return null;
  return isoLikeToDay(m[1], now);
}

/**
 * PDF の日付文字列 "D:YYYYMMDDHHmmSSOHH'mm'" を保存形の暦日に。
 * 時刻・時差は省略できる。月・日が無い（年だけ・年月だけ）ときは 1 日として読むが、
 * 書かれた月・日が 00 や 13 のように実在しないときは null（繰り下げて別の日にしない）
 */
export function pdfDateToDay(raw: unknown, now = new Date()): string | null {
  if (typeof raw !== "string") return null;
  const m = raw
    .trim()
    .match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz])|([+-])(\d{2})'?(\d{2})?'?)?/);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", zulu, sign, oh, om = "00"] = m;
  let offsetMin: number | null = null;
  if (zulu) offsetMin = 0;
  else if (sign && oh) offsetMin = (sign === "+" ? 1 : -1) * (+oh * 60 + +om);
  return partsToDay({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +sec, offsetMin }, now);
}

/** PDF の日付は先頭（XMP）か末尾（情報辞書・追記）にある。大きい PDF は両端だけ文字列にする */
const PDF_EDGE_BYTES = 2 * 1024 * 1024;

function pdfWindows(bytes: Uint8Array): { head: string; tail: string } {
  if (bytes.length <= PDF_EDGE_BYTES * 2) {
    const all = latin1(bytes);
    return { head: all, tail: all };
  }
  return {
    head: latin1(bytes.subarray(0, PDF_EDGE_BYTES)),
    tail: latin1(bytes.subarray(bytes.length - PDF_EDGE_BYTES)),
  };
}

/**
 * 情報辞書の /CreationDate（平文の文字列のもの）。いちばん後ろに出たものを採る。
 * 情報辞書はふつう末尾にあり、追記保存でも後ろに足される。前に出るのは添付ファイルの
 * /Params の作成日などで、文書の作成日ではない。16 進や UTF-16 で書かれたもの・圧縮された
 * オブジェクトの中にあるものは読めない（呼び出し側が pdfjs で情報辞書を読む）
 */
export function pdfInfoCreatedFromBytes(bytes: Uint8Array, now = new Date()): string | null {
  const { head, tail } = pdfWindows(bytes);
  for (const text of head === tail ? [tail] : [tail, head]) {
    const all = [...text.matchAll(/\/CreationDate\s*\(\s*(D:\d{4}[^)]*)\)/g)];
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const day = pdfDateToDay(all[i][1], now);
      if (day) return day;
    }
  }
  return null;
}

/** XMP の xmp:CreateDate（情報辞書から読めなかったときの代わり） */
export function pdfXmpCreatedFromBytes(bytes: Uint8Array, now = new Date()): string | null {
  const { head, tail } = pdfWindows(bytes);
  for (const text of head === tail ? [head] : [head, tail]) {
    const xmp =
      text.match(/<xmp:CreateDate>\s*([^<\s]+)\s*<\/xmp:CreateDate>/) ??
      text.match(/xmp:CreateDate="([^"]+)"/);
    if (xmp) {
      const day = isoLikeToDay(xmp[1], now);
      if (day) return day;
    }
  }
  return null;
}

/** PDF のバイト列だけで作成日を読む（情報辞書 → XMP）。pdfjs を使わない場面・テスト用 */
export function createdFromPdfBytes(bytes: Uint8Array, now = new Date()): string | null {
  return pdfInfoCreatedFromBytes(bytes, now) ?? pdfXmpCreatedFromBytes(bytes, now);
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

/** .docx / .pptx / .xlsx のバイト列から作成日を読む */
export function createdFromOoxmlBytes(bytes: Uint8Array, now = new Date()): string | null {
  let files: Record<string, Uint8Array>;
  try {
    // 展開後の大きさで絞る（中身を偽った ZIP で core.xml だけが巨大に膨らむのを避ける）
    files = unzipSync(bytes, {
      filter: (f) => f.name === "docProps/core.xml" && f.originalSize <= CORE_XML_MAX_BYTES,
    });
  } catch {
    return null;
  }
  const core = files["docProps/core.xml"];
  if (!core) return null;
  return createdFromCoreXml(strFromU8(core), now);
}
