// 資料の日付（doc.sourceDate）の読み取り・表示・並べ替え。
//
// 資料の日付は「その資料がいつのものか」（論文の出版日・ブログの公開日・議事録の日付など）。
// ノートの作成日時（createdAt = Graphium で作った日時）とは別に持ち、作成日時は書き換えない
// （来歴を偽らないため）。
//
// 精度は資料によって違う（年だけ・年月だけの資料がある）ので、分かっている桁までを
// ISO 8601 の短縮形で持つ: "YYYY" / "YYYY-MM" / "YYYY-MM-DD"。日を知らないのに
// "-01" で埋めない（埋めると、分かっていない日付を分かっているように見せてしまう）。
//
// 短縮形のまま文字列として比べると時系列の順になる（"2012" < "2012-03" < "2012-03-15" < "2013"）。
// 年だけの資料は、その年の中で一番前に並ぶ。

/** 保存形（"YYYY" / "YYYY-MM" / "YYYY-MM-DD"）か */
const STORED_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** 1000〜9999 年を受け付ける（4 桁の年だけを扱う） */
function validYear(y: number): boolean {
  return y >= 1000 && y <= 9999;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function compose(y: number, m?: number, d?: number): string | null {
  if (!validYear(y)) return null;
  if (m === undefined) return String(y);
  if (m < 1 || m > 12) return null;
  const mm = String(m).padStart(2, "0");
  if (d === undefined) return `${y}-${mm}`;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${mm}-${String(d).padStart(2, "0")}`;
}

/**
 * 人や AI が書いた日付を保存形にする。読めなければ null。
 *
 * 受け付ける書き方（前後の空白は無視）:
 * - 2012 / 2012-3 / 2012-03-05 / 2012/3/5 / 2012.3.5
 * - 2012年 / 2012年3月 / 2012年3月5日
 * - 時刻付きの ISO 8601（2012-03-05T10:00:00Z）は日付の部分だけを使う
 *
 * 月名の英語表記（March 2012 など）は受け付けない（言語ごとの揺れを抱えないため）。
 */
export function parseSourceDate(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  // 全角数字を半角に
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  // ISO 8601 の時刻部分を落とす（日付の桁だけを使う。タイムゾーンで日がずれないように変換しない）
  const iso = s.match(/^(\d{4}-\d{1,2}-\d{1,2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) s = iso[1];

  const ja = s.match(/^(\d{4})\s*年(?:\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?)?$/);
  if (ja) {
    return compose(Number(ja[1]), ja[2] ? Number(ja[2]) : undefined, ja[3] ? Number(ja[3]) : undefined);
  }
  const num = s.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/);
  if (num) {
    return compose(Number(num[1]), num[2] ? Number(num[2]) : undefined, num[3] ? Number(num[3]) : undefined);
  }
  return null;
}

/**
 * 保存されている値として正しいか（読み込み時の検査）。
 * 手で書き換えた JSON や古いビルドの値を、そのまま一覧に出さないために使う。
 */
export function normalizeStoredSourceDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(STORED_RE);
  if (!m) return undefined;
  const out = compose(Number(m[1]), m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
  return out ?? undefined;
}

/** 分かっている桁 */
export type SourceDatePrecision = "year" | "month" | "day";

export function sourceDatePrecision(value: string): SourceDatePrecision {
  return value.length === 4 ? "year" : value.length === 7 ? "month" : "day";
}

/**
 * 並べ替えのキー。資料の日付があればそれ、無ければ作成日（YYYY-MM-DD 以降の ISO 文字列）。
 * どちらも先頭が YYYY-MM-DD の形なので、文字列のまま比べると時系列の順になる。
 * 同じ日のノート同士は、作成日時の時刻まで比べる（資料の日付は時刻を持たないので、その日の頭に並ぶ）。
 */
export function sourceDateSortKey(entry: { sourceDate?: string; createdAt?: string }): string {
  return entry.sourceDate || entry.createdAt || "";
}
