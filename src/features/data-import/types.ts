// 区切りテキスト取り込みの型
//
// 装置が吐く .txt / .dat / .csv は「前置きのメタ情報 → 見出し行 → データ行 → 後書き」
// という形をしていることが多い。この層は「どこからどこまでが表か」と
// 「何で区切られているか」だけをパラメータとして持ち、変換自体は純関数で行う。
//
// パラメータを型として独立させているのは、取り込み後にテーブル注釈
// （tableMeta.source）へそのまま保存して来歴に残すため。同じ設定で読み直せることが
// 「この表がどの生データのどこから生まれたか」の再現性になる。

/** 区切り文字の種類。custom のときだけ customDelimiter を見る */
export type DelimiterKind = "comma" | "tab" | "space" | "custom";

/** 取り込み設定。行番号は 1 起点（プレビューの行番号と一致させる） */
export type DelimitedImportOptions = {
  /** 見出し行の行番号。ここより前は前置きメタとして扱う */
  headerRow: number;
  /** 取り込む最終行の行番号（含む）。ここより後は後書きとして捨てる */
  endRow: number;
  delimiter: DelimiterKind;
  /** delimiter === "custom" のときの 1 文字 */
  customDelimiter?: string;
  /** 連続した区切り文字を 1 つとして扱う（固定幅を空白で詰めた装置出力向け） */
  collapseConsecutive: boolean;
};

/** 前置きメタから拾った key: value（装置名・測定間隔など） */
export type SourceMetaEntry = {
  key: string;
  value: string;
};

/** パース結果。headers / rows はそのままテーブルブロックのセルになる */
export type ParsedDelimited = {
  headers: string[];
  rows: string[][];
  /** 見出し行より前の生テキスト行（捨てずに保持する） */
  headerLines: string[];
  /** endRow より後の生テキスト行 */
  footerLines: string[];
};
