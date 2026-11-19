// 画像 OCR の「読み」（text / altText）の取り込み口の共通処理。
//
// 共有フォルダの他人のノート JSON・素材索引の JSON・保存済みの索引など、信用できない
// 入り口からも流れ込むので、文字列でなければ無視し、長さを打ち切る
// （数 MB の文字列で検索・索引・描画が固まらないように）。

/** 別の読み（検索用 altText）の最大文字数 */
export const MAX_ALT_TEXT_CHARS = 20_000;

/**
 * 表示用の読み（text）の最大文字数。
 * PP-OCR が 1 枚の画像で返す量より十分大きく、数 MB は通さない値。
 */
export const MAX_OCR_TEXT_CHARS = 100_000;

/** 上限で切る。上限がサロゲートペアの途中に当たったら、片割れを残さない */
export function cutAt(v: string, max: number): string {
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** 文字列なら前後の空白を落として上限で切って返す。文字列でない・空なら undefined */
function sanitize(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = cutAt(v, max).trim();
  return t || undefined;
}

/** 別の読み（altText）用。文字列でない・空なら undefined */
export function sanitizeAltText(v: unknown): string | undefined {
  return sanitize(v, MAX_ALT_TEXT_CHARS);
}

/** 表示用の読み（text）用。文字列でない・空なら undefined */
export function sanitizeOcrText(v: unknown): string | undefined {
  return sanitize(v, MAX_OCR_TEXT_CHARS);
}

/** 自分で読んだ直後の結果用。上限だけかける（空白は触らない） */
export function capOcrText(v: string): string {
  return cutAt(v, MAX_OCR_TEXT_CHARS);
}

/** 数値でなければ 0（NaN・Infinity も 0） */
export function safeOcrNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** mediaOcr のエントリ（オブジェクト）だけを取り出す。配列・文字列・null などは無いものとして扱う */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** mediaOcr から 1 ブロック分のエントリを取り出す。オブジェクトでなければ undefined */
export function readOcrEntry(
  mediaOcr: unknown,
  blockId: string,
): Record<string, unknown> | undefined {
  if (!isRecord(mediaOcr)) return undefined;
  const e = mediaOcr[blockId];
  return isRecord(e) ? e : undefined;
}

/** mediaOcr のエントリ一覧。mediaOcr 自体がオブジェクトでなければ空、エントリがオブジェクトでなければ飛ばす */
export function ocrEntriesOf(mediaOcr: unknown): Record<string, unknown>[] {
  if (!isRecord(mediaOcr)) return [];
  return Object.values(mediaOcr).filter(isRecord);
}
