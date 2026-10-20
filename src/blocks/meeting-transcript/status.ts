// 文字起こしブロックの状態導出（純関数）
//
// 状態は props に持たず、描画のたびにストアと transcript.json の読み込み結果から導く。
// props に持つと、録音中に落ちたり別 PC で開いたときに「録音中」のまま固まるため。

import type { MeetingPhase, MeetingTranscribeState } from "../../features/meeting-recorder/types";
import type { TranscriptSegment } from "../../features/meeting-recorder/transcript-format";

export type MeetingBlockStatus =
  | "ready" // まだ録音していない（recordingId / fileId が空）。「録音を始める」を出す
  | "readyUnavailable" // 録音前だが、このデバイスでは録音できない
  | "recording" // この録音が進行中
  | "transcribing" // この素材の文字起こしジョブが実行中
  | "failed" // 直近のジョブが失敗・取り消しで終わった（読めた分は出す）
  | "loading" // transcript.json を読んでいる
  | "done" // 読めた
  | "empty" // デスクトップだが、まだ文字起こしがない
  | "unavailable"; // デスクトップ以外で読めない

/** 既定で出す直近の発言数 */
export const RECENT_SEGMENT_LIMIT = 20;

export function deriveBlockStatus(input: {
  tauri: boolean;
  phase: MeetingPhase;
  activeRecordingId: string | null;
  recordingId: string;
  fileId: string;
  transcribes: Record<string, MeetingTranscribeState>;
  /** transcript.json の読み込み結果。null = まだ読んでいない / 読み込み中 */
  transcript: "loaded" | "missing" | null;
  /** このブロックの「録音を始める」で録音が始まったが、props がまだ埋まっていない（ちらつき防止） */
  pendingStart?: boolean;
  /** この素材の直近ジョブの終わり方（ストアの lastJobByFile） */
  lastJob?: "done" | "failed" | "cancelled";
}): MeetingBlockStatus {
  if (!input.recordingId && !input.fileId) {
    if (input.pendingStart) return "recording";
    return input.tauri ? "ready" : "readyUnavailable";
  }
  if (input.phase === "recording" && !!input.recordingId && input.activeRecordingId === input.recordingId) {
    return "recording";
  }
  if (
    input.fileId &&
    Object.values(input.transcribes).some((j) => j.status === "running" && j.fileIds.includes(input.fileId))
  ) {
    return "transcribing";
  }
  if (!input.tauri || !input.fileId) return "unavailable";
  if (input.lastJob === "failed" || input.lastJob === "cancelled") return "failed";
  if (input.transcript === null) return "loading";
  return input.transcript === "loaded" ? "done" : "empty";
}

/** 既定は直近 N 発言。showAll なら全部。隠した件数も返す */
export function pickVisibleSegments(
  segments: TranscriptSegment[],
  showAll: boolean,
  limit = RECENT_SEGMENT_LIMIT,
): { visible: TranscriptSegment[]; hidden: number } {
  if (showAll || segments.length <= limit) return { visible: segments, hidden: 0 };
  return { visible: segments.slice(segments.length - limit), hidden: segments.length - limit };
}

const segKey = (s: TranscriptSegment) => `${s.track ?? ""}|${s.startMs}|${s.text}`;

/**
 * 素材から読んだ発言（saved）と録音中に届いた発言（live）を、(話者, 開始, 本文) で重複排除して
 * 時刻順に並べる。リロード後に live だけが残って前半が消える問題と、再実行中の二重表示を両方防ぐ。
 */
export function mergeSegments(saved: TranscriptSegment[], live: TranscriptSegment[] | undefined): TranscriptSegment[] {
  if (!live || live.length === 0) return saved;
  if (saved.length === 0) return live;
  const seen = new Set<string>();
  const out: TranscriptSegment[] = [];
  for (const s of [...saved, ...live]) {
    const k = segKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** 発言の最大 endMs（長さが未確定のときの目安）。endMs が無ければ startMs。発言なしは 0 */
export function approxDurationMs(segments: TranscriptSegment[]): number {
  let max = 0;
  for (const s of segments) max = Math.max(max, s.endMs ?? s.startMs);
  return max;
}
