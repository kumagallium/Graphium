// データ素材（区切りテキスト .csv / .txt / .dat）のプレビュー
//
// 素材本体を読み、「表」と「元のテキスト」の 2 つのタブで見せる。
// - 表: 取り込みと同じ推定（detectImportOptions）で表に起こし、並べ替えつきの
//   読み取り専用テーブル（SortableTable）で見せる。前置き（# Device Model: ... のような
//   測定条件）があれば表の上に出す
// - 元のテキスト: ファイルの先頭 RAW_MAX_LINES 行を行番号つきでそのまま見せる。
//   取り込みダイアログの「開始行」「終了行」は行番号で指定するので、ここで番号を確かめられる
// 表に起こせたら表、起こせなかったら元のテキストのタブで開く（「変換できる表がありません」
// だけでは、壊れたファイルなのか読み方の判定を外しただけなのか分からないため）。
// あくまで「素材をその場で眺める」ためのビュー。ノートに表を作るのは
// 従来どおり /データ の取り込みダイアログの役目

import { useEffect, useId, useRef, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { detectImportOptions } from "../data-import/detect";
import { extractHeaderMeta } from "../data-import/header-meta";
import { parseDelimited, splitLines } from "../data-import/parse";
import { readDataFileText } from "../data-import/read-file";
import { SortableTable } from "../table-meta/expand-modal";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";

/** 元のテキストのタブに出す行数の上限（巨大なファイルで描画を止めない） */
export const RAW_MAX_LINES = 500;

type Tab = "table" | "raw";

type ParsedState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      /** 表に起こせなかったら null */
      table: {
        headers: string[];
        rows: string[][];
        meta: { key: string; value: string }[];
      } | null;
      /** 先頭 RAW_MAX_LINES 行（末尾の空行は落とす） */
      rawLines: string[];
      /** ファイル全体の行数 */
      totalLines: number;
    };

export function DataPreview({ entry }: { entry: MediaIndexEntry }) {
  const t = useT();
  const [state, setState] = useState<ParsedState>({ kind: "loading" });
  const [tab, setTab] = useState<Tab>("table");

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        // blob: / data: は既に実体を指している URL（BlobMediaPlayer と同じ扱い）
        let blob: Blob;
        if (/^(blob|data):/i.test(entry.url)) {
          blob = await (await fetch(entry.url)).blob();
        } else {
          const fileId = getActiveProvider().extractFileId(entry.url);
          if (!fileId) throw new Error("no fileId");
          const blobUrl = await getActiveProvider().getMediaBlobUrl(fileId);
          blob = await (await fetch(blobUrl)).blob();
        }
        const text = await readDataFileText(blob);
        const allLines = splitLines(text);
        // 取り込みダイアログと同じ自動判定で読む。ここで読み方を変えたいときは
        // 取り込み（/データ）に進んで設定を調整してもらう
        const options = detectImportOptions(allLines);
        // 元のテキストのタブ用。末尾の改行で生じる空行は行数に数えない
        const lines = allLines.slice();
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
        const parsed = parseDelimited(text, options);
        if (cancelled) return;
        const table =
          parsed.headers.length > 0
            ? { headers: parsed.headers, rows: parsed.rows, meta: extractHeaderMeta(parsed.headerLines) }
            : null;
        setState({
          kind: "ready",
          table,
          rawLines: lines.slice(0, RAW_MAX_LINES),
          totalLines: lines.length,
        });
        setTab(table ? "table" : "raw");
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.url]);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        {t("common.loading")}
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        {t("chart.pickerReadFailed")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 w-full self-stretch">
      <DataPreviewTabs tab={tab} onChange={setTab} />
      {tab === "table" ? (
        state.table ? (
          <TablePanel table={state.table} />
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
            <span>{t("dataImport.noTable")}</span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTab("raw")}>
              {t("assetData.showRaw")}
            </button>
          </div>
        )
      ) : (
        <RawPanel lines={state.rawLines} totalLines={state.totalLines} />
      )}
    </div>
  );
}

function DataPreviewTabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const t = useT();
  const idBase = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const items: Array<[Tab, string]> = [
    ["table", t("assetData.tabTable")],
    ["raw", t("assetData.tabRaw")],
  ];
  // ← → で隣のタブへ（選んだタブにフォーカスも移す）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "table" ? "raw" : "table";
    onChange(next);
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idBase}-${next}`)}`)?.focus(),
    );
  };
  return (
    <div
      ref={listRef}
      className="flex gap-1 border-b border-border text-xs"
      role="tablist"
      aria-label={t("assetData.tabsLabel")}
      onKeyDown={onKeyDown}
    >
      {items.map(([key, label]) => (
        <button
          key={key}
          id={`${idBase}-${key}`}
          type="button"
          role="tab"
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          className={`-mb-px border-b-2 px-2.5 py-1 transition-colors ${
            tab === key
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TablePanel({
  table,
}: {
  table: { headers: string[]; rows: string[][]; meta: { key: string; value: string }[] };
}) {
  const t = useT();
  return (
    <>
      {/* 前置きの測定条件（あれば）。表の出所を添える情報なので控えめに */}
      {table.meta.length > 0 && (
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {table.meta.map((m) => (
            <div key={m.key}>
              {m.key}: {m.value}
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {t("tableMeta.expandCount", {
          rows: String(table.rows.length),
          cols: String(table.headers.length),
        })}
        <span className="ml-3">{t("tableMeta.expandSortHint")}</span>
      </div>
      {/* max-h でこの div を実際のスクロールコンテナにする。無いと親（ピーク全体）が
          スクロールしてしまい、列見出しの sticky が効かない */}
      <div className="overflow-auto min-h-0 max-h-[70dvh] border border-border rounded">
        <SortableTable header={table.headers} rows={table.rows} />
      </div>
    </>
  );
}

function RawPanel({ lines, totalLines }: { lines: string[]; totalLines: number }) {
  const t = useT();
  const digits = String(lines.length).length;
  return (
    <>
      <div className="text-[11px] text-muted-foreground">
        {lines.length < totalLines
          ? t("assetData.rawHead", { shown: String(lines.length), total: totalLines.toLocaleString() })
          : t("assetData.rawAll", { total: totalLines.toLocaleString() })}
      </div>
      <div className="overflow-auto min-h-0 max-h-[70dvh] border border-border rounded bg-background">
        <pre className="text-[11px] leading-[1.6] font-mono py-1">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {/* 行番号は選択・コピーに含めない */}
              <span
                className="select-none shrink-0 text-right pr-3 pl-2 text-muted-foreground/60 tabular-nums"
                style={{ width: `${digits + 2}ch` }}
              >
                {i + 1}
              </span>
              {/* タブは見た目で区切りと分かるよう広めに */}
              <span className="pr-3 whitespace-pre" style={{ tabSize: 4 }}>
                {line === "" ? " " : line}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </>
  );
}
