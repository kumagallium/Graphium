// データ取り込みダイアログ
//
// 装置の .txt / .dat / .csv を表にするときの設定画面。開いた時点で
// detectImportOptions の推定が入っているので、通常は中身を確認して「取り込む」を
// 押すだけで済む。設定を全部見せるのは「調整」を開いたときだけ（段階的開示）。
//
// 左にファイルの生プレビュー（行番号つき・取り込む範囲をハイライト）、右に変換結果。
// 生データと変換結果を並べるのは、範囲や区切りを直したときに何が変わったかを
// 目で確かめられるようにするため。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useEffect, useMemo, useState } from "react";
import { t, useLocaleSubscription } from "../../i18n";
import { detectImportOptions } from "./detect";
import { extractHeaderMeta } from "./header-meta";
import {
  DETECT_SAMPLE_LINES,
  PREVIEW_SAMPLE_ROWS,
  SYNC_PARSE_MAX_ROWS,
} from "./large-file";
import {
  countDataRows,
  parseDelimitedLines,
  parseDelimitedLinesAsync,
  parseDelimitedSample,
  splitLines,
} from "./parse";
import { applyExtract, isActiveCondition } from "../data-extract/apply";
import { ExtractSection } from "../data-extract/components/ExtractSection";
import { ExtractSummary } from "../data-extract/components/ExtractSummary";
import { describeSpec } from "../data-extract/describe";
import { profileColumns, profileColumnsAsync } from "../data-extract/profile";
import type { ColumnProfile, ExtractCondition, ExtractSpec } from "../data-extract/types";
import { DOC_TABLE_DEFAULT_MAX_ROWS, DOC_TABLE_HARD_MAX_ROWS, defaultImportTarget } from "./target";
import type { DelimitedImportOptions, DelimiterKind, ImportTarget, ParsedDelimited } from "./types";

/** プレビューで描く生テキストの最大行数（巨大ファイルで DOM を作りすぎない） */
const PREVIEW_LINE_LIMIT = 300;
/** 変換プレビューで描くデータ行の最大数 */
const PREVIEW_ROW_LIMIT = 50;
/**
 * 既定で取り込むデータ行数の上限。
 *
 * パース自体は数万行でも一瞬だが、その行数のテーブルをエディタに挿入すると
 * 固まる。数十万行のログを取り違えて落としたときに黙って固まらないよう、
 * 初期値だけ安全側に丸める。丸めたことは画面に出し、終了行を伸ばせば
 * 全部取り込める — データを黙って捨てはしない。
 */
const DEFAULT_ROW_LIMIT = 2000;

export type DataImportResult = {
  options: DelimitedImportOptions;
  /**
   * 変換結果。rowsComplete が false のとき rows は先頭の標本（PREVIEW_SAMPLE_ROWS 行）
   * だけで、全行ではない。headers / headerLines / footerLines は全体の変換と同じ。
   * 全行が要る使い方をするなら rowsComplete を確かめること
   */
  parsed: ParsedDelimited;
  /**
   * 範囲内のデータ行の総数（parsed.rows が標本のときも全体の数）。
   * 絞り込みが入っているときも、parsed / rowCount は絞り込む前のまま。
   * 絞った後の中身は extract.result を見ること
   */
  rowCount: number;
  /** parsed.rows が全行か。大きなファイル（SYNC_PARSE_MAX_ROWS 超）では false */
  rowsComplete: boolean;
  /** 行き先（文書の表 / データ表）。ブロックを作るのはホスト側 */
  target: ImportTarget;
  /**
   * 絞り込みが入っているときだけ付く（無ければ項目ごと無い）。
   * result は絞った後の全行（大きなファイルでも標本ではない）、sourceRows は絞る前の行数。
   * spec.columns が空なら全列、conditions は効いている条件だけ（書きかけは除く）
   */
  extract?: {
    spec: ExtractSpec;
    result: { headers: string[]; rows: string[][] };
    sourceRows: number;
    /** 元の列の数（全列のままかを来歴で判定するため） */
    sourceColumns: number;
  };
};

