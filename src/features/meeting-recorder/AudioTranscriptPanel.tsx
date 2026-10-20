// 音声素材のプレビュー下に出す文字起こし欄。
// - 素材に保存済みのテキスト（OCR と同じ経路の平文）があれば表示する（音声全般）
// - 会議録音（名前が会議録音のもの）には、デスクトップだけ「文字起こし」ボタンを出す

import { useEffect, useRef, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { isTauri } from "../../lib/platform";
import { useT } from "../../i18n";
import { en } from "../../i18n/en";
import { ja } from "../../i18n/ja";
import { getMeetingSettings } from "../settings/store";
import * as api from "./api";
import { formatTranscriptJson } from "./transcript-format";
import { startTranscribeFor } from "./store";
import { useMeetingRecorder } from "./use-meeting-recorder";

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 録音時に付く表示名（`meeting.fileName` の stamp を正規表現にしたもの） */
const DISPLAY_NAME_RES = [ja, en].map(
  (d) =>
    new RegExp(
      "^" + escapeRe(d["meeting.fileName"]).replace("\\{stamp\\}", "\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}") + "$",
    ),
);
const FILE_NAME_RE = /^meeting-\d{8}-\d{4}\.wav$/;

/** 会議録音の素材か（audio/wav かつ、ファイル名か録音時の表示名の形に一致） */
export function isMeetingRecording(mimeType: string | undefined, name: string): boolean {
  if (mimeType !== "audio/wav") return false;
  return FILE_NAME_RE.test(name) || DISPLAY_NAME_RES.some((re) => re.test(name));
}

export function AudioTranscriptPanel({ url, name, mimeType }: { url: string; name: string; mimeType?: string }) {
  const t = useT();
  const rec = useMeetingRecorder();
  const [text, setText] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const fileIdForBusy = getActiveProvider().extractFileId(url);
  // 同じ録音がすでに文字起こし中なら押せない
  const busy = Object.values(rec.transcribes).some(
    (j) => j.status === "running" && !!fileIdForBusy && j.fileIds.includes(fileIdForBusy),
  );
  const prevBusy = useRef(busy);
  const [reload, setReload] = useState(0);

  const fileId = getActiveProvider().extractFileId(url);
  const canTranscribe = isTauri() && !!fileId && isMeetingRecording(mimeType, name);

  // 処理が終わった瞬間に読み直す
  useEffect(() => {
    if (prevBusy.current && !busy) setReload((n) => n + 1);
    prevBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    const provider = getActiveProvider();
    if (!fileId || !provider.loadMediaText) { setText(null); return; }
    let cancelled = false;
    void (async () => {
      // transcript.json（話者つき）を優先。無ければ従来どおり平文の .txt
      let shown: string | null = null;
      if (isTauri()) {
        try {
          shown = formatTranscriptJson(await api.readTranscript(fileId), {
            other: t("meeting.trackOther"),
            self: t("meeting.trackSelf"),
          });
        } catch {
          shown = null;
        }
      }
      if (!shown) {
        try {
          const v = await provider.loadMediaText?.(fileId);
          shown = v && v.trim() ? v : null;
        } catch {
          shown = null;
        }
      }
      if (!cancelled) setText(shown);
    })();
    return () => { cancelled = true; };
  }, [fileId, reload, t]);

  if (!canTranscribe && !text) return null;

  const start = async () => {
    if (!fileId) return;
    setModelMissing(false);
    try {
      const ms = getMeetingSettings();
      const list = await api.getModelStatus();
      if (!list.find((m) => m.size === ms.modelSize)?.present) { setModelMissing(true); return; }
    } catch {
      // 状態が読めなくても開始は試す（失敗は状態チップ側のトーストで知らせる）
    }
    await startTranscribeFor([fileId]);
  };

  return (
    <div className="w-full max-w-sm text-left">
      {canTranscribe && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          data-tooltip={t("meeting.transcribeButtonTooltip")}
          className="rounded-lg border border-border px-3 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {busy ? t("meeting.transcribeRunning") : t("meeting.transcribeButton")}
        </button>
      )}
      {modelMissing && <p className="mt-2 text-xs text-muted-foreground">{t("meeting.transcriptModelMissing")}</p>}
      {text && (
        <div className="mt-3">
          <h4 className="mb-1 text-xs font-semibold text-foreground">{t("meeting.transcriptHeading")}</h4>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">{text}</pre>
        </div>
      )}
    </div>
  );
}
