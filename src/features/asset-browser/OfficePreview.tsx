// Excel (.xlsx) / PowerPoint (.pptx) 素材の読み取り専用プレビュー
//
// 取り込み（office-import の readXlsx / readPptx）と同じ読み方で中身を見せる。
// Graphium の中で編集はしない — 原本の編集は外のアプリ（Excel / PowerPoint）の役目。
//
// - Excel: シートを切り替えるタブ + 並べ替えつきの表（SortableTable）。
//   1 行目を見出しと決めつけず、Excel と同じ A, B, C… の列名で全行を見せる
// - PowerPoint: スライドごとの文字 + ファイルに入っている画像の一覧。
//   画像はスライドとの対応までは取らない（readPptx が ppt/media を列挙するだけのため）
//
// 表示部品（XlsxSheetsView / PptxSlidesView）は読み込み済みのデータを受け取るだけにして、
// Storybook で単体確認できるようにしている。

import { useEffect, useId, useMemo, useState } from "react";
import { SortableTable } from "../table-meta/expand-modal";
import { useT } from "../../i18n";
import type { XlsxSheet } from "../office-import/xlsx";
import type { PptxSlide } from "../office-import/pptx";

/** 1 シートで描画する行数の上限（巨大なシートで描画を止めない） */
export const XLSX_PREVIEW_MAX_ROWS = 1000;
/** 1 シートで描画する列数の上限 */
export const XLSX_PREVIEW_MAX_COLS = 200;

/** 1 始まりの列番号を Excel の列名（A, B, …, Z, AA, …）にする */
export function columnName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** 表示用に行・列を上限で切り、末尾の空行を落とす */
export function sheetPreviewRows(cells: string[][]): {
  header: string[];
  rows: string[][];
  /** 上限で切る前の行数・列数（末尾の空行は数えない） */
  totalRows: number;
  totalCols: number;
} {
  // 末尾の空行（dimension の範囲だけ広い等）は見せても意味が無いので落とす
  let end = cells.length;
  while (end > 0 && cells[end - 1].every((v) => v === "")) end--;
  const trimmed = cells.slice(0, end);
  const colCount = trimmed.reduce((max, row) => Math.max(max, row.length), 0);
  const shownCols = Math.min(colCount, XLSX_PREVIEW_MAX_COLS);
  const rows = trimmed
    .slice(0, XLSX_PREVIEW_MAX_ROWS)
    .map((row) => Array.from({ length: shownCols }, (_, c) => row[c] ?? ""));
  return {
    header: Array.from({ length: shownCols }, (_, c) => columnName(c + 1)),
    rows,
    totalRows: trimmed.length,
    totalCols: colCount,
  };
}

export function XlsxSheetsView({ sheets }: { sheets: XlsxSheet[] }) {
  const t = useT();
  const idBase = useId();
  const [active, setActive] = useState(0);
  // 別のファイルに切り替わったら最初のシートに戻す
  useEffect(() => setActive(0), [sheets]);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  const preview = useMemo(() => (sheet ? sheetPreviewRows(sheet.cells) : null), [sheet]);

  if (!sheet || !preview) {
    return <div className="text-sm text-muted-foreground p-6 text-center">{t("asset.officePreview.noSheets")}</div>;
  }

  return (
    <div className="flex flex-col gap-2 p-4 min-h-0">
      {sheets.length > 1 && (
        <div
          className="flex gap-1 border-b border-border text-xs overflow-x-auto"
          role="tablist"
          aria-label={t("asset.officePreview.sheetTabs")}
        >
          {sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              id={`${idBase}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`-mb-px border-b-2 px-2.5 py-1 whitespace-nowrap transition-colors ${
                i === active
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {t("tableMeta.expandCount", {
          rows: String(preview.rows.length),
          cols: String(preview.header.length),
        })}
        <span className="ml-3">{t("tableMeta.expandSortHint")}</span>
      </div>
      {(preview.totalRows > preview.rows.length || preview.totalCols > preview.header.length) && (
        <div className="text-[11px] text-muted-foreground">
          {t("asset.officePreview.truncated", {
            rows: String(preview.rows.length),
            totalRows: String(preview.totalRows),
            cols: String(preview.header.length),
            totalCols: String(preview.totalCols),
          })}
        </div>
      )}
      {preview.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground p-6 text-center">{t("asset.officePreview.emptySheet")}</div>
      ) : (
        // max-h でこの div をスクロールコンテナにし、列見出しの sticky を効かせる（DataPreview と同じ）
        <div className="overflow-auto min-h-0 max-h-[70dvh] border border-border rounded">
          <SortableTable header={preview.header} rows={preview.rows} />
        </div>
      )}
    </div>
  );
}

export function PptxSlidesView({ slides, imageUrls }: { slides: PptxSlide[]; imageUrls: string[] }) {
  const t = useT();
  if (slides.length === 0 && imageUrls.length === 0) {
    return <div className="text-sm text-muted-foreground p-6 text-center">{t("asset.officePreview.noSlides")}</div>;
  }
  return (
    <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-3">
      {slides.map((slide) => (
        <section
          key={slide.index}
          className="rounded-lg border border-border bg-card px-4 py-3"
          aria-label={t("asset.officePreview.slide", { n: String(slide.index) })}
        >
          <div className="text-[11px] text-muted-foreground mb-1">
            {t("asset.officePreview.slide", { n: String(slide.index) })}
          </div>
          {slide.text ? (
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{slide.text}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("asset.officePreview.slideNoText")}</p>
          )}
        </section>
      ))}
      {imageUrls.length > 0 && (
        <section className="mt-2">
          <div className="text-[11px] text-muted-foreground mb-2">
            {t("asset.officePreview.images", { count: String(imageUrls.length) })}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {imageUrls.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={t("asset.officePreview.imageAlt", { n: String(i + 1) })}
                className="w-full h-32 object-contain rounded border border-border bg-background"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
