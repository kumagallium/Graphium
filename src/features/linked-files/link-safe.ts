// リンクした素材の控えの値を、落ちずに・安全に扱うための小さな関数。
// 控えは受け取ったノートや読み込んだ JSON で細工された値を含みうる。

/** Date が表せる範囲（ミリ秒の絶対値の上限） */
const MAX_DATE_MS = 8.64e15;

/** 更新日時（ミリ秒）として使える値か。有限・0 より大きい・Date の有効範囲内。 */
export function isValidMtimeMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Math.abs(v) <= MAX_DATE_MS;
}

/** 大きさ（バイト）として使える値か。0 以上の安全な整数。 */
export function isValidSize(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** 更新日時を ISO 文字列にする。範囲外・壊れた値は undefined（例外を投げない）。 */
export function linkModifiedIso(mtimeMs: unknown): string | undefined {
  if (!isValidMtimeMs(mtimeMs)) return undefined;
  try {
    return new Date(mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * AI に渡す文へ入れる名前・場所を 1 行の平らな文字にする。
 * 制御文字と改行を空白にし、連続する空白を 1 つにまとめ、max 文字で切る。
 */
export function plainLabel(value: string, max = 300): string {
  const flat = String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : flat;
}
