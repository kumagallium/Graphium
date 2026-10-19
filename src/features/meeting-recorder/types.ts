// 会議録音: Rust 側コマンド契約の型

export type PermissionState = "granted" | "denied" | "unknown";

export type MeetingRecPermission = {
  screen: PermissionState;
  mic: PermissionState;
};

export type MeetingRecStartResult = { id: string; startedAt: string };

export type MeetingRecStopResult = {
  id: string;
  systemFileId: string | null;
  micFileId: string | null;
  durationMs: number;
  droppedPackets: number;
};

export type MeetingRecStatus = {
  recording: boolean;
  id?: string;
  elapsedMs?: number;
};

/** meeting-rec-level イベント（500 ms ごと・RMS 0..1） */
export type MeetingRecLevelEvent = {
  id: string;
  elapsedMs: number;
  system: number;
  mic: number;
};

export type MeetingRecErrorEvent = { id: string; message: string };

/** Rust 側が上限・エラーで自分で stop を済ませ、その結果を載せてくる */
export type MeetingRecStoppedEvent = {
  id: string;
  reason: "limit" | "error";
  result: MeetingRecStopResult | null;
};

/** UI 状態機械: idle → confirming → starting → recording → stopping → idle（+ error） */
export type MeetingPhase =
  | "idle"
  | "confirming"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export type MeetingErrorKind = "permissionDenied" | "failed";

/** エラーが起きた場面（表示先の出し分けに使う） */
export type MeetingErrorContext = "start" | "stop" | "recording";

export type MeetingRecorderState = {
  phase: MeetingPhase;
  /** 録音 ID（recording / stopping のとき） */
  id: string | null;
  elapsedMs: number;
  level: { system: number; mic: number };
  /** 最後に停止した録音の結果（素材登録前後どちらでも保持） */
  result: MeetingRecStopResult | null;
  /** 停止の理由（上限到達・エラーによる自動停止のとき） */
  stopReason: "limit" | "error" | null;
  error: { kind: MeetingErrorKind; context: MeetingErrorContext; message?: string } | null;
  /** 開始確認ダイアログで出す権限状態 */
  permission: MeetingRecPermission | null;
};
