// 前置きメタの抽出
//
// 装置ファイルの `# Device Model: ENV-MONITOR-X9` や `# Sampling Interval: 1 Day` は、
// 表を作るときに真っ先に捨てられるが、実験ノートでは測定条件そのものであり、
// 表の中身と同じくらい重要な情報。ここで key: value として拾い、
// tableMeta.source に残して「この表がどんな条件で採られたか」を来歴に含める。

import type { SourceMetaEntry } from "./types";

/** 行頭のコメント記号と余白を落とす */
function stripCommentMarker(line: string): string {
  return line.replace(/^\s*(#+|;+|!+|\/\/|\*+)\s?/, "").trim();
}

/** `-----` `=====` のような区切り線（意味を持たない装飾行） */
function isSeparatorLine(text: string): boolean {
  return /^[-=_*~\s]+$/.test(text) && text.length > 0;
}

/**
 * 前置き行から key: value を拾う。
 *
 * `key: value` と `key = value` の両方を受ける。キーが極端に長い行は説明文の
 * 途中にコロンが入っただけとみなして落とす（`注意: 以下の値は…` のような行を
 * 測定条件として拾ってしまうのを避ける）。
 */
export function extractHeaderMeta(headerLines: string[]): SourceMetaEntry[] {
  const entries: SourceMetaEntry[] = [];
  for (const raw of headerLines) {
    const text = stripCommentMarker(raw);
    if (text === "" || isSeparatorLine(text)) continue;
    const m = text.match(/^([^:=]{1,40}?)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim();
    if (key === "" || value === "") continue;
    entries.push({ key, value });
  }
  return entries;
}
