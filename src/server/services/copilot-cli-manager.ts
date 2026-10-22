// GitHub Copilot CLI の取得（公式配布物・固定版・SHA256 検証）とログインの管理
//
// 設定 → AI の「Copilot に接続」ボタンの裏側。使える既存 CLI が無いときに
// 公式 GitHub Releases から固定版を <dataDir>/tools/copilot-cli/<版>/ へ置き、
// `copilot login` を子プロセスとして起動して承認用の URL / コードを拾う。
// 状態（取得の進捗・ログインの進行）はこのモジュール内に持つ。

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type { CopilotCliErrorCode } from "../../lib/ai-error-codes.js";
import {
  buildCopilotEnv,
  resetCopilotCliCache,
  resolveCopilotBinaryAsync,
  type CopilotCliSource,
} from "./cli-binary-resolver.js";
import {
  COPILOT_CLI_VERSION,
  copilotBinName,
  managedCopilotCliDir,
  managedCopilotCliRoot,
} from "./copilot-cli-location.js";

/** 公式配布物 1 件の定義 */
export type CopilotAsset = { asset: string; sha256: string };

/** プラットフォーム（`<platform>-<arch>`）ごとの配布物。Graphium の配布対象だけ載せる */
export const COPILOT_ASSETS: Record<string, CopilotAsset> = {
  "darwin-arm64": {
    asset: "copilot-darwin-arm64.tar.gz",
    sha256: "efce4325f7fd95945ef42f552ff7832f281307b2c63541b23f9b257e171bfe32",
  },
  "win32-x64": {
    asset: "copilot-win32-x64.zip",
    sha256: "5480aa1cc8047ca7ca2acf2da9cf54887d4a3dfcb5cf3d9ef2fe2bb1ce98f368",
  },
};

const DEFAULT_BASE_URL = "https://github.com/github/copilot-cli/releases/download";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_VERIFICATION_URI = "https://github.com/login/device";

export type LoginMode = "web" | "device";

export type LoginState = {
  state: "idle" | "waiting" | "succeeded" | "failed";
  mode: LoginMode | null;
  verificationUri: string | null;
  userCode: string | null;
  error: string | null;
};

export type CopilotStatus = {
  cli: "ready" | "missing" | "installing";
  source: CopilotCliSource | null;
  installable: boolean;
  install: { received: number; total: number } | null;
  installError: string | null;
  login: LoginState;
};

/** code 付きのエラー（ルートが HTTP ステータスへ変換する） */
export class CopilotCliError extends Error {
  readonly code: CopilotCliErrorCode;
  constructor(message: string, code: CopilotCliErrorCode) {
    super(message);
    this.name = "CopilotCliError";
    this.code = code;
  }
}

type SpawnFn = typeof spawn;

/** テストから差し替えられる依存 */
export type CopilotCliManagerDeps = {
  version: string;
  baseUrl: string;
  assets: Record<string, CopilotAsset>;
  platform: NodeJS.Platform;
  arch: string;
  fetch: typeof fetch;
  spawn: SpawnFn;
  /** ログイン用に CLI のパスを解決する */
  resolveCli: () => Promise<{ path: string; source: CopilotCliSource } | undefined>;
  /** ログイン子プロセスの env */
  buildEnv: (cliPath: string) => Record<string, string>;
  /** 取得後に実行する `--version` */
  runVersion: (bin: string) => Promise<string>;
  loginTimeoutMs: number;
};

function defaultRunVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--version"],
      { timeout: 15_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(`${stdout}${stderr}`);
      },
    );
  });
}

