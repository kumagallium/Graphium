import { DataTableBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";

// ブロック登録エントリー
export const dataTableBlock: CustomBlockEntry = {
  type: "dataTable",
  spec: DataTableBlock,
};

// ホスト（note-app）が使う配線と純ロジック
export { setDataTableReimportCallback } from "./callbacks";
export {
  DOC_TABLE_DEFAULT_MAX_ROWS,
  defaultImportTarget,
  parseDataTableSource,
  serializeDataTableSource,
} from "./model";
export {
  clearDataTableCache,
  loadDataTable,
  peekDataTable,
  peekDataTableFromBlock,
  subscribeDataTableData,
  type DataTableData,
} from "./data";
export { dataTableDisplayName, dataTableDisplayNameOf } from "./source";
