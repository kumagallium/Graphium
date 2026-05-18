// Tauri sidecar（バックエンドサーバー）のライフサイクル管理
// Tauri 環境でのみ使用される

import { isTauri } from "./platform";

const HEALTH_URL = "http://localhost:3001/api/health";
const MAX_RETRIES = 20;
const RETRY_INTERVAL_MS = 500;

type SidecarChild = {
  kill: () => Promise<void>;
};

export type SidecarStatus = "idle" | "starting" | "ready" | "failed";

export type SidecarState = {
  status: SidecarStatus;
  lastError: string | null;
  lastErrorAt: number | null;
};

let sidecarProcess: SidecarChild | null = null;
let recentLogLines: string[] = [];
const RECENT_LOG_LIMIT = 20;

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

  const { documentDir, join: pathJoin } = await import("@tauri-apps/api/path");
  // データディレクトリを明示的に指定（process.cwd() の不安定さを回避）
  const docsDir = await documentDir();
  const dataDir = await pathJoin(docsDir, "Graphium", "server-data");

  // 既にサーバーが動いている場合はスキップ（dev モードで別途起動済みなど）。
  // ただし `/api/health` の dataDir が期待値と一致しなければ "他人 sidecar"
  // （消えた worktree の幽霊など）として SIGTERM し、自前を spawn し直す。
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      const remoteDataDir = typeof body?.dataDir === "string" ? body.dataDir : "";
      const remotePid = typeof body?.pid === "number" ? body.pid : 0;
      if (remoteDataDir === dataDir) {
        console.log("[sidecar] Backend already running (matching dataDir)");
        setState({ status: "ready" });
        return true;
      }
      console.warn(
        `[sidecar] Foreign sidecar on 3001 (pid=${remotePid}, dataDir=${remoteDataDir || "?"}). Killing.`,
      );
      recordLog(
        `Foreign sidecar detected (pid=${remotePid}, dataDir=${remoteDataDir || "?"}). Expected ${dataDir}. Sending SIGTERM.`,
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

  // ライフサイクルを追跡できるよう、stdout/stderr 以外に
  // spawn / close / error イベントも記録する。Windows の Node sidecar が
  // 即死したのに stdout/stderr が空のまま終わるケース（Tauri Shell の
  // 出力リスナーが接続される前に exit する）を見えるようにするため。
  //
  // `let` だとクロージャ内代入を TS が無視して never に narrow するので、
  // オブジェクト参照経由で持たせる。
  const exitRef: { info: { code: number | null; signal: string | null } | null } = { info: null };

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const { resolveResource } = await import("@tauri-apps/api/path");

    // sidecar バイナリ自体は Node.js 本体のリネームコピー（fetch-node.mjs で配置）。
    // そのため第一引数として server.mjs の絶対パスを渡す必要がある。
    // resolveResource は dev/production の両方で適切なパスを返す:
    //   - production: <bundle>/Resources/sidecar/server.mjs (mac) /
    //                 <install>/resources/sidecar/server.mjs (win)
    //   - dev:        <project>/src-tauri/sidecar/server.mjs
    let serverScript: string;
    try {
      serverScript = await resolveResource("sidecar/server.mjs");
      recordLog(`[lifecycle] resolved server.mjs -> ${serverScript}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLog(`[lifecycle] resolveResource failed: ${msg}`);
      throw e;
    }

    recordLog(`[lifecycle] dataDir: ${dataDir}`);

    const command = Command.sidecar("binaries/graphium-server", [serverScript], {
      env: {
        PORT: "3001",
        CORS_ORIGINS: "http://localhost:5174,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
        DATA_DIR: dataDir,
      },
    });

    command.stdout.on("data", (line: string) => {
      console.log(`[sidecar] ${line}`);
      recordLog(`[stdout] ${line}`);
    });
    command.stderr.on("data", (line: string) => {
      console.error(`[sidecar] ${line}`);
      recordLog(`[stderr] ${line}`);
    });
    // 子プロセス終了イベント。stdout/stderr が空でも、ここで exit code が分かる。
    // @tauri-apps/plugin-shell v2 の close payload は { code: number|null, signal: number|null }。
    // CommandEvents 型から推論されるので注釈は付けない（付けると never に narrowing される）。
    command.on("close", (payload) => {
      const code = payload.code;
      const signal = payload.signal != null ? String(payload.signal) : null;
      exitRef.info = { code, signal };
      recordLog(`[lifecycle] process closed code=${code ?? "null"}${signal ? ` signal=${signal}` : ""}`);
    });
    // error は string（CommandEvents 型）。
    command.on("error", (err) => {
      recordLog(`[lifecycle] process error: ${err}`);
    });

    recordLog(`[lifecycle] spawning binaries/graphium-server ...`);
    const child = await command.spawn();
    sidecarProcess = child;
    recordLog(`[lifecycle] spawned (pid=${child.pid ?? "?"})`);

    console.log("[sidecar] Starting backend server...");
    const healthy = await waitForHealth();
    if (healthy) {
      console.log("[sidecar] Backend server is ready");
      setState({ status: "ready" });
    } else {
      console.warn("[sidecar] Backend server failed to start");
      // 既に exit イベントを観測していれば、その exit code を lastError に含める。
      // stdout/stderr が空のままタイムアウトする Windows ケースで、即死だったのか
      // 単に起動が遅いのか切り分けられるようにする。
      const info = exitRef.info;
      const exitDetail = info
        ? `（プロセスは既に exit code=${info.code ?? "null"}${info.signal ? ` signal=${info.signal}` : ""} で終了）`
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
  sidecarProcess = null;
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
  if (sidecarProcess) {
    try {
      await sidecarProcess.kill();
      console.log("[sidecar] Backend server stopped");
    } catch (e) {
      console.error("[sidecar] Failed to stop:", e);
    }
    sidecarProcess = null;
  }
  setState({ status: "idle" });
}
