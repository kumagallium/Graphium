// 表の取り出し（絞り込み）の型
//
// 取り出しは「表示のたびに絞る」のではなく、絞った結果を新しい小さな素材（CSV）として
// 書き出す。ここにあるのは、その条件の指定と、来歴として残す形。

import type { ExtractCondition } from "../../lib/document-types";

// 条件と来歴は、保存される形（TableSource）の一部なので定義は document-types.ts にある
export type { ExtractCondition, ExtractOperator, TableDerivation } from "../../lib/document-types";

/** 取り出しの指定。conditions はすべて満たす（AND）。columns が空なら全列 */
export type ExtractSpec = { columns: string[]; conditions: ExtractCondition[] };

export type ColumnKind = "number" | "text";

/** distinct は種類が少ない列だけ（多い順に最大 50） */
export type ColumnProfile = { name: string; kind: ColumnKind; distinct?: string[] };

export type ExtractResult = { headers: string[]; rows: string[][]; sourceRows: number };
