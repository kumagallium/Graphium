// 絞り込んだ結果を「新しい小さな素材（素の CSV）」として書き出し、その素材を読む表の出所を組む。
//
// 絞った結果をノートの中に直接持たず素材にするのは、データ表が素材を正として描く作りに
// 合わせるため。元の素材はそのまま残し、どう絞ったか（来歴）は表の出所（TableSource.derivation）
// に持つ。ここは note-app.tsx から切り出した純関数と、依存を引数で受ける登録処理
// （単体で試せるように）。

import type { TableSource } from "../../lib/document-types";
import type { ExtractCondition, ExtractSpec, TableDerivation } from "./types";
import { rowsToCsv } from "../table-meta/table-to-csv";

/** 派生ファイル名の末尾に付ける印 */
const SUFFIX = "-filtered";

/**
 * 元の名前から写しの名前を作る（`oven-curves.csv` → `oven-curves-filtered.csv`）。
 * 拡張子は最後の 1 つだけ外す（`a.b.csv` → `a.b-filtered.csv`）。すでに `-filtered` が
 * 付いた名前（写しを開き直して絞り直した場合）に重ねて付けない
 */
export function derivedFileName(name: string): string {
  const trimmed = name.trim();
  const m = trimmed.match(/^(.*)\.[^./\\]+$/);
  let base = m ? m[1] : trimmed;
  // 拡張子だけの名前（`.csv`）は、外すと空になるので既定名にする
  if (base === "") base = "data";
  while (base.endsWith(SUFFIX) && base.length > SUFFIX.length) base = base.slice(0, -SUFFIX.length);
  return `${base}${SUFFIX}.csv`;
}

/** 絞った結果 → 写しの CSV（本文と File）。ファイル名は元の名前から作る */
export function buildDerivedCsvFile(
  result: { headers: string[]; rows: string[][] },
  fromFileName: string
): { name: string; csv: string; file: File } {
  const name = derivedFileName(fromFileName);
  const csv = rowsToCsv(result.headers, result.rows);
  return { name, csv, file: new File([csv], name, { type: "text/csv" }) };
}

/** 取り込み設定の保存形（余計な項目を持ち込まない） */
function cloneOptions(o: TableSource["options"]): TableSource["options"] {
  const out: TableSource["options"] = {
    headerRow: o.headerRow,
    endRow: o.endRow,
    delimiter: o.delimiter,
    collapseConsecutive: o.collapseConsecutive,
  };
  if (o.customDelimiter) out.customDelimiter = o.customDelimiter;
  return out;
}

export type DerivedExtract = {
  spec: ExtractSpec;
  result: { headers: string[]; rows: string[][] };
  sourceRows: number;
  /** 元の列の数（全列かどうかの判定に来歴へ残す） */
  sourceColumns?: number;
};

/**
 * 写しを読む表の出所。fileName / fileId は写しを指し、元のファイルと条件は derivation が持つ。
 * 写しは見出し 1 行＋全行の素の CSV なので、読み方は固定（カンマ区切り）。
 */
export function buildDerivedSource(params: {
  derivedFileId: string;
  derivedFileName: string;
  fromFileId?: string;
  fromFileName: string;
  fromOptions: TableSource["options"];
  /** 元がリンクした素材のとき、読んだ時点の元ファイルの大きさ・更新日時（変化の検知用） */
  fromLinkedStat?: { size: number; mtimeMs: number };
  extract: DerivedExtract;
  /** 元の前置きから拾った測定条件（写しには前置きが無いので、出所に引き継ぐ） */
  meta?: { key: string; value: string }[];
  /** 時刻。省略時は現在 */
  now?: string;
}): TableSource {
  const { extract } = params;
  const now = params.now ?? new Date().toISOString();
  const derivation: TableDerivation = {
    kind: "filter",
    fromFileName: params.fromFileName,
    fromOptions: cloneOptions(params.fromOptions),
    // 全列のときは結果の見出し全部を入れる（条件の 1 行に「全列」と書かずに済む）
    columns: extract.spec.columns.length > 0 ? [...extract.spec.columns] : [...extract.result.headers],
    conditions: extract.spec.conditions.map((c): ExtractCondition => ({ ...c })),
    sourceRows: extract.sourceRows,
    ...(extract.sourceColumns !== undefined ? { sourceColumns: extract.sourceColumns } : {}),
    resultRows: extract.result.rows.length,
    createdAt: now,
  };
  if (params.fromFileId) derivation.fromFileId = params.fromFileId;
  if (params.fromLinkedStat) {
    derivation.fromSize = params.fromLinkedStat.size;
    derivation.fromMtimeMs = params.fromLinkedStat.mtimeMs;
  }
  const source: TableSource = {
    kind: "delimited-file",
    fileName: params.derivedFileName,
    fileId: params.derivedFileId,
    importedAt: now,
    options: {
      headerRow: 1,
      endRow: extract.result.rows.length + 1,
      delimiter: "comma",
      collapseConsecutive: false,
    },
    derivation,
  };
  if (params.meta && params.meta.length > 0) source.meta = params.meta;
  return source;
}

