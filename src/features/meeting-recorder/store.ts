// 会議録音: モジュールレベルのストア（useSyncExternalStore 用）
//
// サイドバーのボタンと画面下のバーが props なしで同じ状態を見るため、React の外に持つ。
// 状態機械: idle → confirming → starting → recording → stopping → idle（+ error）

import * as api from "./api";
import { getMeetingSettings } from "../settings/store";
import type { PendingBlockWrite, MeetingRecorderState, MeetingRecStopResult, MeetingTranscribeSegment, MeetingTranscribeState } from "./types";
import { sortSegments, type TranscriptSegment } from "./transcript-format";

function resultFileIds(r: MeetingRecStopResult): string[] {
  return r.fileId ? [r.fileId] : [];
}

const INITIAL: MeetingRecorderState = {
  phase: "idle",
  id: null,
  elapsedMs: 0,
  level: { system: 0, mic: 0 },
  result: null,
  stopReason: null,
  error: null,
  transcribes: {},
  liveJobId: null,
  permission: null,
  startInfo: null,
  captureSystem: true,
  pendingBlockWrites: {},
  blockStart: null,
  liveSegments: {},
  lastJobByFile: {},
};

let state: MeetingRecorderState = INITIAL;
/** starting 中（id 確定前）に届いた error イベント。start が id を得た時点で振り分ける */
/** 直前の録音 id（stop 失敗・競合後に遅れて届く stopped を拾うため残す） */
let lastId: string | null = null;
let stopWaitTimer: ReturnType<typeof setTimeout> | null = null;
/** 手動 stop が "not recording" で失敗したあと、上限側の stopped を待つ上限 */
const STOP_WAIT_MS = 5000;
function clearStopWait(): void {
  if (stopWaitTimer) clearTimeout(stopWaitTimer);
  stopWaitTimer = null;
}
let pendingErrors: Array<{ id?: string; message: string }> = [];
const listeners = new Set<() => void>();

function set(patch: Partial<MeetingRecorderState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getState = (): MeetingRecorderState => state;
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ── 経過時間（Rust のレベルイベントで補正しつつ、イベント間は手元で進める） ──
let tick: ReturnType<typeof setInterval> | null = null;
let baseElapsed = 0;
let baseAt = 0;

function startTick(): void {
  stopTick();
  baseElapsed = state.elapsedMs;
  baseAt = Date.now();
  tick = setInterval(() => {
    if (state.phase === "recording") set({ elapsedMs: baseElapsed + (Date.now() - baseAt) });
  }, 1000);
}
function stopTick(): void {
  if (tick) clearInterval(tick);
  tick = null;
}

// ── Rust イベントの購読（初回だけ張る） ──
let unlisten: Array<() => void> = [];
let attaching: Promise<void> | null = null;

export function attachListeners(): Promise<void> {
  if (attaching) return attaching;
  attaching = (async () => {
    try {
      unlisten = await Promise.all([
        api.onLevel((e) => {
          if (state.phase !== "recording" || e.id !== state.id) return;
          baseElapsed = e.elapsedMs;
          baseAt = Date.now();
          set({ elapsedMs: e.elapsedMs, level: { system: e.system, mic: e.mic } });
        }),
        api.onError((e) => {
          if (state.id === null && state.phase === "starting") {
            pendingErrors.push({ id: e.id, message: e.message });
            return;
          }
          if (e.id !== state.id) return;
          set({ error: { kind: "failed", context: "recording", message: e.message } });
        }),
        api.onTranscribeSegment((e) => {
          appendLiveSegments(e.fileId, e.track, e.segments);
          onJobEvent(e.jobId, { kind: "segment", fileId: e.fileId, count: e.segments.length });
        }),
        api.onTranscribeProgress((e) => onJobEvent(e.jobId, { kind: "progress", ratio: e.ratio })),
        api.onTranscribeDone((e) => onJobEvent(e.jobId, { kind: "done", fileIds: e.fileIds })),
        api.onTranscribeError((e) => onJobEvent(e.jobId, { kind: "error", message: e.message })),
        api.onTranscribeCancelled((e) => onJobEvent(e.jobId, { kind: "cancelled" })),
        api.onStopped((e) => {
          if (e.result) {
            // Rust 側が停止まで済ませている。手動の止めると競合しても結果を捨てない
            const phaseOk =
              state.phase === "recording" || state.phase === "stopping" || state.phase === "error";
            if (!phaseOk || (e.id !== state.id && e.id !== lastId)) return;
            stopTick();
            clearStopWait();
            const adopted = adoptTranscribeJob(e.result.transcribeJobId, resultFileIds(e.result));
            set({
              ...adopted,
              ...(e.result.transcribeJobId ? { liveJobId: e.result.transcribeJobId } : {}),
              phase: "idle",
              id: null,
              result: e.result,
              ...stopBlockWrite(e.result),
              stopReason: e.reason,
              level: { system: 0, mic: 0 },
              error: null,
            });
            return;
          }
          if (e.id !== state.id || state.phase !== "recording") return;
          // 結果が無いときは録れた分を受け取るため停止を呼ぶ
          void stop(e.reason);
        }),
      ]);
    } catch (err) {
      attaching = null;
      console.warn("会議録音イベントの購読に失敗:", err);
    }
  })();
  return attaching;
}

const PENDING_WRITE_LIMIT = 20;
/** recordingId 単位で上書きして残す（直近 20 件まで。古いものから捨てる） */
function withBlockWrite(
  recordingId: string,
  patch: Partial<PendingBlockWrite>,
): Record<string, PendingBlockWrite> {
  const next = { ...state.pendingBlockWrites };
  const merged: PendingBlockWrite = { ...next[recordingId], ...patch, recordingId };
  delete next[recordingId]; // 末尾に入れ直して新しい順を保つ
  next[recordingId] = merged;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - PENDING_WRITE_LIMIT))) delete next[k];
  return next;
}