function extractTar(platform: NodeJS.Platform, archive: string, destDir: string): Promise<void> {
  // macOS は /usr/bin/tar、Windows は同梱の tar.exe（zip も展開できる）
  // Windows は Git for Windows の GNU tar が PATH で先に当たると失敗するので System32 を絶対指定する
  const cmd =
    platform === "win32"
      ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\tar.exe`
      : platform === "darwin"
        ? "/usr/bin/tar"
        : "tar";
  const args = platform === "win32" ? ["-xf", archive, "-C", destDir] : ["-xzf", archive, "-C", destDir];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5 * 60_000, windowsHide: true }, (err, _o, stderr) => {
      if (err) reject(new Error(`Failed to extract the archive: ${String(stderr || err.message).trim()}`));
      else resolve();
    });
  });
}

/** 展開先から実行ファイルを探す（直下に無ければ配下を再帰的に） */
function findBinary(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return p;
    if (entry.isDirectory()) {
      const hit = findBinary(p, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** 出力 1 行から承認コード・URL を拾う（テスト用に export） */
export function parseLoginLine(
  line: string,
  mode: LoginMode,
): { userCode?: string; verificationUri?: string } {
  const out: { userCode?: string; verificationUri?: string } = {};
  const code = line.match(/code\s+([A-Z0-9]{4}-[A-Z0-9]{4})/);
  if (code) out.userCode = code[1];
  const url = line.match(/https:\/\/[^\s"'<>]+/);
  if (url) {
    const cleaned = url[0].replace(/[.,;:)\]]+$/, "");
    // device は承認ページの URL だけ、web は出力された https の URL をそのまま使う
    if (mode === "web" || cleaned.includes("github.com/login/device")) {
      out.verificationUri = cleaned;
    }
  }
  if (out.userCode && !out.verificationUri && mode === "device") {
    out.verificationUri = DEFAULT_VERIFICATION_URI;
  }
  return out;
}

export function createCopilotCliManager(overrides: Partial<CopilotCliManagerDeps> = {}) {
  const deps: CopilotCliManagerDeps = {
    version: COPILOT_CLI_VERSION,
    baseUrl: DEFAULT_BASE_URL,
    assets: COPILOT_ASSETS,
    platform: process.platform,
    arch: process.arch,
    fetch: (...a) => fetch(...a),
    spawn,
    resolveCli: () => resolveCopilotBinaryAsync(),
    buildEnv: (cliPath) => buildCopilotEnv(cliPath),
    runVersion: defaultRunVersion,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    ...overrides,
  };

  const currentAsset = (): CopilotAsset | undefined =>
    deps.assets[`${deps.platform}-${deps.arch}`];

  // ---- 取得 ----
  let installing = false;
  let installProgress = { received: 0, total: 0 };
  let installError: string | null = null;
  let installAbort: AbortController | null = null;
  let installPromise: Promise<void> = Promise.resolve();

  async function runInstall(asset: CopilotAsset, signal: AbortSignal): Promise<void> {
    const root = managedCopilotCliRoot();
    mkdirSync(root, { recursive: true });
    const finalDir = managedCopilotCliDir(deps.version);
    const archive = join(root, `${asset.asset}.part`);
    const tmpDir = mkdtempSync(join(root, ".extract-"));
    try {
      const url = `${deps.baseUrl}/v${deps.version}/${asset.asset}`;
      const res = await deps.fetch(url, { redirect: "follow", signal });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed (HTTP ${res.status})`);
      }
      installProgress = { received: 0, total: Number(res.headers.get("content-length")) || 0 };
      const hash = createHash("sha256");
      const out = createWriteStream(archive);
      // 書き込み失敗（ENOSPC / EACCES 等）を拾う。リスナーが無いと uncaughtException でサーバーが落ちる
      let writeError: Error | null = null;
      let onWriteError: (() => void) | null = null;
      out.on("error", (e) => {
        writeError = e;
        onWriteError?.();
      });
      const reader = res.body.getReader();
      try {
        for (;;) {
          if (writeError) throw writeError;
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          installProgress.received += value.byteLength;
          if (!out.write(value)) {
            // drain か error のどちらか早い方で抜ける
            await new Promise<void>((r) => {
              onWriteError = r;
              out.once("drain", () => r());
            });
            onWriteError = null;
          }
        }
        if (writeError) throw writeError;
      } catch (e) {
        void reader.cancel().catch(() => {});
        throw e;
      } finally {
        await new Promise<void>((r) => {
          out.once("error", () => r());
          out.end(() => r());
        });
      }
      if (hash.digest("hex") !== asset.sha256) {
        throw new Error("The downloaded file did not match the expected checksum");
      }
      signal.throwIfAborted();
      await extractTar(deps.platform, archive, tmpDir);
      rmSync(archive, { force: true });
      signal.throwIfAborted();
      const name = copilotBinName(deps.platform);
      const bin = findBinary(tmpDir, name);
      if (!bin) throw new Error(`${name} was not found in the archive`);
      signal.throwIfAborted();
      if (deps.platform !== "win32") chmodSync(bin, 0o755);
      // 実行ファイルだけを版ディレクトリへ移す（途中で失敗しても半端な版ディレクトリを残さない）
      rmSync(finalDir, { recursive: true, force: true });
      mkdirSync(finalDir, { recursive: true });
      const finalBin = join(finalDir, name);
      renameSync(bin, finalBin);
      try {
        signal.throwIfAborted();
        const out = await deps.runVersion(finalBin);
        signal.throwIfAborted();
        if (!out.includes(deps.version)) {
          throw new Error(`Unexpected version output: ${out.trim().slice(0, 120)}`);
        }
      } catch (err) {
        rmSync(finalDir, { recursive: true, force: true });
        throw err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      rmSync(archive, { force: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** 取得を始める。完了は installDone() で待てる（ルートは待たない） */
  function startInstall(): void {
    const asset = currentAsset();
    if (!asset) {
      throw new CopilotCliError(
        "Copilot CLI cannot be downloaded on this platform",
        "COPILOT_CLI_UNSUPPORTED_PLATFORM",
      );
    }
    if (installing) {
      throw new CopilotCliError("Copilot CLI is already being downloaded", "ALREADY_INSTALLING");
    }
    installing = true;
    installError = null;
    installProgress = { received: 0, total: 0 };
    const ac = new AbortController();
    installAbort = ac;
    installPromise = runInstall(asset, ac.signal)
      .then(() => {
        resetCopilotCliCache();
      })
      .catch((err) => {
        // キャンセルは失敗扱いにせず、状態を戻すだけ
        if (ac.signal.aborted) return;
        installError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        installing = false;
        installAbort = null;
      });
  }

  function cancelInstall(): void {
    installAbort?.abort();
  }

  // ---- ログイン ----
  let login: LoginState = {
    state: "idle",
    mode: null,
    verificationUri: null,
    userCode: null,
    error: null,
  };
  let loginChild: ReturnType<SpawnFn> | null = null;
  let loginRun = 0;
  let loginTimer: ReturnType<typeof setTimeout> | null = null;

  function stopLoginProcess(): void {
    if (loginTimer) clearTimeout(loginTimer);
    loginTimer = null;
    const child = loginChild;
    loginChild = null;
    // 世代を進めて、止めたプロセスの exit が新しい状態を書き換えないようにする
    loginRun++;
    if (child && child.exitCode === null) child.kill();
  }

  async function startLogin(mode: LoginMode): Promise<void> {
    if (login.state === "waiting" && login.mode === mode) {
      throw new CopilotCliError("Sign-in is already in progress", "ALREADY_SIGNING_IN");
    }
    const cli = await deps.resolveCli();
    if (!cli) {
      throw new CopilotCliError("Copilot CLI is not installed", "COPILOT_CLI_MISSING");
    }
    // await の間に別の開始が割り込んだ場合も 1 本に絞る
    if (login.state === "waiting" && login.mode === mode) {
      throw new CopilotCliError("Sign-in is already in progress", "ALREADY_SIGNING_IN");
    }
    // mode を変えた再開始は前のプロセスを止めてから
    stopLoginProcess();
    const run = loginRun;
    login = { state: "waiting", mode, verificationUri: null, userCode: null, error: null };

    let child: ReturnType<SpawnFn>;
    try {
      child = deps.spawn(cli.path, ["login", mode === "web" ? "--web-flow" : "--device-code"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: deps.buildEnv(cli.path),
        windowsHide: true,
      });
    } catch (err) {
      // 同期 throw（EACCES 等）で waiting のまま詰まらないようにする
      login = {
        ...login,
        state: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    }
    loginChild = child;
    let lastLine = "";

    const finish = (next: Partial<LoginState>): void => {
      if (run !== loginRun) return;
      if (loginTimer) clearTimeout(loginTimer);
      loginTimer = null;
      loginChild = null;
      login = { ...login, ...next };
    };

    const onLine = (line: string): void => {
      if (run !== loginRun) return;
      const text = line.trim();
      if (!text) return;
      lastLine = text;
      const hit = parseLoginLine(text, mode);
      if (hit.userCode) login = { ...login, userCode: hit.userCode };
      if (hit.verificationUri) login = { ...login, verificationUri: hit.verificationUri };
    };
    for (const stream of [child.stdout, child.stderr]) {
      let buf = "";
      stream?.setEncoding("utf8");
      stream?.on("data", (chunk: string) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        lines.forEach(onLine);
      });
      stream?.on("end", () => {
        if (buf) onLine(buf);
        buf = "";
      });
    }
    child.on("error", (err) => {
      finish({ state: "failed", error: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        // ログインし直した後も、推論で使い回している CLI の接続が古い認証のまま残りうる。
        // 成功した時点で全部捨て、次の呼び出しから新しいログインで起動し直させる
        // （以前は「ログインし直したら Graphium を再起動」と案内していた）。
        // copilot-subscription は重い SDK を読むので、ここでは動的 import にする。
        void import("./copilot-subscription.js")
          .then((m) => m.resetCopilotClients())
          .catch(() => {});
        finish({ state: "succeeded", error: null });
      }
      else finish({ state: "failed", error: lastLine || `Sign-in exited with code ${code}` });
    });
    loginTimer = setTimeout(() => {
      if (run !== loginRun) return;
      const c = loginChild;
      finish({ state: "failed", error: "Sign-in timed out" });
      loginRun++;
      if (c && c.exitCode === null) c.kill();
    }, deps.loginTimeoutMs);
  }

  function cancelLogin(): void {
    stopLoginProcess();
    login = { state: "idle", mode: null, verificationUri: null, userCode: null, error: null };
  }

  async function getStatus(): Promise<CopilotStatus> {
    const resolved = installing ? undefined : await deps.resolveCli();
    return {
      cli: installing ? "installing" : resolved ? "ready" : "missing",
      source: resolved?.source ?? null,
      installable: currentAsset() !== undefined,
      install: installing ? { ...installProgress } : null,
      installError,
      login: { ...login },
    };
  }

  return {
    getStatus,
    startInstall,
    cancelInstall,
    /** テスト用: 取得の完了を待つ */
    installDone: () => installPromise,
    startLogin,
    cancelLogin,
  };
}

/** 本番用のシングルトン */
export const copilotCliManager = createCopilotCliManager();
