// PWA（ホーム画面に追加した Web 版）の更新の状態を画面に伝える小さなストア。
//
// service worker は vite-plugin-pwa の autoUpdate で登録している。新しい版は裏で
// 取り込まれてすぐ有効になるが、開いている画面は古いコードのまま残る。iOS の
// ホーム画面アプリは裏で生き続けるので、利用者は古い版を使い続けやすい。
// ここでは service worker の仕組みは変えず、次の 2 つだけを足す:
//   1. 新しい版が有効になったことを検知して「読み込み直す」を促せるようにする
//   2. 画面に戻ってきたとき・手で頼まれたときに、新しい版が無いか確かめる
//
// 読み込み直しは必ず利用者のタップで行う（入力中のメモを勝手に消さない）。

import { useSyncExternalStore } from "react";
import { isTauri } from "./platform";

export type PwaUpdatePhase =
  /** まだ確かめていない */
  | "idle"
  /** 新しい版が無いか確かめている */
  | "checking"
  /** 新しい版を取り込んでいる */
  | "downloading"
  /** 確かめた結果、いまの版が最新だった */
  | "upToDate"
  /** 確かめられなかった（オフラインなど） */
  | "failed";

export type PwaUpdateState = {
  /** service worker が登録されている環境か（dev・デスクトップ版では false） */
  supported: boolean;
  phase: PwaUpdatePhase;
  /** 新しい版が有効になり、読み込み直せば切り替わる状態か */
  updateReady: boolean;
};

/** 画面に戻ってきたときの自動確認の最短間隔 */
const AUTO_CHECK_INTERVAL_MS = 60 * 1000;

const INITIAL_STATE: PwaUpdateState = { supported: false, phase: "idle", updateReady: false };

let state: PwaUpdateState = INITIAL_STATE;
let started = false;
let hadController = false;
let lastCheckAt = 0;
let teardown: (() => void) | null = null;
const listeners = new Set<() => void>();
const watched = new WeakSet<ServiceWorker>();

function setState(patch: Partial<PwaUpdateState>): void {
  const next = { ...state, ...patch };
  if (
    next.supported === state.supported &&
    next.phase === state.phase &&
    next.updateReady === state.updateReady
  ) {
    return;
  }
  state = next;
  for (const l of listeners) l();
}

function getContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  if (isTauri()) return null;
  return navigator.serviceWorker ?? null;
}

function markReady(): void {
  setState({ updateReady: true, phase: "idle" });
}

/** 取り込み中の worker を見張り、有効になったら「読み込み直せる」にする */
function watchWorker(worker: ServiceWorker | null): void {
  if (!worker || watched.has(worker)) return;
  watched.add(worker);
  if (!state.updateReady) setState({ phase: "downloading" });
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated") {
      // 初回の導入（それまで service worker が無かった）は更新ではない
      if (hadController) markReady();
      else setState({ phase: "idle" });
      hadController = true;
    } else if (worker.state === "redundant" && state.phase === "downloading") {
      setState({ phase: "failed" });
    }
  });
}

function attachRegistration(reg: ServiceWorkerRegistration): void {
  setState({ supported: true });
  watchWorker(reg.installing);
  watchWorker(reg.waiting);
  reg.addEventListener("updatefound", () => watchWorker(reg.installing));
}

/**
 * 新しい版が無いか確かめる。見つかれば取り込みが始まり、有効になった時点で
 * `updateReady` が立つ。
 */
export async function checkForPwaUpdate(): Promise<void> {
  const container = getContainer();
  if (!container) return;
  if (state.phase === "checking" || state.phase === "downloading") return;
  lastCheckAt = Date.now();
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await container.getRegistration();
  } catch {
    reg = undefined;
  }
  if (!reg) return;
  attachRegistration(reg);
  if (state.updateReady) return;
  setState({ phase: "checking" });
  try {
    await reg.update();
  } catch {
    setState({ phase: "failed" });
    return;
  }
  if (reg.installing || reg.waiting) {
    watchWorker(reg.installing);
    watchWorker(reg.waiting);
    return;
  }
  // 取り込みが update() の解決より先に終わった場合は updateReady が立っている
  // （await をまたぐと state は書き換わりうるので、読み直して判定する）
  const now = getSnapshot();
  if (!now.updateReady && now.phase === "checking") setState({ phase: "upToDate" });
}

/** 画面を読み込み直して新しい版に切り替える。必ず利用者の操作から呼ぶ */
export function reloadForPwaUpdate(): void {
  window.location.reload();
}

/** 見張りを始める。何度呼んでも 1 回だけ動く */
export function startPwaUpdateWatch(): void {
  if (started) return;
  const container = getContainer();
  if (!container) return;
  started = true;
  hadController = container.controller != null;

  const onControllerChange = () => {
    // 初回の導入で制御が始まっただけなら、古い画面ではない
    if (hadController) markReady();
    hadController = true;
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastCheckAt < AUTO_CHECK_INTERVAL_MS) return;
    void checkForPwaUpdate();
  };
  container.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", onVisible);
  teardown = () => {
    container.removeEventListener("controllerchange", onControllerChange);
    document.removeEventListener("visibilitychange", onVisible);
  };

  void container
    .getRegistration()
    .then((reg) => {
      if (reg) attachRegistration(reg);
    })
    .catch(() => {
      // 登録が読めない環境では何もしない
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PwaUpdateState {
  return state;
}

/** 更新の状態を読む。初めて使われた時点で見張りを始める */
export function usePwaUpdate(): PwaUpdateState {
  return useSyncExternalStore(
    (listener) => {
      startPwaUpdateWatch();
      return subscribe(listener);
    },
    getSnapshot,
    () => INITIAL_STATE,
  );
}

/** テスト用: 状態と見張りを初期化する */
export function __resetPwaUpdateForTest(): void {
  teardown?.();
  teardown = null;
  started = false;
  hadController = false;
  lastCheckAt = 0;
  state = INITIAL_STATE;
  listeners.clear();
}
