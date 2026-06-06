// Tauri sidecar（バックエンドサーバー）のライフサイクル管理
// Tauri 環境でのみ使用される
//
// 経路:
//   1. Rust 側の `start_native_sidecar` Tauri command で node を spawn する
//      （Tauri Shell プラグインを介さない経路）。
//   2. stdout/stderr/exit は Rust 側で `sidecar-log` / `sidecar-closed`
//      イベントとして emit され、ここで listen → recordLog する。
//
// Windows での Tauri Shell の挙動（spawn 成功・出力 0 行・close 飛ばず）を
// 避けるためにこの設計。Mac でも同経路を使う（OS で分岐しない）。

import { isTauri } from "./platform";

const HEALTH_URL = "http://localhost:3001/api/health";
const SIDECAR_PORT = 3001;
const MAX_RETRIES = 20;
const RETRY_INTERVAL_MS = 500;

export type SidecarStatus = "idle" | "starting" | "ready" | "failed";

export type SidecarState = {
  status: SidecarStatus;
  lastError: string | null;
  lastErrorAt: number | null;
};

let recentLogLines: string[] = [];
const RECENT_LOG_LIMIT = 80;
// Rust 側 event listener の cleanup。startSidecar を複数回呼んだ場合に
// 古い listener を解除するため。
let logUnlisten: (() => void) | null = null;
let closedUnlisten: (() => void) | null = null;
// 現在の sidecar PID（Rust 側に保持されているもののコピー）。
let currentPid: number | null = null;

const state: SidecarState = {
  status: "idle",
  lastError: null,
  lastErrorAt: null,
};

type Listener = (s: SidecarState) => void;
const listeners = new Set<Listener>();

function setState(patch: Partial<SidecarState>): void {
  Object.assign(state, patch);
  for (const l of listeners) l({ ...state });
}

function recordLog(line: string): void {
  recentLogLines.push(line);
  if (recentLogLines.length > RECENT_LOG_LIMIT) {
    recentLogLines = recentLogLines.slice(-RECENT_LOG_LIMIT);
  }
}

/** 現在の sidecar 状態を取得 */
export function getSidecarState(): SidecarState {
  return { ...state };
}

/** sidecar 起動失敗時の直近ログ（spawn の stderr/stdout） */
export function getRecentSidecarLog(): string[] {
  return [...recentLogLines];
}

/** 状態変化を購読する。返り値は解除関数 */
export function subscribeSidecarState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** sidecar サーバーのヘルスチェック */
async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  return false;
}

