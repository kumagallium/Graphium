// 会議録音: モジュールレベルのストア（useSyncExternalStore 用）
//
// サイドバーのボタンと画面下のバーが props なしで同じ状態を見るため、React の外に持つ。
// 状態機械: idle → confirming → starting → recording → stopping → idle（+ error）

import * as api from "./api";
import type { MeetingRecorderState } from "./types";

const INITIAL: MeetingRecorderState = {
  phase: "idle",
  id: null,
  elapsedMs: 0,
  level: { system: 0, mic: 0 },
  result: null,
  stopReason: null,
  error: null,
  permission: null,
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
        api.onStopped((e) => {
          if (e.result) {
            // Rust 側が停止まで済ませている。手動の止めると競合しても結果を捨てない
            const phaseOk =
              state.phase === "recording" || state.phase === "stopping" || state.phase === "error";
            if (!phaseOk || (e.id !== state.id && e.id !== lastId)) return;
            stopTick();
            clearStopWait();
            set({
              phase: "idle",
              id: null,
              result: e.result,
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
    const permission = await api.getPermission({ request: false });
    if (getState().phase === "confirming") set({ permission });
  } catch {
    // 権限が読めなくても開始は試せる（失敗は start 側で拾う）
  }
}

export function cancelConfirm(): void {
  if (state.phase === "confirming") set({ phase: "idle", permission: null });
}

export async function start(): Promise<void> {
  if (state.phase !== "confirming" && state.phase !== "idle") return;
  pendingErrors = [];
  set({ phase: "starting", error: null });
  void attachListeners();
  try {
    const permission = await api.getPermission({ request: true });
    if (permission.screen === "denied") {
      set({ phase: "error", permission, error: { kind: "permissionDenied", context: "start" } });
      return;
    }
    const r = await api.startRecording();
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
      permission,
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
    set({
      phase: "idle",
      id: null,
      result,
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
  if (state.phase === "error") set({ phase: "idle", error: null });
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
  clearStopWait();
  state = INITIAL;
  listeners.forEach((l) => l());
}
