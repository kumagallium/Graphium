// データ取り込みダイアログ
//
// 装置の .txt / .dat / .csv を表にするときの設定画面。開いた時点で
// detectImportOptions の推定が入っているので、通常は中身を確認して「取り込む」を
// 押すだけで済む。設定を全部見せるのは「調整」を開いたときだけ（段階的開示）。
//
// 左にファイルの生プレビュー（行番号つき・取り込む範囲をハイライト）、右に変換結果。
// 生データと変換結果を並べるのは、範囲や区切りを直したときに何が変わったかを
// 目で確かめられるようにするため。

import { useEffect, useMemo, useState } from "react";
import { t, useLocaleSubscription } from "../../i18n";
import { detectImportOptions } from "./detect";
import { extractHeaderMeta } from "./header-meta";
import { parseDelimited, splitLines } from "./parse";
import type { DelimitedImportOptions, DelimiterKind, ParsedDelimited } from "./types";

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
  parsed: ParsedDelimited;
};

export function DataImportModal({
  fileName,
  text,
  initialOptions,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  /** ファイルの中身（デコード済み） */
  text: string;
  /** 再取り込み時に前回の設定を渡す。未指定なら自動推定から始める */
  initialOptions?: DelimitedImportOptions;
  onCancel: () => void;
  onConfirm: (result: DataImportResult) => void;
}) {
  useLocaleSubscription();
  const lines = useMemo(() => splitLines(text), [text]);
  // 推定 → 上限で丸める、を初期値だけに適用する。再取り込み（initialOptions あり）は
  // 前回の設定が正なので触らない
  const detected = useMemo(
    () => (initialOptions ? null : detectImportOptions(lines)),
    [lines, initialOptions]
  );
  const [options, setOptions] = useState<DelimitedImportOptions>(() => {
    if (initialOptions) return initialOptions;
    const d = detected!;
    const limited = Math.min(d.endRow, d.headerRow + DEFAULT_ROW_LIMIT);
    return { ...d, endRow: limited };
  });
  // 丸めが起きたときだけ、元が何行あったかを覚えておいて画面に出す
  const [truncatedTotal] = useState<number | null>(() => {
    if (!detected) return null;
    const total = detected.endRow - detected.headerRow;
    return total > DEFAULT_ROW_LIMIT ? total : null;
  });

  // Esc で閉じる（他のモーダルと同じ作法）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const parsed = useMemo(() => parseDelimited(text, options), [text, options]);
  const meta = useMemo(() => extractHeaderMeta(parsed.headerLines), [parsed.headerLines]);
  const canImport = parsed.headers.length > 0;

  const patch = (next: Partial<DelimitedImportOptions>) =>
    setOptions((cur) => ({ ...cur, ...next }));

  /** 行番号入力。1 以上・総行数以下に丸める */
  const clampRow = (value: number) => Math.min(Math.max(1, value), Math.max(1, lines.length));

  const previewLines = lines.slice(0, PREVIEW_LINE_LIMIT);
  const previewRows = parsed.rows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[900px] max-w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t("dataImport.title")}</h2>
          <span className="text-[11px] text-muted-foreground truncate">{fileName}</span>
          <button
            onClick={onCancel}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* 推定の結果。設定はこの下に出しっぱなしにする */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30">
          <span className="text-xs text-foreground">
            {canImport
              ? t("dataImport.summary", {
                  headerRow: String(options.headerRow),
                  rows: String(parsed.rows.length),
                  columns: String(parsed.headers.length),
                  delimiter: t(`dataImport.delimiter.${options.delimiter}`),
                })
              : t("dataImport.summaryEmpty")}
          </span>
        </div>

        {/* 見出しより列の多い行がある = 値の中に区切り文字が入っている可能性。
            データは切らずに出しているので、気づいて区切りを直せるようにする */}
        {canImport && parsed.headers[parsed.headers.length - 1] === "" && (
          <div className="px-4 py-2 border-b border-border bg-amber-500/10">
            <p className="text-[11px] text-foreground">{t("dataImport.columnMismatch")}</p>
          </div>
        )}

        {/* 行数が多いときの注意。丸めた場合はその旨、伸ばした場合は重さの警告 */}
        {(truncatedTotal !== null || parsed.rows.length > DEFAULT_ROW_LIMIT) && (
          <div className="px-4 py-2 border-b border-border bg-amber-500/10">
            <p className="text-[11px] text-foreground">
              {parsed.rows.length > DEFAULT_ROW_LIMIT
                ? t("dataImport.rowLimitWarning", { count: String(parsed.rows.length) })
                : t("dataImport.rowLimitNotice", {
                    limit: String(DEFAULT_ROW_LIMIT),
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
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-0 divide-x divide-border">
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

          <section className="flex flex-col min-h-0">
            <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-b border-border">
              {t("dataImport.tablePreview")}
            </div>
            <div className="flex-1 overflow-auto p-3">
              {canImport ? (
                <table className="text-[11px] border-collapse">
                  <thead>
                    <tr>
                      {parsed.headers.map((h, i) => (
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
              ) : (
                <p className="text-[11px] text-muted-foreground">{t("dataImport.noTable")}</p>
              )}
              {parsed.rows.length > PREVIEW_ROW_LIMIT && (
                <p className="mt-2 text-[11px] text-muted-foreground opacity-70">
                  {t("dataImport.moreRows", {
                    count: String(parsed.rows.length - PREVIEW_ROW_LIMIT),
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
              {t("dataImport.headerMeta")}
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

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => onConfirm({ options, parsed })}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("dataImport.confirm")}
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