/** 停止結果のうち、ブロックへ書くもの（何も録れなければ ready に戻す。録れていれば長さ） */
function stopBlockWrite(result: MeetingRecStopResult): Pick<MeetingRecorderState, "pendingBlockWrites"> {
  if (!result.fileId) return { pendingBlockWrites: withBlockWrite(result.id, { reset: true, durationMs: undefined }) };
  return result.durationMs > 0
    ? { pendingBlockWrites: withBlockWrite(result.id, { durationMs: result.durationMs }) }
    : { pendingBlockWrites: state.pendingBlockWrites };
}

/** ブロックが書き込みを適用したら呼ぶ。start は開始情報、stop は長さ / reset を消す */
export function consumeBlockWrite(recordingId: string, part: "start" | "stop"): void {
  const cur = state.pendingBlockWrites[recordingId];
  if (!cur) return;
  const next: PendingBlockWrite = { ...cur };
  if (part === "start") delete next.start;
  else {
    delete next.durationMs;
    delete next.reset;
  }
  const rest = { ...state.pendingBlockWrites };
  if (!next.start && next.durationMs === undefined && !next.reset) delete rest[recordingId];
  else rest[recordingId] = next;
  set({ pendingBlockWrites: rest });
}

/** 録音中に届く発言を fileId ごとにためる（直近 5 録音まで。保存は素材側なのでここは表示用） */
const LIVE_FILE_LIMIT = 5;
function appendLiveSegments(fileId: string, track: "system" | "mic" | null, segs: MeetingTranscribeSegment[]): void {
  const added = segs.map((s) => ({ track, startMs: s.startMs, endMs: s.endMs, text: s.text }));
  const merged = sortSegments([...(state.liveSegments[fileId] ?? []), ...added]);
  const next: Record<string, TranscriptSegment[]> = { ...state.liveSegments };
  delete next[fileId]; // 末尾に入れ直して「新しい順」を保つ
  next[fileId] = merged;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - LIVE_FILE_LIMIT))) delete next[k];
  set({ liveSegments: next });
}

// ── 文字起こしジョブ（jobId ごと） ──
type JobEvent =
  | { kind: "segment"; fileId: string; count: number }
  | { kind: "progress"; ratio: number }
  | { kind: "done"; fileIds: string[] }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

