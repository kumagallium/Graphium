// 設定 > AI タブの「画像の文字を読むモデル」節。デスクトップ（Tauri）のときだけ呼び出し側が出す。
// 画像の文字読みは AI モデルを使わないので、AI を登録していなくても出す（音声ノートと同じ置き方）。
// 見た目だけの OcrModelSettingsView と、Rust とやり取りする OcrModelSettingsSection に分ける。
// 取得・取り消し・削除の行は LocalEmbeddingModelView / MeetingSettingsView と同じ部品・同じ語彙。

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingToggle } from "../settings/SettingToggle";
import { isOcrNativeEnabled, setOcrNativeEnabled } from "../settings/store";
import * as api from "../../lib/ocr-native";

export type OcrModelDownloadState = { received: number; total: number } | null;

/** 状態が読めるまでの目安（PP-OCRv6 small・約 31 MB） */
const FALLBACK_BYTES = 31_000_000;

function formatMb(bytes: number): string {
  return String(Math.round(bytes / 1_000_000));
}

export function OcrModelSettingsView({
  status,
  downloading,
  error,
  enabled,
  onToggle,
  onDownload,
  onCancel,
  onDelete,
  defaultOpen = false,
}: {
  /** Rust から読んだ状態。まだ読めていなければ null */
  status: api.NativeOcrModelStatus | null;
  downloading: OcrModelDownloadState;
  error?: string;
  /** 「端末内のモデルで読む」がオンか */
  enabled: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  /** 束を最初から開いておくか（Storybook とマニュアルの図用。開閉はブラウザが覚える） */
  defaultOpen?: boolean;
}) {
  const t = useT();
  const present = status?.present ?? false;
  const size = formatMb(status?.expectedBytes ?? FALLBACK_BYTES);
  const percent = downloading && downloading.total > 0 ? Math.min(100, Math.round((downloading.received / downloading.total) * 100)) : 0;
  const btn =
    "rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent transition-colors";
  return (
    <SettingsGroup
      storageKey="ai-ocr"
      defaultOpen={defaultOpen}
      title={t("settings.ocrModel.title")}
      summary={enabled ? t("settings.ocrModel.summaryOn") : t("settings.ocrModel.summaryOff")}
    >
      <div data-testid="ocr-model-settings">
        <SettingToggle
          checked={enabled}
          onChange={onToggle}
          label={t("settings.ocrModel.toggle")}
          summary={t("settings.ocrModel.help")}
        >
          <div className="flex items-center gap-2">
            <span className="flex flex-1 min-w-0 items-center gap-2 text-sm text-foreground">
              <span>{t("settings.ocrModel.modelName")}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {downloading
                ? t("settings.ocrModel.downloading", { percent: String(percent) })
                : present
                  ? t("settings.ocrModel.present", { size })
                  : t("settings.ocrModel.absent")}
            </span>
            {downloading ? (
              <button type="button" className={btn} onClick={onCancel}>
                {t("settings.ocrModel.cancel")}
              </button>
            ) : present ? (
              <button type="button" className={btn} onClick={onDelete}>
                {t("settings.ocrModel.delete")}
              </button>
            ) : (
              <button type="button" className={btn} onClick={onDownload}>
                {t("settings.ocrModel.download")}
              </button>
            )}
          </div>
          {downloading && (
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
          )}
          {error && <p className="mt-1 text-xs text-destructive">{t("settings.ocrModel.error", { message: error })}</p>}
        </SettingToggle>
      </div>
    </SettingsGroup>
  );
}

/** Rust とつないだ版。モデルの状態・進捗・エラーと、スイッチの値（設定）を持つ */
export function OcrModelSettingsSection({ defaultOpen }: { defaultOpen?: boolean } = {}) {
  const [status, setStatus] = useState<api.NativeOcrModelStatus | null>(null);
  const [downloading, setDownloading] = useState<OcrModelDownloadState>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState<boolean>(() => isOcrNativeEnabled());

  const refresh = useCallback(() => {
    api.getOcrModelStatus().then(setStatus).catch(() => {});
  }, []);

  // 開いたとき・done / error のあとに状態を読み直す。進捗はイベントで受ける
  useEffect(() => {
    refresh();
    const stops: Array<() => void> = [];
    let disposed = false;
    const keep = (p: Promise<() => void>) => {
      p.then((u) => (disposed ? u() : stops.push(u))).catch(() => {});
    };
    keep(api.onOcrModelProgress((e) => setDownloading({ received: e.received, total: e.total })));
    keep(
      api.onOcrModelDone(() => {
        setDownloading(null);
        setError(undefined);
        refresh();
      }),
    );
    keep(
      api.onOcrModelCancelled(() => {
        setDownloading(null);
        refresh();
      }),
    );
    keep(
      api.onOcrModelError((e) => {
        setDownloading(null);
        setError(e.message);
        refresh();
      }),
    );
    return () => {
      disposed = true;
      stops.forEach((u) => u());
    };
  }, [refresh]);

  const download = () => {
    setError(undefined);
    setDownloading({ received: 0, total: 0 });
    // 完了 / 失敗 / 取り消しはイベントで届く。例外はここで受ける
    api
      .downloadOcrModel()
      .catch((err) => {
        // 画像を読む側の自動取得がすでに走っている間は、進捗イベントをそのまま受ける
        if (/already downloading/i.test(String(err))) return;
        setDownloading(null);
        setError(String(err));
      })
      .finally(refresh);
  };

  return (
    <OcrModelSettingsView
      status={status}
      downloading={downloading}
      error={error}
      enabled={enabled}
      defaultOpen={defaultOpen}
      onToggle={() => {
        const next = !enabled;
        setOcrNativeEnabled(next);
        setEnabled(next);
      }}
      onDownload={download}
      onCancel={() => void api.cancelOcrModelDownload().catch(() => {})}
      onDelete={() => void api.deleteOcrModel().then(refresh).catch(() => {})}
    />
  );
}
