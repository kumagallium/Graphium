// 取り込み設定 → テーブル注釈の source
//
// ダイアログで人が決めた設定をそのまま来歴として残す。ここを通さずに表だけ作ると
// 「この数字はどの生データの何行目か」が失われるため、挿入経路は必ずここを通す。

import { extractHeaderMeta } from "./header-meta";
import type { DelimitedImportOptions, ParsedDelimited } from "./types";
import type { TableSource } from "../../lib/document-types";

export function buildTableSource(params: {
  fileName: string;
  fileId?: string;
  options: DelimitedImportOptions;
  parsed: ParsedDelimited;
  /** 取り込み時刻。省略時は現在時刻 */
  importedAt?: string;
}): TableSource {
  const { fileName, fileId, options, parsed } = params;
  const meta = extractHeaderMeta(parsed.headerLines);
  const source: TableSource = {
    kind: "delimited-file",
    fileName,
    importedAt: params.importedAt ?? new Date().toISOString(),
    options: {
      headerRow: options.headerRow,
      endRow: options.endRow,
      delimiter: options.delimiter,
      collapseConsecutive: options.collapseConsecutive,
    },
  };
  if (fileId) source.fileId = fileId;
  if (options.customDelimiter) source.options.customDelimiter = options.customDelimiter;
  if (meta.length > 0) source.meta = meta;
  return source;
}
