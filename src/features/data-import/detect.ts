// 取り込み設定の自動推定
//
// eureco の同種のダイアログは開始行・終了行・区切り文字をすべて人に決めさせるが、
// Graphium は「開いた時点で推定済み、人は直すだけ」にする（段階的開示）。
// 装置ファイルは前置きと後書きが付くだけで、本体は「列数が一定の行が連続する塊」
// として素直に立ち上がる。その塊を探すだけで開始行・終了行・区切りがまとめて決まる。

import { countFields } from "./parse";
import type { DelimitedImportOptions, DelimiterKind } from "./types";

/** コメント行の目印。装置出力の前置きはたいてい行頭記号で始まる */
const COMMENT_PREFIX = /^\s*(#|;|!|\/\/|\*)/;

type Candidate = {
  delimiter: DelimiterKind;
  customDelimiter?: string;
  collapseConsecutive: boolean;
};

// 優先順は同点時のタイブレークにも使う（よくある順）
const CANDIDATES: Candidate[] = [
  { delimiter: "comma", collapseConsecutive: false },
  { delimiter: "tab", collapseConsecutive: false },
  { delimiter: "space", collapseConsecutive: true },
  { delimiter: "custom", customDelimiter: ";", collapseConsecutive: false },
];

/** 候補ごとに「列数が一定で連続する最長の塊」を探した結果 */
type Run = {
  /** 0 起点の開始行 */
  start: number;
  /** 0 起点の終了行（含む） */
  end: number;
  /** その塊の列数 */
  width: number;
};

function delimiterChar(c: Candidate): string {
  if (c.delimiter === "comma") return ",";
  if (c.delimiter === "tab") return "\t";
  if (c.delimiter === "space") return " ";
  return c.customDelimiter ?? ";";
}

/**
 * その候補で列数が一定の最長ブロックを探す。
 *
 * 空行とコメント行は塊を作らない（が、塊を分断もしない — 装置出力はデータの
 * 途中に区切り線やページヘッダを挟むことがあるため、と言いたいところだが、
 * 現時点では素直に分断する扱いにしている。誤って後書きまで飲み込むより、
 * 短めに取って人が終了行を伸ばすほうが安全）。
 */
function findLongestRun(lines: string[], candidate: Candidate): Run | null {
  const delim = delimiterChar(candidate);
  let best: Run | null = null;
  let start = -1;
  let width = 0;

  const flush = (endExclusive: number) => {
    if (start < 0 || width < 2) return;
    const length = endExclusive - start;
    if (length < 2) return; // 見出し + データ 1 行は最低ほしい
    const bestLength = best ? best.end - best.start + 1 : 0;
    if (
      length > bestLength ||
      (length === bestLength && best !== null && width > best.width)
    ) {
      best = { start, end: endExclusive - 1, width };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBreak = line.trim() === "" || COMMENT_PREFIX.test(line);
    const n = isBreak ? 0 : countFields(line, delim, candidate.collapseConsecutive);
    if (n < 2 || n !== width) {
      flush(i);
      start = n >= 2 ? i : -1;
      width = n >= 2 ? n : 0;
    }
  }
  flush(lines.length);
  return best;
}

/**
 * 本文から取り込み設定を推定する。
 *
 * 塊が見つからなければ「全行をカンマ区切りで取り込む」に倒す。取り込めない
 * ファイルでもダイアログは開き、人が区切り文字を選べば表になる。
 */
export function detectImportOptions(lines: string[]): DelimitedImportOptions {
  // 末尾の空行は終了行の推定をぶれさせるだけなので数に入れない
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;
  const body = lines.slice(0, last);

  let bestRun: Run | null = null;
  let bestCandidate: Candidate | null = null;
  for (const candidate of CANDIDATES) {
    const run = findLongestRun(body, candidate);
    if (!run) continue;
    const bestLength = bestRun ? bestRun.end - bestRun.start + 1 : 0;
    const length = run.end - run.start + 1;
    if (
      length > bestLength ||
      (length === bestLength && bestRun !== null && run.width > bestRun.width)
    ) {
      bestRun = run;
      bestCandidate = candidate;
    }
  }

  if (!bestRun || !bestCandidate) {
    return {
      headerRow: 1,
      endRow: Math.max(1, body.length),
      delimiter: "comma",
      collapseConsecutive: false,
    };
  }

  // 見出し行が塊に入らないことがある。`2theta,d,I,(hkl)` のように、データ側だけ
  // 値の中に区切り文字を含む（`(0,0,2)`）と列数が食い違い、列数が一定の塊は
  // データ行だけになるため。塊の直前が空行でもコメント行でもなければ、それは
  // 見出し行とみなして範囲を 1 行広げる。
  const headerIdx =
    bestRun.start > 0 && isHeaderCandidate(body[bestRun.start - 1], bestCandidate)
      ? bestRun.start - 1
      : bestRun.start;

  return {
    headerRow: headerIdx + 1,
    endRow: bestRun.end + 1,
    delimiter: bestCandidate.delimiter,
    customDelimiter: bestCandidate.customDelimiter,
    collapseConsecutive: bestCandidate.collapseConsecutive,
  };
}

/**
 * 見出し行になりうる行か。
 *
 * 同じ区切り文字で 2 つ以上に割れることを条件にする。これが無いと、データの
 * 直前にあるだけのタイトル行（`title` のような 1 語の行）まで見出しとして
 * 飲み込んでしまう。
 */
function isHeaderCandidate(
  line: string | undefined,
  candidate: Candidate
): boolean {
  if (!line || line.trim() === "") return false;
  if (COMMENT_PREFIX.test(line)) return false;
  return (
    countFields(line, delimiterChar(candidate), candidate.collapseConsecutive) >= 2
  );
}
