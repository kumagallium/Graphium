// 会議録音の UI をまとめて描く: 開始確認・録音バー・完了 / 注意トースト。
// 停止後の素材登録もここで行う。デスクトップ（Tauri）以外では何も描かない。

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { isTauri } from "../../lib/platform";
import { useT } from "../../i18n";
import { MeetingRecorderBar } from "./MeetingRecorderBar";
import { MeetingStartDialog } from "./MeetingStartDialog";
import { registerRecording } from "./register-recording";
import * as api from "./api";
import { clearResult, clearTranscribe, dismissError, transcribeToastKey } from "./store";
import { getMeetingSettings } from "../settings/store";
import { useMeetingRecorder, useMeetingRecorderBoot } from "./use-meeting-recorder";

/** 録音の開始時に差し込む文字起こしブロックの props */
export type MeetingBlockInsertProps = { recordingId: string; fileId: string; startedAt: string };

export function MeetingRecorderMount({
  insertBlock,
  createNote,
  removeBlock,
}: {
  /** 開いているノートのカーソル位置にブロックを差し込む。挿入できたら true */
  insertBlock?: (props: MeetingBlockInsertProps) => boolean;
  /** 開いているノートが無いとき、新規ノートを作って先頭にブロックを置く */
  createNote?: (props: MeetingBlockInsertProps) => Promise<void>;
  /** 何も録れなかった録音のブロックを recordingId で探して消す（見つからなければ何もしない） */
  removeBlock?: (recordingId: string) => void;
} = {}) {
  const enabled = isTauri();
  const t = useT();
  const rec = useMeetingRecorder();
  useMeetingRecorderBoot(enabled);
  const [toast, setToast] = useState<string | null>(null);
  const [transcribeToast, setTranscribeToast] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);

  // 録音が始まったら、文字起こしブロックを 1 回だけ差し込む（同じ録音で二度入れない）
  const insertedRef = useRef<string | null>(null);
  const insertBlockRef = useRef(insertBlock);
  insertBlockRef.current = insertBlock;
  const createNoteRef = useRef(createNote);
  createNoteRef.current = createNote;
  const removeBlockRef = useRef(removeBlock);
  removeBlockRef.current = removeBlock;
  const startInfo = rec.startInfo;
  const startInfoRef = useRef(startInfo);
  startInfoRef.current = startInfo;
  useEffect(() => {
    if (!enabled || !startInfo || insertedRef.current === startInfo.id) return;
    insertedRef.current = startInfo.id;
    const props = { recordingId: startInfo.id, fileId: startInfo.fileId, startedAt: startInfo.startedAt };
    let inserted = false;
    try {
      inserted = insertBlockRef.current?.(props) ?? false;
    } catch (err) {
      console.warn("文字起こしブロックの挿入に失敗:", err);
    }
    if (!inserted) {
      void createNoteRef.current?.(props)?.catch((err) => console.warn("議事録ノートの作成に失敗:", err));
    }
  }, [enabled, startInfo]);

  // 停止結果が来たら素材に登録し、数秒だけ完了トーストを出す
  useEffect(() => {
    const result = rec.result;
    if (!enabled || !result || handledRef.current === result.id) return;
    handledRef.current = result.id;
    // 何も録れなかった（素材なし）録音: 差し込んだ文字起こしブロックは中身が無いので消す
    if (!result.fileId) removeBlockRef.current?.(result.id);
    const reason = rec.stopReason;
    void (async () => {
      let count = 0;
      try {
        count = await registerRecording(result);
      } catch (err) {
        console.warn("会議録音の素材登録に失敗:", err);
        setToast(t("meeting.registerFailed"));
        clearResult();
        return;
      }
      clearResult();
      if (count === 0) {
        // 両方のトラックが録れていない（fileId なし）
        setToast(t("meeting.failed"));
        return;
      }
      // 相手の声を録らない設定で始めた録音は、相手側が無いのが当たり前なので「一部」扱いにしない
      const selfOnly = startInfoRef.current?.id === result.id && startInfoRef.current.captureSystem === false;
      const partial = selfOnly ? !result.tracks.mic : !result.tracks.system || !result.tracks.mic;
      if (reason === "limit") setToast(t(partial ? "meeting.limitReachedPartial" : "meeting.limitReached"));
      else if (partial) setToast(t(result.tracks.system ? "meeting.savedOnlyOther" : "meeting.savedOnlySelf"));
      else setToast(t("meeting.saved"));
    })();
  }, [enabled, rec.result, rec.stopReason, t]);

  // 停止の失敗は同意ダイアログではなくトーストで知らせる
  useEffect(() => {
    if (rec.phase === "error" && rec.error?.context === "stop") {
      setToast(t("meeting.stopFailed"));
      dismissError();
    }
  }, [rec.phase, rec.error, t]);

  // 文字起こしの完了 / 失敗は別のトーストで知らせる（録音の保存トーストとは別）
  const transcribes = rec.transcribes;
  useEffect(() => {
    if (!enabled) return;
    for (const job of Object.values(transcribes)) {
      if (job.status === "running") continue;
      const key = transcribeToastKey(job);
      if (key) setTranscribeToast(t(key));
      clearTranscribe(job.jobId);
    }
  }, [enabled, transcribes, t]);
  const runningJobs = Object.values(transcribes).filter((j) => j.status === "running");
  const liveJob = rec.liveJobId ? transcribes[rec.liveJobId] : undefined;
  useEffect(() => {
    if (!transcribeToast) return;
    const timer = setTimeout(() => setTranscribeToast(null), 4000);
    return () => clearTimeout(timer);
  }, [transcribeToast]);

  // 開始ダイアログを開いたとき、録音中の文字起こしが ON でモデル未取得なら注意を出す
  const confirming = rec.phase === "confirming";
  useEffect(() => {
    if (!enabled || !confirming) return;
    const ms = getMeetingSettings();
    if (!ms.liveTranscribe) { setModelMissing(false); return; }
    let cancelled = false;
    api.getModelStatus()
      .then((list) => { if (!cancelled) setModelMissing(!list.find((m) => m.size === ms.modelSize)?.present); })
      .catch(() => { if (!cancelled) setModelMissing(false); });
    return () => { cancelled = true; };
  }, [enabled, confirming]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!enabled) return null;

  const dialogOpen =
    rec.phase === "confirming" ||
    rec.phase === "starting" ||
    (rec.phase === "error" && rec.error?.context !== "stop");
  const errorMessage =
    rec.error?.kind === "failed" ? (rec.error.message ?? t("meeting.failed")) : null;

  return (
    <>
      <MeetingStartDialog
        open={dialogOpen}
        permission={
          rec.error?.kind === "permissionDenied"
            ? { screen: "denied", mic: rec.permission?.mic ?? "unknown" }
            : rec.permission
        }
        busy={rec.phase === "starting"}
        onOpenSettings={() => void api.openScreenSettings().catch(() => {})}
        errorMessage={errorMessage}
        modelMissing={modelMissing}
        captureSystem={rec.captureSystem}
        onCaptureSystemChange={rec.setCaptureSystem}
        onStart={() => {
          if (rec.phase === "error") rec.dismissError();
          void rec.start();
        }}
        onCancel={() => {
          if (rec.phase === "error") rec.dismissError();
          else rec.cancel();
        }}
      />
      {(rec.phase === "recording" || rec.phase === "stopping") && (
        <MeetingRecorderBar
          elapsedMs={rec.elapsedMs}
          level={rec.level}
          stopping={rec.phase === "stopping"}
          warning={rec.error?.context === "recording" ? (rec.error.message ?? t("meeting.failed")) : null}
          transcribeCount={liveJob?.status === "running" ? liveJob.segmentCount : null}
          onStop={rec.stop}
        />
      )}
      {rec.phase === "idle" && runningJobs.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-popover py-1.5 pl-3 pr-3.5 text-xs shadow-lg"
          role="status"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
          <span className="text-foreground">{t("meeting.transcribeFinishing")}</span>
        </div>
      )}
      {transcribeToast && (
        <div
          className="fixed bottom-28 right-4 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-popover py-1.5 pl-3 pr-3.5 text-xs shadow-lg"
          role="status"
        >
          <Check size={13} className="shrink-0 text-muted-foreground" />
          <span className="text-foreground">{transcribeToast}</span>
        </div>
      )}
      {toast && (
        <div
          className="fixed bottom-16 right-4 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-popover py-1.5 pl-3 pr-3.5 text-xs shadow-lg"
          role="status"
        >
          <Check size={13} className="shrink-0 text-muted-foreground" />
          <span className="text-foreground">{toast}</span>
        </div>
      )}
    </>
  );
}
