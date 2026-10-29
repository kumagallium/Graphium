// 日時が自動で入るテーブル（旧・記録テーブル）のエントリーポイント
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装する
// （テーブルは Markdown 書き出しでそのまま残る）。どのテーブルがこのふるまいを
// 持つかは tableMeta（列の datetime-auto）が持つ。
//
// 「同じ対象を、時刻付きで、同じ項目で繰り返し測る」ための表。
// 頭痛ダイアリー・植物の生育記録・実験の経時観察などを 1 つの形で扱う。

export {
  applyLogTableTimestamps,
  primeLogTableRowTracking,
  logTableColumnOptions,
  forgetLogTableTracking,
} from "./auto-timestamp";
