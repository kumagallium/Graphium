// 音声素材のプレビュー下に出す文字起こし欄。
// - 素材に保存済みのテキスト（OCR と同じ経路の平文）があれば表示する（音声全般）
// - デスクトップだけ「文字起こし」ボタンを出す。会議録音は従来の経路、
//   それ以外の音声（スマホの m4a / weba など）は WebView で形式を直して渡す経路

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
import { startExternalTranscribe, useExternalConverting } from "./transcribe-external";
import { bytesToMb, downloadPercent, ensureTranscribeModel, useModelDownloadState } from "./model-auto-download";
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
  // 文字にできなかった理由（failed = 変換・受け渡しがうまくいかなかった）
  const [notice, setNotice] = useState<TranscriptNotice | null>(null);
  // このパネルのボタンがモデルの取得を待っている間だけ true（「終わったら始めます」と言ってよいのはこのときだけ）
  const [waitingModel, setWaitingModel] = useState(false);
  const modelDl = useModelDownloadState(getMeetingSettings().modelSize);
  const downloading = modelDl.status === "downloading";
  const fileIdForBusy = getActiveProvider().extractFileId(url);
  // 変換して渡している間は、受信箱の自動処理の分も含めて「処理中」（共有の状態）
  const converting = useExternalConverting(fileIdForBusy);
  // 同じ録音がすでに文字起こし中なら押せない
  const busy =
    converting ||
    Object.values(rec.transcribes).some(
      (j) => j.status === "running" && !!fileIdForBusy && j.fileIds.includes(fileIdForBusy),
    );
  const prevBusy = useRef(busy);
  const [reload, setReload] = useState(0);

  const fileId = getActiveProvider().extractFileId(url);
  const isMeeting = isMeetingRecording(mimeType, name);
  const canTranscribe = isTauri() && !!fileId && (isMeeting || !!mimeType?.startsWith("audio/"));

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
    setNotice(null);
    try {
      const ms = getMeetingSettings();
      const list = await api.getModelStatus();
      if (!list.find((m) => m.size === ms.modelSize)?.present) {
        // 未取得なら取得を始め、揃ったらそのまま文字起こしを始める（利用者が押した操作なので、
        // 取り消し・削除の印があっても取得する）。失敗は設定での取得を案内する
        setWaitingModel(true);
        try {
          if (!(await ensureTranscribeModel(ms.modelSize))) { setModelMissing(true); return; }
        } finally {
          setWaitingModel(false);
        }
      }
    } catch {
      // 状態が読めなくても開始は試す（失敗は状態チップ側のトーストで知らせる）
    }
    if (isMeeting) {
      await startTranscribeFor([fileId]);
      return;
    }
    // 変換中の状態は startExternalTranscribe が共有の状態に持つ
    const r = await startExternalTranscribe(fileId, mimeType);
    // started 以外は理由を出す（busy は、Rust が別の受け取り・文字起こしを進めているとき。黙って捨てない）
    if (r.result !== "started") setNotice(r.result);
  };

  return (
    <AudioTranscriptPanelView
      canTranscribe={canTranscribe}
      busy={busy}
      downloading={downloading}
      waitingModel={waitingModel}
      modelMb={bytesToMb(modelDl.expectedBytes)}
      modelPercent={downloadPercent(modelDl)}
      notice={notice}
      modelMissing={modelMissing}
      text={text}
      onStart={() => void start()}
    />
  );
}

/** 文字にできなかった・始められなかった理由（panel に 1 文で出す） */
export type TranscriptNotice = "unreadable" | "too-long" | "too-large" | "busy" | "failed";

const NOTICE_KEYS: Record<TranscriptNotice, string> = {
  unreadable: "meeting.transcribeUnreadable",
  "too-long": "meeting.transcribeTooLong",
  "too-large": "meeting.transcribeTooLarge",
  busy: "meeting.transcribeBusyNotice",
  failed: "meeting.transcribeFailedPanel",
};

/** 表示だけの部分（状態は外から受け取る。ストーリー・テスト用に分けてある） */
export function AudioTranscriptPanelView({
  canTranscribe,
  busy,
  downloading,
  waitingModel,
  modelMb,
  modelPercent,
  notice,
  modelMissing,
  text,
  onStart,
}: {
  canTranscribe: boolean;
  busy: boolean;
  downloading: boolean;
  /** このパネルのボタンがモデルの取得を待っている（「終わったら始めます」と言ってよいとき） */
  waitingModel: boolean;
  modelMb: number;
  modelPercent: number;
  notice: TranscriptNotice | null;
  modelMissing: boolean;
  text: string | null;
  onStart: () => void;
}) {
  const t = useT();
  return (
    <div className="w-full max-w-sm text-left">
      {canTranscribe && (
        <button
          type="button"
          onClick={onStart}
          disabled={busy || downloading}
          data-tooltip={t("meeting.transcribeButtonTooltip")}
          className="rounded-lg border border-border px-3 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {busy ? t("meeting.transcribeRunning") : t("meeting.transcribeButton")}
        </button>
      )}
      {canTranscribe && downloading && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(waitingModel ? "meeting.transcriptModelDownloadingThenStart" : "meeting.transcriptModelDownloading", {
            size: String(modelMb),
            percent: String(modelPercent),
          })}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-muted-foreground">{t(NOTICE_KEYS[notice])}</p>}
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
