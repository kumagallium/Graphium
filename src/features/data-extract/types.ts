// 表の取り出し（絞り込み）の型
//
// 取り出しは「表示のたびに絞る」のではなく、絞った結果を新しい小さな素材（CSV）として
// 書き出す。ここにあるのは、その条件の指定と、来歴として残す形。

export type ExtractOperator = "eq" | "ne" | "contains" | "gt" | "ge" | "lt" | "le" | "notEmpty";

/** 1 つの条件。value が空（notEmpty 以外）の条件は「書きかけ」として無視される */
export type ExtractCondition = { column: string; op: ExtractOperator; value?: string };

/** 取り出しの指定。conditions はすべて満たす（AND）。columns が空なら全列 */
export type ExtractSpec = { columns: string[]; conditions: ExtractCondition[] };

export type ColumnKind = "number" | "text";

/** distinct は種類が少ない列だけ（多い順に最大 50） */
export type ColumnProfile = { name: string; kind: ColumnKind; distinct?: string[] };

export type ExtractResult = { headers: string[]; rows: string[][]; sourceRows: number };

/** 来歴として残す形（次の段で素材とノートに保存する） */
export type TableDerivation = {
  kind: "filter";
  fromFileId?: string;
  fromFileName: string;
  columns: string[];
  conditions: ExtractCondition[];
  sourceRows: number;
  resultRows: number;
  createdAt: string;
};
