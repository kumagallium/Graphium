// カスタムブロックの登録エントリー
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CustomBlockEntry = {
  type: string;
  spec: any; // BlockNote の BlockSpec 型はジェネリクスが複雑なため any で受ける
};
