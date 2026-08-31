// データ素材（区切りテキスト .csv / .txt / .dat）のプレビュー
//
// 素材本体を読み、取り込みと同じ推定（detectImportOptions）で表に起こして
// 並べ替えつきの読み取り専用テーブル（SortableTable）で見せる。
// - あくまで「素材をその場で眺める」ためのビュー。ノートに表を作るのは
//   従来どおり /データ の取り込みダイアログの役目
// - 前置き（# Device Model: ... のような測定条件）があれば表の上に出す

import { useEffect, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { detectImportOptions } from "../data-import/detect";
import { extractHeaderMeta } from "../data-import/header-meta";
import { parseDelimited, splitLines } from "../data-import/parse";
import { readDataFileText } from "../data-import/read-file";
import { SortableTable } from "../table-meta/expand-modal";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";

type ParsedState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      headers: string[];
      rows: string[][];
      meta: { key: string; value: string }[];
    };

export function DataPreview({ entry }: { entry: MediaIndexEntry }) {
  const t = useT();
  const [state, setState] = useState<ParsedState>({ kind: "loading" });

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
        // 取り込みダイアログと同じ自動判定で読む。ここで読み方を変えたいときは
        // 取り込み（/データ）に進んで設定を調整してもらう
        const options = detectImportOptions(splitLines(text));
        const parsed = parseDelimited(text, options);
        if (cancelled) return;
        if (parsed.headers.length === 0) {
          setState({ kind: "error" });
          return;
        }
        setState({
          kind: "ready",
          headers: parsed.headers,
          rows: parsed.rows,
          meta: extractHeaderMeta(parsed.headerLines),
        });
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
        {t("dataImport.noTable")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* 前置きの測定条件（あれば）。表の出所を添える情報なので控えめに */}
      {state.meta.length > 0 && (
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {state.meta.map((m) => (
            <div key={m.key}>
              {m.key}: {m.value}
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {t("tableMeta.expandCount", {
          rows: String(state.rows.length),
          cols: String(state.headers.length),
        })}
        <span className="ml-3">{t("tableMeta.expandSortHint")}</span>
      </div>
      {/* max-h でこの div を実際のスクロールコンテナにする。無いと親（ピーク全体）が
          スクロールしてしまい、列見出しの sticky が効かない */}
      <div className="overflow-auto min-h-0 max-h-[70dvh] border border-border rounded">
        <SortableTable header={state.headers} rows={state.rows} />
      </div>
    </div>
  );
}
