// 区切りテキスト（.txt / .dat / .csv / .tsv）の取り込み
//
// 装置が吐く生データを表にして、その変換パラメータを来歴として残す機能。
// パーサ（parse / detect / header-meta）は純関数で、UI（DataImportModal）は
// その上の薄い層。挿入経路は必ず buildTableSource を通して出所を残す。

export { parseDelimited, splitLines, splitLine, resolveDelimiter } from "./parse";
export { detectImportOptions } from "./detect";
export { extractHeaderMeta } from "./header-meta";
export { buildTableSource } from "./source";
export { toTableBlock, defaultCaption } from "./to-table-block";
export { DataImportModal } from "./DataImportModal";
export type { DataImportResult } from "./DataImportModal";
export { readDataFileText } from "./read-file";
export { isDelimitedDataFile, DELIMITED_FILE_ACCEPT } from "./file-kind";
export type {
  DelimiterKind,
  DelimitedImportOptions,
  ParsedDelimited,
  SourceMetaEntry,
} from "./types";
