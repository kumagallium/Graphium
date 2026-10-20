// 会議録音: Rust 側コマンド契約の型

export type PermissionState = "granted" | "denied" | "unknown";

export type MeetingRecPermission = {
  screen: PermissionState;
  mic: PermissionState;
};

export type MeetingModelSize = "small" | "base";
export type MeetingLanguage = "auto" | "ja" | "en";

export type MeetingRecStartOptions = {
  liveTranscribe: boolean;
  language: MeetingLanguage;
  modelSize: MeetingModelSize;
};

export type MeetingRecStartResult = {
  id: string;
  startedAt: string;
  /** null = モデル未取得などで録音だけ */
  transcribeJobId?: string | null;
};

export type MeetingModelStatus = {
  size: MeetingModelSize;
  present: boolean;
  bytes: number;
  expectedBytes: number;
};

export type MeetingModelProgressEvent = { size: MeetingModelSize; received: number; total: number };
export type MeetingModelDoneEvent = { size: MeetingModelSize };
export type MeetingModelErrorEvent = { size: MeetingModelSize; message: string };

export type MeetingTranscribeSegment = {
  startMs: number;
  endMs: number;
  text: string;
  noSpeechProb: number | null;
};
export type MeetingTranscribeCancelledEvent = { jobId: string };
export type MeetingModelCancelledEvent = { size: MeetingModelSize };
export type MeetingTranscribeSegmentEvent = {
  jobId: string;
  fileId: string;
  track: "system" | "mic" | null;
  segments: MeetingTranscribeSegment[];
};
export type MeetingTranscribeProgressEvent = { jobId: string; fileId: string; ratio: number };
export type MeetingTranscribeDoneEvent = { jobId: string; fileIds: string[] };
export type MeetingTranscribeErrorEvent = { jobId: string; message: string };

/** 文字起こしジョブ 1 件の状態（録音バー・状態チップ・トーストが見る） */
export type MeetingTranscribeState = {
  jobId: string;
  status: "running" | "done" | "failed" | "cancelled";
  ratio: number;
  segmentCount: number;
  /** 処理中は触れているファイル、done 後は保存できたファイル */
  fileIds: string[];
  message?: string;
};

export type MeetingRecStopResult = {
  id: string;
  /** 1 本の stereo WAV（左 = 相手、右 = 自分）。どちらも録れなかったときは null */
  fileId: string | null;
  /** どのトラックが録れたか */
  tracks: { system: boolean; mic: boolean };
  durationMs: number;
  droppedPackets: number;
  transcribeJobId?: string | null;
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
  /** 文字起こしジョブ（jobId ごと。録音由来も既存録音由来も入る） */
  transcribes: Record<string, MeetingTranscribeState>;
  /** 録音バーが見る、録音由来（live）のジョブ ID */
  liveJobId: string | null;
  /** 開始確認ダイアログで出す権限状態 */
  permission: MeetingRecPermission | null;
};
