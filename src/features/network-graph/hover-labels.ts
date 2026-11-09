// ホバーしたノードとつながる相手のうち、題を出すものを選ぶ。
//
// 引いた状態では相手が狭い範囲に固まるので、全部に題を出すと文字が重なって
// 読めない。画面上の題の箱がぶつからないものだけを、優先順に上限まで選ぶ。

export type LabelCandidate = {
  id: string;
  /** ノード中心の画面座標 */
  x: number;
  y: number;
  /** ノードの画面上の半径（題はその下に出る） */
  r: number;
  /** 題の文字列（幅の見積もりに使う） */
  text: string;
};

type Box = { x1: number; y1: number; x2: number; y2: number };

/** 題 1 行の高さと、折り返し幅（画面 px） */
const LINE_PX = 15;
const MAX_WIDTH_PX = 130;

/** 文字列の画面上の幅の見積もり（全角 1 字 ≒ 文字の大きさ、半角は 0.6 倍） */
export function estimateLabelWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0xff ? fontPx : fontPx * 0.6;
  return w;
}

function labelBox(c: LabelCandidate, fontPx: number): Box {
  const raw = estimateLabelWidth(c.text, fontPx);
  const lines = Math.max(1, Math.ceil(raw / MAX_WIDTH_PX));
  const w = Math.min(raw, MAX_WIDTH_PX);
  const top = c.y + c.r + 2;
  return { x1: c.x - w / 2, y1: top, x2: c.x + w / 2, y2: top + lines * LINE_PX };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * ホバー中のノード（anchor、題は必ず出す）と重ならず、互いにも重ならない相手を
 * 優先順（candidates の並び）に max 件まで選ぶ。
 */
export function pickHoverLabels(
  anchor: LabelCandidate,
  candidates: LabelCandidate[],
  opts: { max: number; fontPx: number; anchorFontPx: number },
): string[] {
  const taken: Box[] = [labelBox(anchor, opts.anchorFontPx)];
  const picked: string[] = [];
  for (const c of candidates) {
    if (picked.length >= opts.max) break;
    const box = labelBox(c, opts.fontPx);
    if (taken.some((t) => overlaps(t, box))) continue;
    taken.push(box);
    picked.push(c.id);
  }
  return picked;
}