type UploadFn = (file: File, options?: { derivedFromAssets?: string[] }) => Promise<{ fileId: string }>;

/**
 * 元の素材（無ければ登録）→ 写しの素材を登録 → 表の出所を返す。
 * 登録に失敗したら投げる（呼び出し側が表を挿さずに warn する）。
 * 同じ中身の素材が既にあれば、uploadAsset 側の仕組みが使い回す。
 */
export async function registerDerivedSource(
  deps: { uploadAsset: UploadFn; primeAssetText: (fileId: string, text: string) => void },
  params: {
    // linked があるときの元はリンクした素材（fileId はそのリンクの素材）。元のファイルは登録しない
    file: { fileName: string; fileId?: string; file?: File; linked?: { size: number; mtimeMs: number } };
    fromOptions: TableSource["options"];
    extract: DerivedExtract;
    meta?: { key: string; value: string }[];
  }
): Promise<TableSource> {
  let fromFileId = params.file.fileId;
  if (!fromFileId) {
    // ドロップ・ファイル選択の直後は元がまだ素材ではない。先に登録して写しの派生元にする
    if (!params.file.file) throw new Error("元の素材が無く、登録するファイルも無い");
    ({ fileId: fromFileId } = await deps.uploadAsset(params.file.file));
  }
  const copy = buildDerivedCsvFile(params.extract.result, params.file.fileName);
  const { fileId } = await deps.uploadAsset(copy.file, { derivedFromAssets: [fromFileId] });
  deps.primeAssetText(fileId, copy.csv);
  return buildDerivedSource({
    derivedFileId: fileId,
    derivedFileName: copy.name,
    fromFileId,
    fromFileName: params.file.fileName,
    fromOptions: params.fromOptions,
    fromLinkedStat: params.file.linked,
    extract: params.extract,
    meta: params.meta,
  });
}

/** 開き直しの行き先。元の素材を条件つきで開くための入力（元が読めないときは呼び出し側が写しを開く） */
export type ReimportTarget = {
  fileId: string;
  fileName: string;
  initialOptions?: TableSource["options"];
  initialExtract: ExtractSpec;
};

/** 表の出所から、絞り込みの開き直し先を引く。絞り込みの来歴が無い・元の素材の ID が無いなら null */
export function reimportTargetOf(source: TableSource): ReimportTarget | null {
  const d = source.derivation;
  if (!d || !d.fromFileId) return null;
  return {
    fileId: d.fromFileId,
    fileName: d.fromFileName,
    initialOptions: d.fromOptions ? cloneOptions(d.fromOptions) : undefined,
    initialExtract: { columns: [...d.columns], conditions: d.conditions.map((c) => ({ ...c })) },
  };
}

type ReadOptions = TableSource["options"];

function sameReadOptions(a: ReadOptions, b: ReadOptions): boolean {
  return (
    a.headerRow === b.headerRow &&
    a.endRow === b.endRow &&
    a.delimiter === b.delimiter &&
    (a.customDelimiter ?? "") === (b.customDelimiter ?? "") &&
    a.collapseConsecutive === b.collapseConsecutive
  );
}

/**
 * 元の素材が読めず写しを開き直したとき、確定した表に古い来歴を残すか。
 * 残すのは、読み方が開いたときと同じで、絞り込みも入っていないときだけ（写しをそのまま
 * 読み直しただけ）。読み方を変えた・絞り込みを入れたなら、表と食い違う来歴は捨てる
 */
export function keepDerivationFor(
  kept: TableDerivation | undefined,
  openedOptions: ReadOptions | undefined,
  result: { options: ReadOptions; extract?: unknown }
): TableDerivation | undefined {
  if (!kept || result.extract) return undefined;
  if (!openedOptions || !sameReadOptions(openedOptions, result.options)) return undefined;
  return kept;
}
