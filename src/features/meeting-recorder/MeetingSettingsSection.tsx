// 設定 > AI タブの「会議の録音と文字起こし」節。デスクトップ（Tauri）のときだけ呼び出し側が出す。
// 見た目だけの MeetingSettingsView と、Rust とやり取りする MeetingSettingsSection に分ける。

import { useCallback, useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { useT } from "../../i18n";
import { SettingSection } from "../settings/SettingSection";
import { SettingToggle } from "../settings/SettingToggle";
import {
  MEETING_LANGUAGES,
  getMeetingSettings,
  setMeetingSettings,
  type MeetingLanguage,
  type MeetingModelSize,
} from "../settings/store";
import * as api from "./api";
import type { MeetingModelStatus } from "./types";

const SIZES: MeetingModelSize[] = ["large-v3-turbo", "small", "base"];
/** 状態が読めるまでの目安（FAQ の数値表と同じ） */
const FALLBACK_BYTES: Record<MeetingModelSize, number> = { "large-v3-turbo": 574_000_000, small: 488_000_000, base: 148_000_000 };

export type MeetingDownloadState = { received: number; total: number } | null;

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function MeetingSettingsView({
  statuses,
  downloading,
  errors = {},
  notices = {},
  modelSize,
  language,
  liveTranscribe,
  vocabulary = "",
  onVocabulary,
  onModelSize,
  onLanguage,
  onLiveTranscribe,
  onDownload,
  onCancel,
  onDelete,
}: {
  statuses: MeetingModelStatus[];
  /** 取得中のモデル（キーが無い = 取得していない） */
  downloading: Partial<Record<MeetingModelSize, MeetingDownloadState>>;
  errors?: Partial<Record<MeetingModelSize, string>>;
  /** 赤字にしない案内（すでに取得中など） */
  notices?: Partial<Record<MeetingModelSize, string>>;
  modelSize: MeetingModelSize;
  language: MeetingLanguage;
  liveTranscribe: boolean;
  /** 用語のヒント（カンマ区切り） */
  vocabulary?: string;
  onVocabulary?: (v: string) => void;
  onModelSize: (s: MeetingModelSize) => void;
  onLanguage: (l: MeetingLanguage) => void;
  onLiveTranscribe: (on: boolean) => void;
  onDownload: (s: MeetingModelSize) => void;
  onCancel: (s: MeetingModelSize) => void;
  onDelete: (s: MeetingModelSize) => void;
}) {
  const t = useT();
  const langLabel: Record<MeetingLanguage, string> = {
    auto: t("meeting.languageAuto"),
    ja: t("meeting.languageJa"),
    en: t("meeting.languageEn"),
  };
  const btn =
    "rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent transition-colors";

  return (
    <SettingSection icon={Mic} title={t("meeting.settingsTitle")} summary={t("meeting.settingsSummary")}>
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-xs font-semibold text-foreground">{t("meeting.modelLabel")}</h4>
          <div className="space-y-2" role="radiogroup" aria-label={t("meeting.modelLabel")}>
            {SIZES.map((size) => {
              const st = statuses.find((s) => s.size === size);
              const present = st?.present === true;
              const dl = downloading[size];
              const percent = dl && dl.total > 0 ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0;
              return (
                <div key={size}>
                  <div className="flex items-center gap-2">
                    <label className="flex flex-1 min-w-0 items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name="meeting-model"
                        checked={modelSize === size}
                        onChange={() => onModelSize(size)}
                      />
                      <span>
                        {t(size === "large-v3-turbo" ? "meeting.modelTurbo" : size === "small" ? "meeting.modelSmall" : "meeting.modelBase")}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatMb(st?.expectedBytes ?? FALLBACK_BYTES[size])}
                      </span>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {dl ? t("meeting.modelDownloading", { percent: String(percent) }) : present ? t("meeting.modelPresent") : t("meeting.modelAbsent")}
                    </span>
                    {dl ? (
                      <button type="button" className={btn} onClick={() => onCancel(size)}>
                        {t("meeting.modelCancel")}
                      </button>
                    ) : present ? (
                      <button type="button" className={btn} onClick={() => onDelete(size)}>
                        {t("meeting.modelDelete")}
                      </button>
                    ) : (
                      <button type="button" className={btn} onClick={() => onDownload(size)}>
                        {t("meeting.modelDownload")}
                      </button>
                    )}
                  </div>
                  {dl && (
                    <div
                      className="mt-1 ml-6 h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  {notices[size] && <p className="mt-1 ml-6 text-xs text-muted-foreground">{notices[size]}</p>}
                  {errors[size] && (
                    <p className="mt-1 ml-6 text-xs text-destructive">{t("meeting.modelError", { message: errors[size] ?? "" })}</p>
                  )}
                </div>
              );
            })}
          </div>
          {modelSize !== "large-v3-turbo" && statuses.length > 0 && !statuses.find((s) => s.size === "large-v3-turbo")?.present && (
            <p className="mt-2 text-xs text-muted-foreground">{t("meeting.modelTurboHint")}</p>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold text-foreground">{t("meeting.languageLabel")}</h4>
          <div className="flex gap-4" role="radiogroup" aria-label={t("meeting.languageLabel")}>
            {MEETING_LANGUAGES.map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-sm text-foreground">
                <input type="radio" name="meeting-language" checked={language === l} onChange={() => onLanguage(l)} />
                {langLabel[l]}
              </label>
            ))}
          </div>
        </div>

        {onVocabulary && (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-foreground">{t("meeting.vocabularyLabel")}</h4>
            <p className="mb-2 text-xs text-muted-foreground">{t("meeting.vocabularySummary")}</p>
            <input
              type="text"
              value={vocabulary}
              maxLength={200}
              onChange={(e) => onVocabulary(e.target.value)}
              placeholder={t("meeting.vocabularyPlaceholder")}
              aria-label={t("meeting.vocabularyLabel")}
              className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        )}

        <SettingToggle
          checked={liveTranscribe}
          onChange={() => onLiveTranscribe(!liveTranscribe)}
          label={t("meeting.liveTranscribeLabel")}
          summary={t("meeting.liveTranscribeSummary")}
        />
      </div>
    </SettingSection>
  );
}

export function MeetingSettingsSection() {
  const [statuses, setStatuses] = useState<MeetingModelStatus[]>([]);
  const [downloading, setDownloading] = useState<Partial<Record<MeetingModelSize, MeetingDownloadState>>>({});
  const [errors, setErrors] = useState<Partial<Record<MeetingModelSize, string>>>({});
  const t = useT();
  const [notices, setNotices] = useState<Partial<Record<MeetingModelSize, string>>>({});
  const [settings, setSettings] = useState(getMeetingSettings);

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
    keep(api.onModelProgress((e) => setDownloading((d) => ({ ...d, [e.size]: { received: e.received, total: e.total } }))));
    keep(
      api.onModelDone((e) => {
        setDownloading((d) => ({ ...d, [e.size]: undefined }));
        setNotices((x) => ({ ...x, [e.size]: undefined }));
        refresh();
      }),
    );
    keep(
      api.onModelCancelled((e) => {
        // 取り消しは失敗ではない: 静かに「取得」へ戻す
        setDownloading((d) => ({ ...d, [e.size]: undefined }));
        setNotices((x) => ({ ...x, [e.size]: undefined }));
        refresh();
      }),
    );
    keep(
      api.onModelError((e) => {
        setDownloading((d) => ({ ...d, [e.size]: undefined }));
        setErrors((x) => ({ ...x, [e.size]: e.message }));
        refresh();
      }),
    );
    return () => {
      disposed = true;
      stops.forEach((u) => u());
    };
  }, [refresh]);

  const update = (patch: Parameters<typeof setMeetingSettings>[0]) => {
    setMeetingSettings(patch);
    setSettings(getMeetingSettings());
  };

  const download = (size: MeetingModelSize) => {
    setErrors((x) => ({ ...x, [size]: undefined }));
    setNotices((x) => ({ ...x, [size]: undefined }));
    setDownloading((d) => ({ ...d, [size]: { received: 0, total: 0 } }));
    // 完了 / 失敗はイベントでも届くが、取り消し・例外で届かない場合に備えて戻り値側でも整える
    // 完了 / 失敗 / 取り消しはイベントで届く。例外はここで受ける
    api
      .downloadModel(size)
      .catch((err) => {
        if (/already downloading/i.test(String(err))) {
          // 別の場所で取得中（モーダルを開き直したときなど）。進捗イベントをそのまま受ける
          setDownloading((d) => ({ ...d, [size]: d[size] ?? { received: 0, total: 0 } }));
          setNotices((x) => ({ ...x, [size]: t("meeting.modelAlreadyDownloading") }));
          // done / cancelled / error が届かないまま終わっていた場合に固着しないよう、1 回だけ読み直す
          api
            .getModelStatus()
            .then((list) => {
              setStatuses(list);
              if (list.find((m) => m.size === size)?.present) {
                setDownloading((d) => ({ ...d, [size]: undefined }));
                setNotices((x) => ({ ...x, [size]: undefined }));
              }
            })
            .catch(() => {});
          return;
        }
        setDownloading((d) => ({ ...d, [size]: undefined }));
        setErrors((x) => ({ ...x, [size]: String(err) }));
      })
      .finally(refresh);
  };

  return (
    <MeetingSettingsView
      statuses={statuses}
      downloading={downloading}
      errors={errors}
      notices={notices}
      modelSize={settings.modelSize}
      language={settings.language}
      liveTranscribe={settings.liveTranscribe}
      vocabulary={settings.vocabulary}
      onVocabulary={(v) => update({ meetingVocabulary: v })}
      onModelSize={(s) => update({ meetingModelSize: s })}
      onLanguage={(l) => update({ meetingLanguage: l })}
      onLiveTranscribe={(on) => update({ meetingLiveTranscribe: on })}
      onDownload={download}
      onCancel={(s) => void api.cancelModelDownload(s).catch(() => {})}
      onDelete={(s) => void api.deleteModel(s).then(refresh).catch(() => {})}
    />
  );
}
