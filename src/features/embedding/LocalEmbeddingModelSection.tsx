// 設定 > AI > 埋め込みモデルで「このパソコンで」のモデルを選んだときに出す、取得状況の行。
// 音声ノートのモデル行（MeetingSettingsSection）と同じ見た目・同じ流儀。
// 見た目だけの LocalEmbeddingModelView と、Rust とやり取りする LocalEmbeddingModelSection に分ける。

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";
import * as api from "./api";
import { localEmbeddingInfo } from "./engine";
import type { LocalEmbeddingModelName, LocalEmbeddingModelStatus } from "./types";

export type LocalEmbeddingDownloadState = { received: number; total: number } | null;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function LocalEmbeddingModelView({
  name,
  status,
  downloading,
  error,
  notice,
  onDownload,
  onCancel,
  onDelete,
}: {
  name: LocalEmbeddingModelName;
  /** Rust から読んだ状態。まだ読めていなければ null */
  status: LocalEmbeddingModelStatus | null;
  downloading: LocalEmbeddingDownloadState;
  error?: string;
  notice?: string;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const info = localEmbeddingInfo(name);
  const present = status?.present ?? false;
  const percent = downloading && downloading.total > 0 ? Math.min(100, Math.round((downloading.received / downloading.total) * 100)) : 0;
  const btn =
    "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent transition-colors";
  return (
    <div className="mt-2" data-testid="local-embedding-model">
      <p className="text-xs text-muted-foreground">{t("settings.embeddingModel.localHelp")}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="flex flex-1 min-w-0 items-center gap-2 text-sm text-foreground">
          <span>{name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMb(status?.expectedBytes ?? info.expectedBytes)} · {info.dims}d
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {downloading
            ? t("settings.embeddingModel.localDownloading", { percent: String(percent) })
            : present
              ? t("settings.embeddingModel.localPresent")
              : t("settings.embeddingModel.localAbsent")}
        </span>
        {downloading ? (
          <button type="button" className={btn} onClick={onCancel}>
            {t("settings.embeddingModel.localCancel")}
          </button>
        ) : present ? (
          <button type="button" className={btn} onClick={onDelete}>
            {t("settings.embeddingModel.localDelete")}
          </button>
        ) : (
          <button type="button" className={btn} onClick={onDownload}>
            {t("settings.embeddingModel.localDownload")}
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
      {!downloading && !present && !error && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("settings.embeddingModel.localAbsentHint")}</p>
      )}
      {notice && <p className="mt-1 text-xs text-muted-foreground">{notice}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{t("settings.embeddingModel.localError", { message: error })}</p>}
    </div>
  );
}

/** Rust とつないだ版。選んでいるモデル 1 つ分の状態を持つ */
export function LocalEmbeddingModelSection({ name }: { name: LocalEmbeddingModelName }) {
  const t = useT();
  const [statuses, setStatuses] = useState<LocalEmbeddingModelStatus[]>([]);
  const [downloading, setDownloading] = useState<Partial<Record<LocalEmbeddingModelName, LocalEmbeddingDownloadState>>>({});
  const [errors, setErrors] = useState<Partial<Record<LocalEmbeddingModelName, string>>>({});
  const [notices, setNotices] = useState<Partial<Record<LocalEmbeddingModelName, string>>>({});

  const refresh = useCallback(() => {
    api.getModelStatus().then(setStatuses).catch(() => {});
  }, []);

  // 開いたとき・done / error のあとに状態を読み直す。進捗はイベントで受ける
  useEffect(() => {
    refresh();
    const stops: Array<() => void> = [];
    let disposed = false;
    const keep = (p: Promise<() => void>) => {
      p.then((u) => (disposed ? u() : stops.push(u))).catch(() => {});
    };
    keep(api.onModelProgress((e) => setDownloading((d) => ({ ...d, [e.name]: { received: e.received, total: e.total } }))));
    keep(
      api.onModelDone((e) => {
        setDownloading((d) => ({ ...d, [e.name]: undefined }));
        setNotices((x) => ({ ...x, [e.name]: undefined }));
        refresh();
      }),
    );
    keep(
      api.onModelCancelled((e) => {
        setDownloading((d) => ({ ...d, [e.name]: undefined }));
        setNotices((x) => ({ ...x, [e.name]: undefined }));
        refresh();
      }),
    );
    keep(
      api.onModelError((e) => {
        setDownloading((d) => ({ ...d, [e.name]: undefined }));
        setErrors((x) => ({ ...x, [e.name]: e.message }));
        refresh();
      }),
    );
    return () => {
      disposed = true;
      stops.forEach((u) => u());
    };
  }, [refresh]);

  const download = () => {
    setErrors((x) => ({ ...x, [name]: undefined }));
    setNotices((x) => ({ ...x, [name]: undefined }));
    setDownloading((d) => ({ ...d, [name]: { received: 0, total: 0 } }));
    // 完了 / 失敗 / 取り消しはイベントで届く。例外はここで受ける
    api
      .downloadModel(name)
      .catch((err) => {
        if (/already downloading/i.test(String(err))) {
          // 別の場所で取得中（モーダルを開き直したときなど）。進捗イベントをそのまま受ける
          setDownloading((d) => ({ ...d, [name]: d[name] ?? { received: 0, total: 0 } }));
          setNotices((x) => ({ ...x, [name]: t("settings.embeddingModel.localAlreadyDownloading") }));
          api
            .getModelStatus()
            .then((list) => {
              setStatuses(list);
              if (list.find((m) => m.name === name)?.present) {
                setDownloading((d) => ({ ...d, [name]: undefined }));
                setNotices((x) => ({ ...x, [name]: undefined }));
              }
            })
            .catch(() => {});
          return;
        }
        setDownloading((d) => ({ ...d, [name]: undefined }));
        setErrors((x) => ({ ...x, [name]: String(err) }));
      })
      .finally(refresh);
  };

  return (
    <LocalEmbeddingModelView
      name={name}
      status={statuses.find((s) => s.name === name) ?? null}
      downloading={downloading[name] ?? null}
      error={errors[name]}
      notice={notices[name]}
      onDownload={download}
      onCancel={() => void api.cancelModelDownload(name).catch(() => {})}
      onDelete={() => void api.deleteModel(name).then(refresh).catch(() => {})}
    />
  );
}
