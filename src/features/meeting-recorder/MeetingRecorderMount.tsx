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
import { clearResult, dismissError } from "./store";
import { useMeetingRecorder, useMeetingRecorderBoot } from "./use-meeting-recorder";

export function MeetingRecorderMount() {
  const enabled = isTauri();
  const t = useT();
  const rec = useMeetingRecorder();
  useMeetingRecorderBoot(enabled);
  const [toast, setToast] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);

  // 停止結果が来たら素材に登録し、数秒だけ完了トーストを出す
  useEffect(() => {
    const result = rec.result;
    if (!enabled || !result || handledRef.current === result.id) return;
    handledRef.current = result.id;
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
      if (count === 0) return;
      const partial = !result.systemFileId || !result.micFileId;
      if (reason === "limit") setToast(t(partial ? "meeting.limitReachedPartial" : "meeting.limitReached"));
      else if (partial) setToast(t(result.systemFileId ? "meeting.savedOnlyOther" : "meeting.savedOnlySelf"));
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
          onStop={rec.stop}
        />
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