/** adopt 前（start 応答より先）に届いたイベント。adopt 時に順に反映する */
const pendingByJob = new Map<string, JobEvent[]>();
/** 終端（done / error / cancelled）を迎えたジョブ。adopt しても running に戻さない */
const finishedJobs = new Set<string>();

const JOB_MEMORY_LIMIT = 50;
/** 終端済み jobId を記録する（直近 50 件。超えたら古い順に捨てる） */
function markFinished(jobId: string): void {
  finishedJobs.delete(jobId);
  finishedJobs.add(jobId);
  while (finishedJobs.size > JOB_MEMORY_LIMIT) finishedJobs.delete(finishedJobs.values().next().value as string);
}
function setPending(jobId: string, q: JobEvent[]): void {
  pendingByJob.delete(jobId);
  pendingByJob.set(jobId, q);
  while (pendingByJob.size > JOB_MEMORY_LIMIT) pendingByJob.delete(pendingByJob.keys().next().value as string);
}

function applyJobEvent(job: MeetingTranscribeState, ev: JobEvent): MeetingTranscribeState {
  if (job.status !== "running") return job; // 最初の終端だけを採用する
  switch (ev.kind) {
    case "segment":
      return {
        ...job,
        segmentCount: job.segmentCount + ev.count,
        fileIds: job.fileIds.includes(ev.fileId) ? job.fileIds : [...job.fileIds, ev.fileId],
      };
    case "progress":
      return { ...job, ratio: ev.ratio };
    case "done":
      return { ...job, status: "done", ratio: 1, fileIds: ev.fileIds };
    case "error":
      return { ...job, status: "failed", message: ev.message };
    case "cancelled":
      return { ...job, status: "cancelled" };
  }
}

/** そのファイルの新しいジョブが始まるとき: 前回の発言（live）と終わり方を手放す */
function resetFilesForNewJob(fileIds: string[]): Partial<MeetingRecorderState> {
  const liveSegments = { ...state.liveSegments };
  const lastJobByFile = { ...state.lastJobByFile };
  for (const f of fileIds) {
    delete liveSegments[f];
    delete lastJobByFile[f];
  }
  return { liveSegments, lastJobByFile };
}

function onJobEvent(jobId: string, ev: JobEvent): void {
  const job = state.transcribes[jobId];
  if (job) {
    const next = applyJobEvent(job, ev);
    if (next !== job) {
      let lastJobByFile = state.lastJobByFile;
      if (next.status !== "running") {
        markFinished(jobId);
        // 録音由来のジョブは、segment が 1 件も無いまま失敗しても録音の fileId に結びつける
        const files = new Set(next.fileIds);
        if (jobId === state.liveJobId && state.startInfo) files.add(state.startInfo.fileId);
        lastJobByFile = { ...lastJobByFile };
        for (const f of files) lastJobByFile[f] = next.status;
      }
      set({ transcribes: { ...state.transcribes, [jobId]: next }, lastJobByFile });
    }
    return;
  }
  if (finishedJobs.has(jobId)) return;
  const q = pendingByJob.get(jobId) ?? [];
  // 終端は最初の 1 つだけためる
  const hasTerminal = q.some((x) => x.kind === "done" || x.kind === "error" || x.kind === "cancelled");
  if (hasTerminal && (ev.kind === "done" || ev.kind === "error" || ev.kind === "cancelled" || ev.kind === "segment")) return;
  setPending(jobId, [...q, ev]);
}

/** ジョブを状態に取り込む（状態の差分を返す。先に届いたイベントを反映し、終端済みなら running にしない） */
function adoptTranscribeJob(
  jobId: string | null | undefined,
  fileIds: string[] = [],
): Partial<MeetingRecorderState> {
  if (!jobId) return {};
  if (state.transcribes[jobId]) return {};
  if (finishedJobs.has(jobId)) return {};
  let job: MeetingTranscribeState = { jobId, status: "running", ratio: 0, segmentCount: 0, fileIds };
  for (const ev of pendingByJob.get(jobId) ?? []) job = applyJobEvent(job, ev);
  pendingByJob.delete(jobId);
  if (job.status !== "running") markFinished(jobId);
  return { transcribes: { ...state.transcribes, [jobId]: job } };
}

