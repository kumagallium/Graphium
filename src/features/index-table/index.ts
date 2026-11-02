// 行からノートを作れるテーブル（旧・インデックステーブル）のエントリーポイント
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装する。
// どのテーブルがこのふるまいを持つかは tableMeta（列の note-link）が持つ。

export { IndexTableIconLayer } from "./icon-layer";
export {
  setIndexTableCallbacks,
  setEditorIndexTableCallbacks,
} from "./context";
