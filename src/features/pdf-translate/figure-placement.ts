// 図の差し込み位置決め（純粋ロジック、pdfjs / BlockNote 非依存でテスト可能）
//
// ページ内の翻訳ブロック列に対し、図表キャプション（図N / Figure N / 表N 等）の
// 直前（＝上）へ、抽出順の画像を順番に差し込む近似ヒューリスティック。

/** ブロックのプレーンテキストを取り出す（content spans を連結） */
export function blockText(block: any): string {
  if (!block || !Array.isArray(block.content)) return "";
  return block.content
    .map((s: any) => (typeof s?.text === "string" ? s.text : ""))
    .join("")
    .trim();
}

// 図ラベル（写真・グラフ等、画像が伴うもの）と表ラベルを分ける。
// 表（Table/表）は通常ラスター画像を持たないので、画像差し込みの対象にしない。
// 枝番（3a, 3d）は番号に直結する場合のみ拾う。番号と枝番の間に空白を許すと
// "Figure 3 shows" の "s" を枝番として食って参照文判定をすり抜けるため \s* を挟まない。
const FIGURE_PREFIX = /^\s*(図|fig(?:ure)?\.?|scheme|chart)\s*\.?\s*\d+[a-z]?\s*/i;
const TABLE_PREFIX = /^\s*(表|table)\s*\.?\s*\d+[a-z]?\s*/i;

// 参照文の合図: 図番号の直後に来ると「本文中の言及」を示すもの。
// 例: 「Figure 3d は …を示す」「図2 を参照」「Figure 3 shows …」。
const JA_REFERENCE_PARTICLES = ["は", "が", "を", "に", "へ", "で", "と", "も", "や", "の", "から", "より"];
const EN_REFERENCE_VERB =
  /^(shows?|presents?|depicts?|illustrates?|displays?|summari[sz]es?|reports?|gives?|lists?|is|are|was|were)\b/i;

/** 行頭がラベルに一致し、かつ本文中の参照文でなければ true（キャプション）。 */
function matchesCaption(text: string, labelRe: RegExp): boolean {
  const m = text.match(labelRe);
  if (!m) return false;
  const rest = text.slice(m[0].length);
  if (rest.length === 0) return true; // "Figure 1" 単体ラベル
  if (JA_REFERENCE_PARTICLES.some((p) => rest.startsWith(p))) return false;
  if (EN_REFERENCE_VERB.test(rest)) return false;
  return true;
}

/** 図キャプション（画像が伴う）か。Table/表 は含めない。 */
export function isFigureCaption(block: any): boolean {
  return matchesCaption(blockText(block), FIGURE_PREFIX);
}

/** 図・表いずれかのキャプションか（汎用判定）。 */
export function isCaptionBlock(block: any): boolean {
  const text = blockText(block);
  return matchesCaption(text, FIGURE_PREFIX) || matchesCaption(text, TABLE_PREFIX);
}

/** 画像名末尾の "image {M}" 番号を取り出す（再利用時の順序復元用） */
export function imageOrder(name: string): number {
  const m = name.match(/image\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

export type PlacedImage = { url: string; name: string };

export function imageBlock(url: string, name: string): any {
  return {
    id: crypto.randomUUID(),
    type: "image",
    props: { url, name },
    children: [],
  };
}

/**
 * 文書全体のブロック列に対し、抽出順の k 番目の画像を「k 番目の図キャプションの直前（上）」へ差し込む。
 *
 * 文書全体（グローバル）で対応付けるのがポイント:
 *   - 図キャプションと画像が別ページにあってもよい（どちらも出現順に並ぶため index で揃う）。
 *   - 表（Table/表）キャプションは画像を持たないので対象から除外し、図の対応がズレないようにする。
 *
 * キャプションに割り当てられなかった余りの画像は leftover として返す（呼び出し側で末尾に付ける）。
 */
export function insertImagesAtCaptions(
  blocks: any[],
  images: PlacedImage[],
): { blocks: any[]; inserted: number; leftover: PlacedImage[] } {
  if (images.length === 0) return { blocks, inserted: 0, leftover: [] };
  const out: any[] = [];
  let imgIdx = 0;
  for (const b of blocks) {
    if (imgIdx < images.length && isFigureCaption(b)) {
      out.push(imageBlock(images[imgIdx].url, images[imgIdx].name));
      imgIdx += 1;
    }
    out.push(b);
  }
  return { blocks: out, inserted: imgIdx, leftover: images.slice(imgIdx) };
}