/** 既存録音の文字起こしを始める（素材のプレビューから） */
export async function startTranscribeFor(fileIds: string[]): Promise<boolean> {
  void attachListeners();
  const ms = getMeetingSettings();
  try {
    const { jobId } = await api.startTranscribe({ fileIds, language: ms.language, modelSize: ms.modelSize });
    set({ ...resetFilesForNewJob(fileIds), ...adoptTranscribeJob(jobId, fileIds) });
    return true;
  } catch (err) {
    const key = `failed-${Date.now()}`;
    markFinished(key);
    set({
      transcribes: {
        ...state.transcribes,
        [key]: { jobId: key, status: "failed", ratio: 0, segmentCount: 0, fileIds, message: String(err) },
      },
    });
    return false;
  }
}

/** 終わったジョブに出すトーストの文言キー。取り消し・保存対象なしは出さない（null） */
export function transcribeToastKey(job: MeetingTranscribeState): "meeting.transcribeSaved" | "meeting.transcribeFailed" | null {
  if (job.status === "done") return job.fileIds.length > 0 ? "meeting.transcribeSaved" : null;
  if (job.status === "failed") return "meeting.transcribeFailed";
  return null;
}

/** 終わったジョブ（done / failed / cancelled）の表示を手放す（トースト表示後） */
export function clearTranscribe(jobId: string): void {
  const job = state.transcribes[jobId];
  if (!job || job.status === "running") return;
  const { [jobId]: _gone, ...rest } = state.transcribes;
  set({ transcribes: rest });
}

/** 起動直後・再読込後に Rust 側が録音中なら状態を合わせる */
export async function syncStatus(): Promise<void> {
  try {
    const s = await api.getStatus();
    if (s.recording && s.id && state.phase === "idle") {
      lastId = s.id;
      set({ phase: "recording", id: s.id, elapsedMs: s.elapsedMs ?? 0 });
      startTick();
    }
  } catch {
    // 状態が取れなくても UI は idle のまま続ける
  }
}

/** 「会議を録る」押下: 権限を確認して確認ダイアログを開く */
export async function openConfirm(): Promise<void> {
  if (state.phase !== "idle" && state.phase !== "error") return;
  void attachListeners();
  set({ phase: "confirming", error: null, stopReason: null, permission: null });
  try {
    const permission = await api.getPermission({ request: false, captureSystem: state.captureSystem });
    if (getState().phase === "confirming") set({ permission });
  } catch {
    // 権限が読めなくても開始は試せる（失敗は start 側で拾う）
  }
}

/** 「相手の声も録る」の切り替え（確認ダイアログ）。権限の表示を新しい条件で読み直す */
export function setCaptureSystem(value: boolean): void {
  if (state.captureSystem === value) return;
  set({ captureSystem: value });
  if (state.phase !== "confirming") return;
  api
    .getPermission({ request: false, captureSystem: value })
    .then((permission) => {
      if (getState().phase === "confirming" && state.captureSystem === value) set({ permission });
    })
    .catch(() => {});
}

export function cancelConfirm(): void {
  if (state.phase === "confirming") set({ phase: "idle", permission: null, blockStart: null });
}

/** 録音の始まりを呼び出し側（ブロック）に返す形 */
export type StartedRecording = { id: string; fileId: string; startedAt: string };

/**
 * 文字起こしブロックの「録音を始める」: 権限を確認して録音を始め、始まったらその情報を返す。
 * 権限が拒否されたときは従来のダイアログ（error 状態）が案内を出し、null を返す。
 * 始まった録音は startInfo.attachToBlockId に印が付き、MeetingRecorderMount は差し込みをしない
 * （ブロック自身が props を埋める）。
 */
export async function startFromBlock(blockId: string): Promise<StartedRecording | null> {
  if (state.phase === "error") dismissError();
  if (state.phase !== "idle" && state.phase !== "confirming") return null;
  await start(blockId);
  const info = getState().startInfo;
  if (getState().phase !== "recording" || !info || info.attachToBlockId !== blockId) return null;
  return { id: info.id, fileId: info.fileId, startedAt: info.startedAt };
}

