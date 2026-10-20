// 会議録音: Rust 側コマンド契約の型

export type PermissionState = "granted" | "denied" | "unknown";

export type MeetingRecPermission = {
  screen: PermissionState;
  mic: PermissionState;
};

export type MeetingModelSize = "small" | "base";
export type MeetingLanguage = "auto" | "ja" | "en";

export type MeetingRecStartOptions = {
  /** false なら相手側（パソコンの音）を録らず、画面収録の権限も求めない。既定 true */
  captureSystem?: boolean;
  liveTranscribe: boolean;
  language: MeetingLanguage;
  modelSize: MeetingModelSize;
};

export type MeetingRecStartResult = {
  id: string;
  startedAt: string;
  /** 録音する stereo WAV の素材 ID（ブロックが文字起こしを引くキー） */
  fileId: string;
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

/**
 * 文字起こしブロックへまだ書けていない録音の情報（recordingId 単位）。
 * ブロックがマウントされていない間（別のノートを開いている等）に録音が始まる・止まるので、
 * ストアに残しておき、ブロックが描画されたときに自分の props へ適用して消す。
 */
export type PendingBlockWrite = {
  recordingId: string;
  /** 開始の書き込み先（ブロックの「録音を始める」から始めたときだけ） */
  blockId?: string;
  /** 未適用の開始情報（recordingId / fileId / startedAt を空のブロックへ埋める） */
  start?: { fileId: string; startedAt: string };
  /** 未適用の長さ（停止時に確定） */
  durationMs?: number;
  /** 何も録れなかった: ブロックを録音前（ready）に戻す */
  reset?: boolean;
};

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
  /** ブロックへ未適用の録音情報（recordingId ごと。直近 20 件） */
  pendingBlockWrites: Record<string, PendingBlockWrite>;
  /** ブロックの「録音を始める」から開始処理中（またはその失敗の案内中）のブロック ID */
  blockStart: string | null;
  /** 「相手の声も録る」（開始確認ダイアログのトグル。既定オン） */
  captureSystem: boolean;
  /** 開始確認ダイアログで出す権限状態 */
  permission: MeetingRecPermission | null;
  /** 直近に始めた録音（文字起こしブロックを差し込む合図。syncStatus の復元では立てない） */
  startInfo: { id: string; fileId: string; startedAt: string; captureSystem: boolean; attachToBlockId?: string } | null;
  /** 録音中に届いた発言（fileId ごと。ブロックが録音中に描く。保存は素材側） */
  liveSegments: Record<string, import("./transcript-format").TranscriptSegment[]>;
  /** ファイルごとの直近ジョブの終わり方（transcribes は表示後に手放されるので別に持つ）。新しいジョブが始まると消える */
  lastJobByFile: Record<string, "done" | "failed" | "cancelled">;
};
