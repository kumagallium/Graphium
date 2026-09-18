// 資料テキストを窓（LLM に一度に渡す範囲）に分割する純関数。
// 長い資料（PDF 抽出で 80,000 字を超えるもの）をトピック段が窓ごとに読むために使う。
// 実測（窓 4,000 字・重ね 400 字）で裏づけのある文が大幅に増えたため、値は固定する
// （設定項目にはしない）。

/** 窓の大きさ・重なりは固定値。実測結果に基づくため設定項目にはしない */
export const WINDOW_SIZE = 4000;
export const WINDOW_OVERLAP = 400;

export type SourceWindow = { index: number; start: number; end: number; text: string };

export type SplitOptions = {
  size?: number;
  overlap?: number;
  /** size の手前何文字以内で文末を探すか（既定は overlap と同じ） */
  boundarySlack?: number;
};

// 文末とみなす区切り: 。．！？!? の直後 / 改行 / ". " の直後
const SENTENCE_END_RE = /[。．！？!?]|\n|\. /g;

/**
 * text[from, upperBound) の範囲で、upperBound に一番近い「文末の直後」の位置を探す。
 * 見つからなければ undefined。
 */
function findBoundary(text: string, from: number, upperBound: number, slack: number): number | undefined {
  const lowerBound = Math.max(from, upperBound - slack);
  if (upperBound <= from) return undefined;
  let best: number | undefined;
  SENTENCE_END_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END_RE.exec(text)) !== null) {
    const endPos = m.index + m[0].length; // 区切り文字の直後
    if (endPos <= from) continue;
    if (endPos > upperBound) break;
    if (endPos >= lowerBound) best = endPos;
  }
  return best;
}

/**
 * 資料全文を窓に分割する。
 * - text.length が size 以下なら窓 1 枚（全文そのまま）
 * - 各窓は先頭から size 字を目安に区切るが、区切り位置は size の手前 boundarySlack 字以内で
 *   最後の文末に寄せる（見つからなければ size でそのまま切る）
 * - 次の窓は区切り位置から overlap 字戻って始める（ただし前の窓の開始より後ろ — 無限ループ防止）
 */
export function splitIntoWindows(text: string, options?: SplitOptions): SourceWindow[] {
  const size = options?.size ?? WINDOW_SIZE;
  const overlap = options?.overlap ?? WINDOW_OVERLAP;
  const slack = options?.boundarySlack ?? overlap;
  if (size <= 0) throw new Error("size must be > 0");
  if (overlap < 0 || overlap >= size) throw new Error("overlap must be in [0, size)");

  if (text.length <= size) {
    return [{ index: 0, start: 0, end: text.length, text }];
  }

  const windows: SourceWindow[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const targetEnd = Math.min(start + size, text.length);
    let end: number;
    if (targetEnd >= text.length) {
      end = text.length;
    } else {
      const boundary = findBoundary(text, start, targetEnd, slack);
      end = boundary ?? targetEnd;
      if (end <= start) end = targetEnd; // 保険（無限ループ防止）
    }
    windows.push({ index, start, end, text: text.slice(start, end) });
    index++;
    if (end >= text.length) break;
    const nextStart = Math.max(start + 1, end - overlap);
    start = nextStart;
  }
  return windows;
}
