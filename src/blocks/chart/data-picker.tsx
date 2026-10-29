// チャート用データピッカー（中身が見える素材選択）
//
// 汎用の MediaPickerModal はアイコンと名前を並べるだけで、どれがどのデータか分からず、
// 数値を持たないログまで並ぶ。ここでは各素材の本文を読んで列名・行数・線の形を見せ、
// グラフにできないもの（数値列なし・読めない）は既定で畳む。
//
// 畳んだものも選べる — 次の取り込み画面で見出し行や区切りを直せば使える場合がある。
// 下見の結果は fileId 単位で data-preview-store に溜め、開き直しや素材一覧と共有する。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import type { MediaIndex, MediaIndexEntry } from "../../features/asset-browser/media-index";
import { DELIMITED_FILE_ACCEPT } from "../../features/data-import/file-kind";
import { loadAssetText } from "../../features/data-import/asset-text";
import {
  getDataPreviewState,
  requestDataPreview,
  retryFailedDataPreviews,
  subscribeDataPreviews,
} from "./data-preview-store";
import { DataSummary, Sparkline } from "./data-preview-parts";

export { clearDataPreviewCache } from "./data-preview-store";

export function ChartDataPickerModal({
  mediaIndex,
  onSelect,
  onPickLocalFile,
  onClose,
}: {
  mediaIndex: MediaIndex | null;
  onSelect: (entry: MediaIndexEntry, text: string) => void;
  onPickLocalFile?: (file: File) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC で閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // 下見が溜まったら再描画する。開き直したら、前回読めなかったものを読み直す
  useEffect(() => {
    retryFailedDataPreviews();
    return subscribeDataPreviews(() => setTick((n) => n + 1));
  }, []);

  // 候補: データ素材（アーカイブ除く）を新しい順に
  const candidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (mediaIndex?.media ?? [])
      .filter((m) => m.type === "data" && !m.archivedAt)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [mediaIndex, searchQuery]);

  // 今の並びの上から読む。絞り込みが変わったら、外れたものの依頼は取り消す
  useEffect(() => {
    const cancels = candidates.map((e) => requestDataPreview(e.fileId));
    return () => cancels.forEach((c) => c());
  }, [candidates]);

  // 読み込み中は usable 判定が出るまで一覧に残す
  const isHidden = (entry: MediaIndexEntry) => {
    const s = getDataPreviewState(entry.fileId);
    return s.kind === "failed" || (s.kind === "ready" && !s.preview.usable);
  };
  const visible = candidates.filter((e) => !isHidden(e));
  const hidden = candidates.filter(isHidden);
  const shown = showHidden ? [...visible, ...hidden] : visible;

  const handlePick = async (entry: MediaIndexEntry) => {
    try {
      const text = await loadAssetText(entry.fileId);
      onSelect(entry, text);
    } catch {
      // 読めない素材は取り込み画面に進めない。一覧の「読み込めませんでした」で分かる
      return;
    }
    onClose();
  };

  const renderRow = (entry: MediaIndexEntry) => {
    const s = getDataPreviewState(entry.fileId);
    const dim = isHidden(entry);
    let detail: ReactNode;
    if (s.kind === "failed") detail = t("chart.pickerReadFailed");
    else if (s.kind !== "ready") detail = t("chart.pickerLoading");
    else detail = <DataSummary preview={s.preview} />;
    return (
      <button
        key={entry.fileId}
        type="button"
        onClick={() => void handlePick(entry)}
        style={dim ? { opacity: 0.6 } : undefined}
        className="flex items-center gap-3 w-full text-left px-2 py-1.5 rounded border border-border bg-background hover:border-primary transition-colors"
      >
        <Sparkline series={s.kind === "ready" ? s.preview.sparkline : []} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">{entry.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {new Date(entry.uploadedAt).toLocaleDateString()}
        </span>
      </button>
    );
  };

  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t("chart.pickerTitle")}</h2>
          <span className="text-[10px] text-muted-foreground">
            {t("asset.count", { count: String(visible.length) })}
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* 検索 */}
        <div className="px-4 py-2 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("asset.search")}
            className="w-full text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* 一覧 */}
        <div className="flex-1 overflow-auto p-4">
          {onPickLocalFile && (
            <div className="mb-3">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border text-foreground transition-colors hover:bg-muted cursor-pointer">
                📁 {t("asset.uploadNew")}
                <input
                  type="file"
                  accept={DELIMITED_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // 同じファイルを選び直せるように値を戻しておく
                    e.target.value = "";
                    if (!file) return;
                    onPickLocalFile(file);
                    onClose();
                  }}
                />
              </label>
            </div>
          )}
          {showHidden && hidden.length > 0 && (
            <p className="mb-2 text-[10px] text-muted-foreground">{t("chart.pickerHiddenHint")}</p>
          )}
          {shown.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">{t("chart.pickerEmpty")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">{shown.map(renderRow)}</div>
          )}
          {hidden.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {t("chart.pickerHiddenCount", { count: String(hidden.length) })}
              </span>
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                className="text-[10px] text-primary hover:underline"
              >
                {showHidden ? t("chart.pickerHideHidden") : t("chart.pickerShowHidden")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