export async function start(attachToBlockId?: string): Promise<void> {
  if (state.phase !== "confirming" && state.phase !== "idle") return;
  pendingErrors = [];
  set({ phase: "starting", error: null, blockStart: attachToBlockId ?? null });
  void attachListeners();
  try {
    const captureSystem = state.captureSystem;
    const permission = await api.getPermission({ request: true, captureSystem });
    // 相手の声を録らないときは画面収録の権限を見ない
    if (captureSystem && permission.screen === "denied") {
      set({ phase: "error", permission, error: { kind: "permissionDenied", context: "start" } });
      return;
    }
    const ms = getMeetingSettings();
    const r = await api.startRecording({
      captureSystem,
      liveTranscribe: ms.liveTranscribe,
      language: ms.language,
      modelSize: ms.modelSize,
    });
    // start 応答より先に届いたエラーのうち、この録音のもの（または id 無し）だけ反映する
    const early = pendingErrors.filter((p) => p.id === undefined || p.id === r.id);
    pendingErrors = [];
    lastId = r.id;
    set({
      error: early.length
        ? { kind: "failed", context: "recording", message: early[early.length - 1].message }
        : null,
      phase: "recording",
      id: r.id,
      elapsedMs: 0,
      level: { system: 0, mic: 0 },
      result: null,
      stopReason: null,
      ...resetFilesForNewJob([r.fileId]),
      ...adoptTranscribeJob(r.transcribeJobId),
      liveJobId: r.transcribeJobId ?? null,
      permission,
      startInfo: { id: r.id, fileId: r.fileId, startedAt: r.startedAt, captureSystem, ...(attachToBlockId ? { attachToBlockId } : {}) },
      blockStart: null,
      ...(attachToBlockId
        ? {
            pendingBlockWrites: withBlockWrite(r.id, {
              blockId: attachToBlockId,
              start: { fileId: r.fileId, startedAt: r.startedAt },
            }),
          }
        : {}),
    });
    startTick();
  } catch (err) {
    pendingErrors = [];
    set({ phase: "error", error: { kind: "failed", context: "start", message: String(err) } });
  }
}

export async function stop(reason: "limit" | "error" | null = null): Promise<void> {
  if (state.phase !== "recording") return;
  stopTick();
  set({ phase: "stopping" });
  try {
    const result = await api.stopRecording();
    // 待っている間に上限側の stopped で採用済みなら何もしない
    if (getState().phase !== "stopping") return;
    clearStopWait();
    const adopted = adoptTranscribeJob(result.transcribeJobId, resultFileIds(result));
    set({
      ...adopted,
      ...(result.transcribeJobId ? { liveJobId: result.transcribeJobId } : {}),
      phase: "idle",
      id: null,
      result,
      ...stopBlockWrite(result),
      stopReason: reason,
      level: { system: 0, mic: 0 },
      error: null,
    });
  } catch (err) {
    if (getState().phase !== "stopping") return;
    if (String(err).includes("not recording")) {
      // 上限側が先に止めた。stopped{result} が届くのを待つ（来なければ失敗として扱う）
      clearStopWait();
      stopWaitTimer = setTimeout(() => {
        stopWaitTimer = null;
        if (getState().phase !== "stopping") return;
        set({ phase: "error", id: null, error: { kind: "failed", context: "stop", message: String(err) } });
      }, STOP_WAIT_MS);
      return;
    }
    set({ phase: "error", id: null, error: { kind: "failed", context: "stop", message: String(err) } });
  }
}

/** エラー表示を閉じて idle に戻す */
export function dismissError(): void {
  if (state.phase === "error") set({ phase: "idle", error: null, blockStart: null });
}

/** 素材登録を終えた結果を手放す（二重登録防止） */
export function clearResult(): void {
  if (state.result) set({ result: null });
}

/** テスト用: 初期状態へ戻す */
export function __resetForTest(): void {
  stopTick();
  unlisten.forEach((u) => u());
  unlisten = [];
  attaching = null;
  pendingErrors = [];
  lastId = null;
  pendingByJob.clear();
  finishedJobs.clear();
  clearStopWait();
  state = INITIAL;
  listeners.forEach((l) => l());
}
