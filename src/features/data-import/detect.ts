// 取り込み設定の自動推定
//
// eureco の同種のダイアログは開始行・終了行・区切り文字をすべて人に決めさせるが、
// Graphium は「開いた時点で推定済み、人は直すだけ」にする（段階的開示）。
// 装置ファイルは前置きと後書きが付くだけで、本体は「列数が一定の行が連続する塊」
// として素直に立ち上がる。その塊を探すだけで開始行・終了行・区切りがまとめて決まる。

import { DETECT_SAMPLE_LINES, DETECT_TAIL_SCAN_LINES } from "./large-file";
import { countFields, splitLine } from "./parse";
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

/** 推定の中身。塊（run）と候補も返すのは、大きなファイルで終了行を補正するため */
type Detection = {
  options: DelimitedImportOptions;
  run: Run | null;
  candidate: Candidate | null;
};

/**
 * 本文から取り込み設定を推定する。
 *
 * 塊が見つからなければ「全行をカンマ区切りで取り込む」に倒す。取り込めない
 * ファイルでもダイアログは開き、人が区切り文字を選べば表になる。
 *
 * 末尾の空行を除いた行数が DETECT_SAMPLE_LINES を超えるファイルは、先頭の標本だけで
 * 区切りと見出し行を推定する（全行で 4 候補を試すと 23 万行で 11 秒固まった）。
 * 標本の最後までデータが続いているときは、終了行をファイルの末尾側から決める。
 *
 * この近似の代償（どちらも人が終了行・区切りを直せば取り込める）:
 * - 前置きが標本（5,000 行）を超えるファイルは、標本に塊が無く見出し行を外す
 * - 標本より後ろに、標本内の塊より長い別の塊があるファイルは、そちらを見逃す
 * - 終了行は、末尾 DETECT_TAIL_SCAN_LINES 行の範囲でしか後書きを見分けない。
 *   標本の最後まで続く塊で、それより長い後書きがあると、後書きも終了行に含まれる
 * - 末尾に塊と同じ列数の行があれば、そこまでを範囲にする。途中に別の形の行が
 *   挟まっていても範囲に入る（変換では列数を揃えて出すので、プレビューで気づける）
 */
export function detectImportOptions(lines: string[]): DelimitedImportOptions {
  // 末尾の空行は終了行の推定をぶれさせるだけなので数に入れない
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;

  if (last <= DETECT_SAMPLE_LINES) {
    return detectCore(lines.slice(0, last)).options;
  }

  const sample = lines.slice(0, DETECT_SAMPLE_LINES);
  const { options, run, candidate } = detectCore(sample);
  if (!run || !candidate) {
    // 標本に塊が無いときの既定は「全行」。標本の長さで切らず、ファイル全体を指す
    return { ...options, endRow: Math.max(1, last) };
  }
  // 終了行はファイルの末尾側から決める: 末尾から戻って、塊と同じ列数の最後の行を探す。
  // 塊が標本の途中で切れていても同じ（標本の中に列数の違う行が 1 行あるだけで、その先も
  // データが続いていることがある。全行を見ていた頃は後ろの長い塊を拾えていたので、
  // 標本の中で切れたことを「データの終わり」とは決めつけない）
  const delim = delimiterChar(candidate);
  const stop = Math.max(run.end, last - DETECT_TAIL_SCAN_LINES);
  for (let i = last - 1; i >= stop; i--) {
    const line = lines[i];
    if (line.trim() === "" || COMMENT_PREFIX.test(line)) continue;
    if (countFields(line, delim, candidate.collapseConsecutive) === run.width) {
      return { ...options, endRow: i + 1 };
    }
  }
  // 末尾に同じ列数の行が無い。塊が標本の途中で終わっていれば、データはそこまでとみなす。
  // 標本の最後まで続いていたなら、どこで終わるかは分からないので末尾までを指す
  if (run.end < sample.length - 1) return options;
  return { ...options, endRow: last };
}

function detectCore(body: string[]): Detection {
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
      options: {
        headerRow: 1,
        endRow: Math.max(1, body.length),
        delimiter: "comma",
        collapseConsecutive: false,
      },
      run: null,
      candidate: null,
    };
  }

  // 見出し行が塊に入らないことがある。`2theta,d,I,(hkl)` のように、データ側だけ
  // 値の中に区切り文字を含む（`(0,0,2)`）と列数が食い違い、列数が一定の塊は
  // データ行だけになるため。その場合だけ範囲を 1 行広げる。
  //
  // 広げるのは「塊の先頭がデータ行に見える」ときに限る。塊の先頭が既に見出し
  // （文字が並ぶ行）なら、その手前にある行は前置きの続きであって見出しではない
  // （`2theta range: 21.34 - 147.24` のような行を飲み込まないため）。
  const runStartsWithData = looksLikeDataRow(body[bestRun.start], bestCandidate);
  const headerIdx =
    runStartsWithData &&
    bestRun.start > 0 &&
    isHeaderCandidate(body[bestRun.start - 1], bestCandidate)
      ? bestRun.start - 1
      : bestRun.start;

  return {
    options: {
      headerRow: headerIdx + 1,
      endRow: bestRun.end + 1,
      delimiter: bestCandidate.delimiter,
      customDelimiter: bestCandidate.customDelimiter,
      collapseConsecutive: bestCandidate.collapseConsecutive,
    },
    run: bestRun,
    candidate: bestCandidate,
  };
}

/**
 * その行がデータ行に見えるか（セルの過半数が数値）。
 *
 * 見出し行かデータ行かを、列数ではなく中身で見分けるための判定。装置ファイルの
 * 見出しは単位や記号を含むこともあるので「全部が非数値」までは求めない。
 */
function looksLikeDataRow(line: string | undefined, candidate: Candidate): boolean {
  if (!line) return false;
  const cells = splitLine(
    line,
    delimiterChar(candidate),
    candidate.collapseConsecutive
  ).filter((c) => c !== "");
  if (cells.length === 0) return false;
  const numeric = cells.filter((c) => Number.isFinite(Number(c))).length;
  return numeric * 2 > cells.length;
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
