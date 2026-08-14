// 区切りテキスト → 表（純関数）
//
// エディタにも DOM にも依存しない。chart-data.ts と同じ方針で、
// 「テキスト → headers/rows」の変換だけをここに閉じ込めて単体テストできるようにする。
//
// 値はすべて文字列のまま返す。数値・日時の解釈はチャート側（chart-data.ts）が
// 既に持っているので、ここで型を推定して壊すことはしない。

import type { DelimitedImportOptions, ParsedDelimited } from "./types";

/** 改行コードの違い（CRLF / CR / LF）を吸収して行に割る */
export function splitLines(text: string): string[] {
  // 先頭 BOM はセル値に混ざると見出し名がずれるので落とす
  const body = text.replace(/^﻿/, "");
  return body.split(/\r\n|\r|\n/);
}

/** その設定で実際に使う区切り文字。custom が空なら null（＝区切らない） */
export function resolveDelimiter(
  options: Pick<DelimitedImportOptions, "delimiter" | "customDelimiter">
): string | null {
  switch (options.delimiter) {
    case "comma":
      return ",";
    case "tab":
      return "\t";
    case "space":
      return " ";
    case "custom": {
      const c = options.customDelimiter ?? "";
      return c.length > 0 ? c[0] : null;
    }
  }
}

/**
 * 1 行を区切り文字で分割する。
 *
 * ダブルクォートは RFC 4180 相当で扱う（`"a,b"` は 1 セル、`""` はエスケープされた `"`）。
 * 装置出力はクォートしないことが多いが、同じ入口で .csv も受けるため素通しにはしない。
 * collapse が真なら連続した区切りを 1 つとみなし、両端の区切りも落とす
 * （空白 3 個で桁を揃えた固定幅出力を空セルだらけにしないため）。
 */
export function splitLine(
  line: string,
  delimiter: string,
  collapse: boolean
): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' && current === "") {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);

  if (!collapse) return cells.map((c) => c.trim());

  // 連続区切り由来の空セルだけを落とす。中身のあるセルの間に挟まる空セルも
  // 「連続した区切り」なので同じ扱いでよい（先頭・末尾のインデントも消える）。
  return cells.map((c) => c.trim()).filter((c) => c !== "");
}

/** その行がその設定で何列になるか（範囲・区切りの自動推定で使う） */
export function countFields(
  line: string,
  delimiter: string,
  collapse: boolean
): number {
  if (line.trim() === "") return 0;
  return splitLine(line, delimiter, collapse).length;
}

/** 列数の最頻値（同数なら多い方）。表の列数をデータ行の実態に合わせるために使う */
function modeWidth(widths: number[]): number {
  const counts = new Map<number, number>();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && w > best)) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

/**
 * 設定に従って本文を表に変換する。
 *
 * 列数は「見出しの列数」と「データ行の列数の最頻値」の大きい方に揃える
 * （足りない側は空セルで埋める）。揃えないと BlockNote のテーブルが行ごとに
 * 列数の違う壊れた表になる。
 *
 * 見出しに合わせて切らないのは、`(hkl)` 列に `(0,0,2)` が入っているような
 * クォート無しの CSV でデータの後半が黙って消えるため。ずれたまま出せば
 * プレビューで気づいて区切り文字を直せるが、消えた値は取り戻せない。
 */
export function parseDelimited(
  text: string,
  options: DelimitedImportOptions
): ParsedDelimited {
  const lines = splitLines(text);
  const delimiter = resolveDelimiter(options);
  const headerIdx = Math.max(0, options.headerRow - 1);
  const endIdx = Math.min(lines.length - 1, options.endRow - 1);

  const headerLines = lines.slice(0, headerIdx);
  const footerLines = endIdx + 1 < lines.length ? lines.slice(endIdx + 1) : [];

  if (delimiter === null || headerIdx > endIdx || headerIdx >= lines.length) {
    return { headers: [], rows: [], headerLines, footerLines };
  }

  const rawHeaders = splitLine(lines[headerIdx], delimiter, options.collapseConsecutive);
  const rawRows: string[][] = [];
  for (let i = headerIdx + 1; i <= endIdx; i++) {
    const line = lines[i];
    // 範囲内の空行はデータではないので落とす（末尾の改行で空行が入りやすい）
    if (line.trim() === "") continue;
    rawRows.push(splitLine(line, delimiter, options.collapseConsecutive));
  }

  const width = Math.max(
    rawHeaders.length,
    modeWidth(rawRows.map((r) => r.length))
  );
  const fit = (cells: string[]) =>
    Array.from({ length: width }, (_, c) => cells[c] ?? "");

  return {
    headers: fit(rawHeaders),
    rows: rawRows.map(fit),
    headerLines,
    footerLines,
  };
}