export function DataImportModal({
  fileName,
  text,
  initialOptions,
  rowLimit = DEFAULT_ROW_LIMIT,
  confirmLabel,
  headerMetaLabel,
  showTargetChoice = true,
  initialTarget,
  initialExtract: initialExtractProp,
  showExtract = true,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  /** ファイルの中身（デコード済み） */
  text: string;
  /** 再取り込み時に前回の設定を渡す。未指定なら自動推定から始める */
  initialOptions?: DelimitedImportOptions;
  /**
   * 既定で取り込むデータ行数の上限。null で無制限。
   * 上限はエディタに表を挿入する重さを守るためのものなので、表を作らない行き先
   * （チャートが素材から直接読む）では外す — スペクトルを 2000 行で切ると
   * パターンの後半が黙って消える
   */
  rowLimit?: number | null;
  /** 確定ボタンの文言。未指定は「取り込む」 */
  confirmLabel?: string;
  /**
   * 前置きから読み取った条件の見出し。未指定は「表と一緒に来歴へ残ります」。
   * 表を作らない行き先では条件はどこにも写されない（素材の本文に残るだけ）ので、
   * 約束しない文言に差し替える
   */
  headerMetaLabel?: string;
  /**
   * 「挿入形式」（文書の表 / データ表）を出すか。表を作らない行き先（チャートが素材から
   * 直接読む）では意味が無いので隠す。隠したときの result.target は "table"
   */
  showTargetChoice?: boolean;
  /** 挿入形式の初期値。未指定なら行数から決める（多ければデータ表） */
  initialTarget?: ImportTarget;
  /**
   * 再び開くときに前回の絞り込みを渡す。渡されたら「絞り込む」の段を開いた状態で、
   * その条件と列を復元する
   */
  initialExtract?: ExtractSpec;
  /**
   * 「絞り込む」の段を出すか（既定 true）。表を作らない行き先（チャートが素材から直接読む）
   * では、絞った結果を書き出す先が無いので段ごと出さない。false のとき initialExtract も無視する
   */
  showExtract?: boolean;
  onCancel: () => void;
  onConfirm: (result: DataImportResult) => void;
}) {
  useLocaleSubscription();
  const initialExtract = showExtract ? initialExtractProp : undefined;
  const lines = useMemo(() => splitLines(text), [text]);
  // 推定 → 上限で丸める、を初期値だけに適用する。再取り込み（initialOptions あり）は
  // 前回の設定が正なので触らない
  const detected = useMemo(
    () => (initialOptions ? null : detectImportOptions(lines)),
    [lines, initialOptions]
  );
  // 挿入形式の初期値。行数は上限で丸める前の推定値で見る（丸めた後の行数で決めると
  // 「2,000 行に丸めたから文書の表でよい」と逆の判断になる）
  const detectedRowCount = detected
    ? Math.max(0, detected.endRow - detected.headerRow)
    : initialOptions
      ? Math.max(0, initialOptions.endRow - initialOptions.headerRow)
      : 0;
  const initialTargetValue: ImportTarget =
    initialTarget ?? (showTargetChoice ? defaultImportTarget(detectedRowCount) : "table");
  const [target, setTarget] = useState<ImportTarget>(initialTargetValue);
  const [options, setOptions] = useState<DelimitedImportOptions>(() => {
    if (initialOptions) return initialOptions;
    const d = detected!;
    // データ表は本文に表を作らないので、行数の上限で丸めない
    if (rowLimit === null || initialTargetValue === "dataTable") return d;
    const limited = Math.min(d.endRow, d.headerRow + rowLimit);
    return { ...d, endRow: limited };
  });
  // 丸めが起きたときだけ、元が何行あったかを覚えておいて画面に出す
  const [truncatedTotal] = useState<number | null>(() => {
    if (!detected || rowLimit === null || initialTargetValue === "dataTable") return null;
    const total = detected.endRow - detected.headerRow;
    return total > rowLimit ? total : null;
  });

  // Esc で閉じる（他のモーダルと同じ作法）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // 行数は割らずに数える。大きなファイルは全行をセルに割ると固まる（23 万行で 5 秒）ので、
  // 上限を超えたら先頭の標本だけ変換する。行を割り直さないよう、lines を使い回す
  const rowCount = useMemo(() => countDataRows(lines, options), [lines, options]);
  const isLarge = rowCount > SYNC_PARSE_MAX_ROWS;
  const parsed = useMemo(
    () =>
      isLarge
        ? parseDelimitedSample(lines, options, PREVIEW_SAMPLE_ROWS)
        : parseDelimitedLines(lines, options),
    [lines, options, isLarge]
  );
  const meta = useMemo(() => extractHeaderMeta(parsed.headerLines), [parsed.headerLines]);
  const canImport = parsed.headers.length > 0;

  // ── 絞り込み ──
  // 段を開いていない・条件も列の選択も無いときは、ここから先は何も計算せず
  // 今までと同じ値（parsed / rowCount）をそのまま使う
  const [extractOpen, setExtractOpen] = useState(() => initialExtract !== undefined);
  // null は全列。「なし」は空配列（0 列）として持ち、全列扱いにしない
  const [extractColumns, setExtractColumns] = useState<string[] | null>(() =>
    initialExtract && initialExtract.columns.length > 0 ? initialExtract.columns : null
  );
  const [extractConditions, setExtractConditions] = useState<ExtractCondition[]>(
    () => initialExtract?.conditions ?? []
  );
  // 書きかけでない条件。列が実在するかは、表を読んでから（下の activeConditions）で絞る
  const writtenConditions = useMemo(
    () => extractConditions.filter(isActiveCondition),
    [extractConditions]
  );
  // 表を読む前の「何か指定がある」判定。読み終わるまでは列の実在を確かめられない
  const hasRawSpec = writtenConditions.length > 0 || extractColumns !== null;
  // 畳んでも条件や列の選択が残っているあいだは絞り込みを効かせる（畳んだ途端に
  // 黙って全部取り込む形に戻らないように）。表が要るのはそのあいだと開いているあいだ
  const needExtractTable = extractOpen || hasRawSpec;

  // 大きなファイルは、段を開いたとき（か条件が入っているとき）にだけ全行を読む。
  // 先頭の標本では、絞った結果の行数も列の種類も当たらないため
  const [fullTable, setFullTable] = useState<{
    lines: string[];
    options: DelimitedImportOptions;
    headers: string[];
    rows: string[][];
    profiles: ColumnProfile[];
  } | null>(null);
  // 全体を読むのに失敗した設定（失敗のまま「読んでいます」で止まらないように）
  const [fullFailed, setFullFailed] = useState<{ lines: string[]; options: DelimitedImportOptions } | null>(
    null
  );
  useEffect(() => {
    if (!needExtractTable || !isLarge) {
      setFullTable((cur) => (cur === null ? cur : null));
      return;
    }
    let cancelled = false;
    // 設定を変えた・段を閉じた・ダイアログを閉じたら、前の読み込みは途中で止める
    // （cleanup で cancelled が立ち、譲るたびに見て抜ける）
    const shouldStop = () => cancelled;
    void (async () => {
      try {
        const full = await parseDelimitedLinesAsync(lines, options, { shouldStop });
        if (!full || cancelled) return;
        const profiles = await profileColumnsAsync(full.headers, full.rows, { shouldStop });
        if (!profiles || cancelled) return;
        setFullTable({ lines, options, headers: full.headers, rows: full.rows, profiles });
      } catch {
        if (!cancelled) setFullFailed({ lines, options });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needExtractTable, isLarge, lines, options]);
  const extractError = isLarge && fullFailed !== null && fullFailed.lines === lines && fullFailed.options === options;

  const extractTable = useMemo(() => {
    if (!needExtractTable || !canImport) return null;
    if (isLarge) {
      // 設定を変えた直後は、古い設定で読んだ結果を使わない
      return fullTable && fullTable.lines === lines && fullTable.options === options
        ? fullTable
        : null;
    }
    return {
      headers: parsed.headers,
      rows: parsed.rows,
      profiles: profileColumns(parsed.headers, parsed.rows),
    };
  }, [needExtractTable, canImport, isLarge, fullTable, lines, options, parsed]);
  const extractLoading = needExtractTable && canImport && extractTable === null && !extractError;

  const extractProfiles = extractTable?.profiles ?? [];
  const extractAllNames = extractProfiles.map((p) => p.name);
  // 見出しに無い列を指す条件は「効いていない」。有無の判定・確定の spec・条件の文から外す
  // （読み終わるまでは実在を確かめられないのでそのまま）
  const activeConditions = useMemo(
    () =>
      extractTable
        ? writtenConditions.filter((c) => extractAllNames.includes(c.column.trim()))
        : writtenConditions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writtenConditions, extractTable]
  );
  // 選んだ列。見出しに無い名前は外す。残りが無ければ全列、見出し全部（名前があり重複しない
  // 見出しの集合）と一致しても全列として扱う。空の配列は「0 列を選んだ」ので全列にしない
  const effectiveColumns = useMemo(() => {
    if (extractColumns === null || extractColumns.length === 0 || !extractTable) return extractColumns;
    const known = [...new Set(extractColumns)].filter((n) => extractAllNames.includes(n));
    if (known.length === 0 || known.length === extractAllNames.length) return null;
    return known;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractColumns, extractTable]);
  const hasExtractSpec = activeConditions.length > 0 || effectiveColumns !== null;
  const chosenColumns = effectiveColumns === null ? extractAllNames : effectiveColumns;
  const noColumns = effectiveColumns !== null && chosenColumns.length === 0;

  const extractView = useMemo(() => {
    if (!extractTable || !hasExtractSpec) return null;
    const picked = effectiveColumns === null ? [] : chosenColumns;
    const r = applyExtract(
      extractTable.headers,
      extractTable.rows,
      { columns: picked, conditions: activeConditions },
      extractTable.profiles
    );
    // 0 列は「全列」と区別する。行の数だけ残し、中身は持たない
    if (effectiveColumns !== null && picked.length === 0) {
      return { headers: [] as string[], rows: [] as string[][], rowCount: r.rows.length, sourceRows: r.sourceRows, sourceColumns: extractTable.headers.length };
    }
    return { headers: r.headers, rows: r.rows, rowCount: r.rows.length, sourceRows: r.sourceRows, sourceColumns: extractTable.headers.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractTable, hasExtractSpec, effectiveColumns, activeConditions]);

  // 行数の判定・要約・プレビューは、絞った後の表で行う（絞れば文書の表にもできる）
  const effectiveRowCount = extractView ? extractView.rowCount : rowCount;
  const shownHeaders = extractView ? extractView.headers : parsed.headers;
  const shownRows = extractView ? extractView.rows : parsed.rows;
  // 絞った結果が 0 列・0 行、または全体を読んでいる最中は確定できない
  // 段を開いただけ（列・条件が未指定）なら、読んでいる間も確定を止めない（全体を取り込む形のまま）
  const extractBlocked =
    needExtractTable &&
    canImport &&
    (((extractLoading || extractError) && hasRawSpec) ||
      (extractView !== null && (extractView.headers.length === 0 || extractView.rowCount === 0)));

  const collapsedSummary = !hasExtractSpec
    ? null
    : extractView
      ? t("dataExtract.describe.withRows", {
          spec: noColumns
            ? t("dataExtract.zeroColumns")
            : describeSpec(
                { columns: effectiveColumns === null ? [] : chosenColumns, conditions: activeConditions },
                t
              ),
          rows: extractView.rowCount.toLocaleString(),
          total: extractView.sourceRows.toLocaleString(),
        })
      : extractError
        ? t("dataImport.readError")
        : t("dataExtract.loading");

  // データ表は本文に表を作らないので行数の上限は要らない
  const effectiveRowLimit = target === "dataTable" ? null : rowLimit;
  // 文書の表にすると固まる量は入口で止める（データ表なら制限なし）。
  // 挿入形式を選べない画面（チャートが素材から直接読む）は内部の target が "table" だが
  // 表を作らないので、上限は掛けない
  const overHardLimit =
    showTargetChoice && target === "table" && effectiveRowCount > DOC_TABLE_HARD_MAX_ROWS;
  const switchTarget = (next: ImportTarget) => {
    setTarget(next);
    // 文書の表向けに丸めていた終了行は、データ表なら全部読める
    if (next === "dataTable" && detected && truncatedTotal !== null && options.endRow < detected.endRow) {
      setOptions((cur) => ({ ...cur, endRow: detected.endRow }));
    }
  };

  const patch = (next: Partial<DelimitedImportOptions>) =>
    setOptions((cur) => ({ ...cur, ...next }));

  /** 行番号入力。1 以上・総行数以下に丸める */
  const clampRow = (value: number) => Math.min(Math.max(1, value), Math.max(1, lines.length));

  const previewLines = lines.slice(0, PREVIEW_LINE_LIMIT);
  const previewRows = shownRows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40 p-4`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[900px] max-w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">{t("dataImport.title")}</h2>
          <span className="text-[11px] text-muted-foreground truncate">{fileName}</span>
          <button
            onClick={onCancel}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* ヘッダーとフッターの間。短いウィンドウでは、ここがスクロールする
            （変換プレビューを潰さずに、フッターのボタンは常に見せる） */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* 推定の結果。設定はこの下に出しっぱなしにする */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30">
          <span className="text-xs text-foreground">
            {canImport
              ? t("dataImport.summary", {
                  headerRow: String(options.headerRow),
                  rows: String(rowCount),
                  columns: String(parsed.headers.length),
                  delimiter: t(`dataImport.delimiter.${options.delimiter}`),
                })
              : t("dataImport.summaryEmpty")}
          </span>
        </div>

        {/* 大きなファイルは設定を先頭の標本から推定し、プレビューも先頭だけ。警告ではないので地味に出す */}
        {/* 絞り込んだ結果は全行から作った表なので、標本の注意は出さない */}
        {isLarge && !extractView && (
          <div className="px-4 py-2 border-b border-border bg-muted/30">
            <p className="text-[11px] text-muted-foreground">
              {/* 再取り込みは前回の設定を使うので「推定した」とは言わない */}
              {initialOptions
                ? t("dataImport.sampledPreviewNotice")
                : t("dataImport.sampledNotice", { lines: String(DETECT_SAMPLE_LINES) })}
            </p>
          </div>
        )}

        {/* 挿入形式。行が多いデータは本文の表に展開せず、素材を参照するデータ表にする */}
        {showTargetChoice && canImport && (
          <div className="px-4 py-2 border-b border-border flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium text-foreground">{t("dataImport.target")}</span>
            <div className="flex items-center gap-1.5">
              {(["table", "dataTable"] as ImportTarget[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => switchTarget(kind)}
                  className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                    target === kind
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t(`dataImport.target.${kind}`)}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {target === "dataTable"
                ? t("dataImport.target.dataTableHint")
                : t("dataImport.target.tableHint")}
            </span>
          </div>
        )}
        {overHardLimit && (
          <div className="px-4 py-2 border-b border-border bg-destructive/10">
            <p className="text-[11px] text-foreground">
              {t("dataImport.target.tableTooLarge", {
                limit: String(DOC_TABLE_HARD_MAX_ROWS),
                count: String(effectiveRowCount),
              })}
            </p>
          </div>
        )}
        {!overHardLimit && showTargetChoice && canImport && target === "table" && effectiveRowCount > DOC_TABLE_DEFAULT_MAX_ROWS && (
          <div className="px-4 py-2 border-b border-border bg-amber-500/10">
            <p className="text-[11px] text-foreground">
              {t("dataImport.target.recommendedDataTable", { count: String(effectiveRowCount) })}
            </p>
          </div>
        )}

        {/* 見出しより列の多い行がある = 値の中に区切り文字が入っている可能性。
            データは切らずに出しているので、気づいて区切りを直せるようにする */}
        {canImport && parsed.headers[parsed.headers.length - 1] === "" && (
          <div className="px-4 py-2 border-b border-border bg-amber-500/10">
            <p className="text-[11px] text-foreground">{t("dataImport.columnMismatch")}</p>
          </div>
        )}

        {/* 行数が多いときの注意。丸めた場合はその旨、伸ばした場合は重さの警告。
            上限を外した行き先（チャート）ではどちらも出ない */}
        {effectiveRowLimit !== null &&
          (truncatedTotal !== null || effectiveRowCount > effectiveRowLimit) && (
            <div className="px-4 py-2 border-b border-border bg-amber-500/10">
              <p className="text-[11px] text-foreground">
                {effectiveRowCount > effectiveRowLimit
                  ? t("dataImport.rowLimitWarning", { count: String(effectiveRowCount) })
                  : t("dataImport.rowLimitNotice", {
                      limit: String(effectiveRowLimit),
                      total: String(truncatedTotal),
                    })}
              </p>
            </div>
          )}

        {/* 設定。畳んでも高さが 1 行分しか変わらないうえ、開くボタンに気づかれない
            ほうが痛いので、常に出しておく（推定が当たっていれば触らずに済む） */}
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-start gap-6">
            <div>
              <div className="text-[11px] font-medium text-foreground mb-1.5">
                {t("dataImport.rowRange")}
              </div>
              <div className="flex items-center gap-3">
                <RowInput
                  label={t("dataImport.headerRow")}
                  value={options.headerRow}
                  onChange={(v) => patch({ headerRow: clampRow(v) })}
                />
                <RowInput
                  label={t("dataImport.endRow")}
                  value={options.endRow}
                  onChange={(v) => patch({ endRow: clampRow(v) })}
                />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-foreground mb-1.5">
                {t("dataImport.delimiterLabel")}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["comma", "tab", "space", "custom"] as DelimiterKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => patch({ delimiter: kind })}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      options.delimiter === kind
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t(`dataImport.delimiter.${kind}`)}
                  </button>
                ))}
                {options.delimiter === "custom" && (
                  <input
                    type="text"
                    maxLength={1}
                    value={options.customDelimiter ?? ""}
                    onChange={(e) => patch({ customDelimiter: e.target.value })}
                    placeholder={t("dataImport.customDelimiterPlaceholder")}
                    className="w-14 text-[11px] px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary"
                  />
                )}
              </div>
              <label className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.collapseConsecutive}
                  onChange={(e) => patch({ collapseConsecutive: e.target.checked })}
                />
                {t("dataImport.collapseConsecutive")}
              </label>
            </div>
        </div>

        {/* プレビュー（左: 生テキスト / 右: 変換結果） */}
        {/* 下限は、右の列が「段の見出し + 変換プレビューの見出し + 表 2 行」を入れられる高さ。
            それより短いウィンドウでだけ、外側（ヘッダーとフッターの間）がスクロールする */}
        <div className="flex-1 min-h-[12rem] grid grid-cols-2 grid-rows-[minmax(0,1fr)] gap-0 divide-x divide-border">
          <section className="flex flex-col min-h-0">
            <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-b border-border">
              {t("dataImport.filePreview")}
            </div>
            <div className="flex-1 overflow-auto font-mono text-[11px]">
              {previewLines.map((line, i) => {
                const row = i + 1;
                const isHeader = row === options.headerRow;
                const inRange = row > options.headerRow && row <= options.endRow;
                return (
                  <div
                    key={row}
                    className={`flex gap-2 px-2 whitespace-pre ${
                      isHeader
                        ? "bg-primary/15 text-foreground"
                        : inRange
                          ? "bg-primary/5 text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="w-8 text-right shrink-0 select-none opacity-60">{row}</span>
                    <span className="truncate">{line}</span>
                  </div>
                );
              })}
              {lines.length > PREVIEW_LINE_LIMIT && (
                <div className="px-2 py-1 text-muted-foreground opacity-70">
                  {t("dataImport.truncated", {
                    count: String(lines.length - PREVIEW_LINE_LIMIT),
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col min-h-0 overflow-hidden">
            {/* 絞り込み。変換プレビューの上（右の列の中）。畳んだ状態が既定で、絞らなければ今までと変わらない */}
            {canImport && showExtract && (
              <ExtractSection
                open={extractOpen}
                onToggle={() => setExtractOpen((v) => !v)}
                collapsedSummary={collapsedSummary}
                loading={extractLoading}
                error={extractError}
                columns={extractProfiles}
                selectedColumns={chosenColumns}
                onColumnsChange={(next) =>
                  // 全部選んだら「全列」に戻す（元と同じ内容として扱う）。空は「なし」として残す
                  setExtractColumns(next.length === extractAllNames.length ? null : next)
                }
                conditions={extractConditions}
                onConditionsChange={setExtractConditions}
              />
            )}
            <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-b border-border shrink-0 flex flex-wrap items-baseline gap-x-3">
              <span>{t("dataImport.tablePreview")}</span>
              {/* 絞り込みが入っているときだけ、絞った後の行数を見出しの右に常に出す */}
              {extractView && (
                <span className="ml-auto text-right">
                  <ExtractSummary
                    inline
                    sourceRows={extractView.sourceRows}
                    resultRows={extractView.rowCount}
                    columnCount={extractView.headers.length}
                    sameAsSource={false}
                  />
                </span>
              )}
            </div>
            <div className="flex-1 min-h-[7rem] overflow-auto p-3">
              {canImport && shownHeaders.length > 0 ? (
                <table className="text-[11px] border-collapse">
                  <thead>
                    <tr>
                      {shownHeaders.map((h, i) => (
                        <th
                          key={i}
                          className="border border-border px-2 py-1 text-left font-medium text-foreground bg-muted/50 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="border border-border px-2 py-1 text-foreground whitespace-nowrap"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : canImport ? null : (
                // 絞り込みで 0 列にしたときは、理由を段の要約が出しているのでここは空にする
                <p className="text-[11px] text-muted-foreground">{t("dataImport.noTable")}</p>
              )}
              {effectiveRowCount > PREVIEW_ROW_LIMIT && (
                <p className="mt-2 text-[11px] text-muted-foreground opacity-70">
                  {t("dataImport.moreRows", {
                    count: String(effectiveRowCount - PREVIEW_ROW_LIMIT),
                  })}
                </p>
              )}
            </div>
          </section>
        </div>

        {/* 前置きから拾った測定条件。表と一緒に来歴へ残る */}
        {meta.length > 0 && (
          <div className="px-4 py-2 border-t border-border">
            <div className="text-[11px] text-muted-foreground mb-1">
              {headerMetaLabel ?? t("dataImport.headerMeta")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {meta.map((entry, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground"
                >
                  <span className="text-foreground">{entry.key}</span>: {entry.value}
                </span>
              ))}
            </div>
          </div>
        )}

        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canImport || overHardLimit || extractBlocked}
            onClick={() =>
              onConfirm({
                options,
                parsed,
                rowCount,
                rowsComplete: !isLarge,
                target,
                // 絞り込みが入っているときだけ付ける（無ければ項目ごと無い）
                ...(extractView
                  ? {
                      extract: {
                        spec: {
                          columns: effectiveColumns === null ? [] : chosenColumns,
                          conditions: activeConditions,
                        },
                        result: { headers: extractView.headers, rows: extractView.rows },
                        sourceRows: extractView.sourceRows,
                        sourceColumns: extractView.sourceColumns,
                      },
                    }
                  : {}),
              })
            }
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {confirmLabel ?? t("dataImport.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 行番号の入力欄（− / 数値 / ＋） */
function RowInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.round(n));
          }}
          className="w-16 text-[11px] px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          className="w-6 h-6 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-6 h-6 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          ＋
        </button>
      </span>
    </label>
  );
}