/** sidecar サーバーを起動する */
export async function startSidecar(): Promise<boolean> {
  if (!isTauri()) return false;

  setState({ status: "starting", lastError: null, lastErrorAt: null });
  recentLogLines = [];

  const { appDataDir, join: pathJoin } = await import("@tauri-apps/api/path");
  // sidecar のデータディレクトリは Application Support 配下（macOS なら
  // ~/Library/Application Support/com.graphium.app/server-data）。
  // 以前は ~/Documents/Graphium/server-data を使っていたが、macOS Sequoia の
  // TCC で Documents フォルダへのアクセスが拒否されたケースで sidecar が
  // models.json / profiles.json を読めなくなる事象があったため、ユーザー操作
  // 不要な Application Support に移した。旧 path からの自動移行は sidecar 側
  // (src/server/config/migration.ts) で行う。
  const appData = await appDataDir();
  const dataDir = await pathJoin(appData, "server-data");

  // アプリ本体のバージョン。sidecar の /api/health が返す version と照合して
  // 「自動更新前の古い自分」を検知する。取得に失敗した場合は version 照合を
  // 諦め、従来どおり dataDir だけで判定する（誤って現行 sidecar を kill しない）。
  let expectedVersion = "";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    expectedVersion = await getVersion();
  } catch {
    expectedVersion = "";
  }

  // 既にサーバーが動いている場合の扱い:
  //   - dataDir も version も一致 → 自分の現行 sidecar。再利用する。
  //   - dataDir 不一致 → 他人 sidecar（消えた worktree の幽霊 / 別 dev サーバー）。
  //   - version 不一致 → 自動更新前の「古い自分」。port 3001 を握ったままなので、
  //     後から追加した API ルートが 404 になる（v0.15.0 の /api/translate）。
  // 不一致はいずれも SIGTERM して自前を spawn し直す。
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      const remoteDataDir = typeof body?.dataDir === "string" ? body.dataDir : "";
      const remotePid = typeof body?.pid === "number" ? body.pid : 0;
      const remoteVersion = typeof body?.version === "string" ? body.version : "";
      const sameDataDir = remoteDataDir === dataDir;
      const sameVersion = expectedVersion === "" || remoteVersion === expectedVersion;
      if (sameDataDir && sameVersion) {
        console.log("[sidecar] Backend already running (matching dataDir + version)");
        // 再利用する sidecar の PID を控える。これがないと終了時に kill 対象が
        // 分からず孤児として残り、次回起動で再利用される（今回の 404 の一因）。
        currentPid = remotePid > 0 ? remotePid : null;
        setState({ status: "ready" });
        return true;
      }
      const reason = !sameDataDir
        ? `foreign dataDir=${remoteDataDir || "?"} (expected ${dataDir})`
        : `stale version=${remoteVersion || "?"} (expected ${expectedVersion})`;
      console.warn(
        `[sidecar] Replacing sidecar on 3001 (pid=${remotePid}, ${reason}). Killing.`,
      );
      recordLog(
        `Replacing sidecar on 3001 (pid=${remotePid}, ${reason}). Sending SIGTERM.`,
      );
      if (remotePid > 0) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("kill_pid", { pid: remotePid });
          // SIGTERM が反映されるまで最大 2 秒待つ
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 200));
            try {
              const probe = await fetch(HEALTH_URL);
              if (!probe.ok) break;
            } catch {
              break; // port 3001 が応答しなくなった = kill 成功
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[sidecar] kill_pid failed:", e);
          recordLog(`kill_pid failed: ${msg}`);
        }
      }
    }
  } catch {
    // 起動されていない → sidecar を起動する
  }

  // Rust 側の start_native_sidecar に切り替え。Tauri Shell プラグインを介さず、
  // std::process::Command で直接 node を spawn して stdout/stderr/exit を
  // Tauri event で renderer に流す。Windows での「spawn 成功・出力 0 行・close
  // 飛ばず」症状を回避するための変更。
  //
  // exit ref を let で持つと TS のクロージャ内代入 narrowing で never になるので
  // オブジェクト参照経由で持つ。
  const exitRef: { info: string | null } = { info: null };

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    recordLog(`[lifecycle] dataDir: ${dataDir}`);

    // 古い listener が残っていたら解除（再起動時の重複防止）
    if (logUnlisten) {
      try { logUnlisten(); } catch { /* noop */ }
      logUnlisten = null;
    }
    if (closedUnlisten) {
      try { closedUnlisten(); } catch { /* noop */ }
      closedUnlisten = null;
    }

    // Rust 側から流れてくる sidecar-log を recordLog に流す。
    // payload は文字列 1 行。
    logUnlisten = await listen<string>("sidecar-log", (event) => {
      const line = typeof event.payload === "string" ? event.payload : String(event.payload);
      recordLog(line);
    });
    closedUnlisten = await listen<string>("sidecar-closed", (event) => {
      const detail = typeof event.payload === "string" ? event.payload : String(event.payload);
      exitRef.info = detail;
      recordLog(`[lifecycle] process closed ${detail}`);
    });

    recordLog(`[lifecycle] invoking start_native_sidecar ...`);
    try {
      const pid = await invoke<number>("start_native_sidecar", {
        dataDir,
        port: SIDECAR_PORT,
      });
      currentPid = pid;
      recordLog(`[lifecycle] start_native_sidecar returned pid=${pid}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLog(`[lifecycle] start_native_sidecar threw: ${msg}`);
      throw e;
    }

    console.log("[sidecar] Starting backend server...");
    const healthy = await waitForHealth();
    if (healthy) {
      console.log("[sidecar] Backend server is ready");
      setState({ status: "ready" });
    } else {
      console.warn("[sidecar] Backend server failed to start");
      // exit イベントを観測していれば、その内容を lastError に含める。
      const exitDetail = exitRef.info
        ? `（プロセスは既に ${exitRef.info} で終了）`
        : "";
      setState({
        status: "failed",
        lastError: `ヘルスチェックがタイムアウトしました（10 秒以内に応答なし）${exitDetail}`,
        lastErrorAt: Date.now(),
      });
    }
    return healthy;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sidecar] Failed to spawn:", e);
    recordLog(`[lifecycle] spawn threw: ${message}`);
    setState({ status: "failed", lastError: message, lastErrorAt: Date.now() });
    return false;
  }
}

/** sidecar サーバーが生きているか確認し、死んでいたら再起動 */
export async function ensureSidecar(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) {
      setState({ status: "ready" });
      return true;
    }
  } catch {
    // 応答なし → 再起動を試みる
  }
  console.warn("[sidecar] Backend not responding, attempting restart...");
  currentPid = null;
  return startSidecar();
}

/** sidecar を明示的に再起動する（UI からのトリガー用） */
export async function restartSidecar(): Promise<boolean> {
  if (!isTauri()) return false;
  await stopSidecar();
  return startSidecar();
}

/** sidecar サーバーを停止する */
export async function stopSidecar(): Promise<void> {
  if (currentPid != null) {
    const pid = currentPid;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // 自分が spawn した sidecar は Rust 側の NativeSidecarState 経由で kill する。
      await invoke("stop_native_sidecar");
      // 再利用した sidecar（前セッションが spawn したもの）は Rust 側が PID を
      // 控えていないため stop_native_sidecar では落ちない。フロントが控えている
      // PID へ直接 SIGTERM を送ってフォールバックする（既に死んでいれば無視）。
      try {
        await invoke("kill_pid", { pid });
      } catch {
        /* 既に終了している場合は何もしない */
      }
      console.log("[sidecar] Backend server stop requested");
    } catch (e) {
      console.error("[sidecar] Failed to stop:", e);
    }
    currentPid = null;
  }
  if (logUnlisten) {
    try { logUnlisten(); } catch { /* noop */ }
    logUnlisten = null;
  }
  if (closedUnlisten) {
    try { closedUnlisten(); } catch { /* noop */ }
    closedUnlisten = null;
  }
  setState({ status: "idle" });
}
