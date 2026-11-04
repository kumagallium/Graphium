// 外の AI アシスタント（Claude Desktop / Claude Code / Codex）に、デスクトップ版へ同梱した
// Graphium の MCP サーバーを登録する。
//
// 同梱物: アプリの resources に sidecar/（node と server.mjs）と mcp/（graphium-mcp.mjs と
// pdfjs-dist の一部）が並ぶ。このサーバーは sidecar/server.mjs として動くので、
//   - node   = process.execPath（同梱の node）
//   - script = <server.mjs の隣の親>/mcp/graphium-mcp.mjs
// で引ける。dev（tsx で src/server を動かす）では script が無いので「使えない」を返す
// （GRAPHIUM_MCP_SCRIPT で明示すれば dev でも試せる）。
//
// 登録の仕方:
//   - Claude Desktop: 設定ファイル（claude_desktop_config.json）の mcpServers に graphium だけを足す。
//     Claude が起動中だと、終了時に手元の古い内容で書き戻して消えるので、起動中は書かずに断る。
//     書き換える前の内容は .graphium-backup に残す。壊れた JSON は上書きしない
//   - Claude Code / Codex: それぞれの CLI（claude mcp add / codex mcp add）を呼ぶ。設定ファイルの形は
//     CLI に任せる。CLI が見つからなければ、貼り付けるコマンドを画面に出してもらう（no-cli）
//
// 状態の読み取りは設定ファイルを読むだけ（CLI は起動しない）。graphium が同梱の script を
// 指していれば registered、別の場所（手でビルドした版など）なら outdated。

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { detectCliBinaryAsync } from "./cli-binary-resolver.js";

const execFileAsync = promisify(execFile);

export const ASSISTANT_CLIENTS = ["claude-desktop", "claude-code", "codex"] as const;
export type AssistantClientId = (typeof ASSISTANT_CLIENTS)[number];

/** 登録の名前（どのクライアントでも同じ） */
export const SERVER_NAME = "graphium";

export type AssistantRowStatus = "idle" | "registered" | "outdated" | "needs-quit" | "no-cli";

export type AssistantConnectStatus = {
  /** 同梱の MCP がある（デスクトップ版）か */
  available: boolean;
  node: string;
  script: string;
  rows: Record<AssistantClientId, AssistantRowStatus>;
  snippets: { "claude-code": string; codex: string; json: string };
};

export class AssistantConnectError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** 外から差し替えられるもの（テスト用） */
export type AssistantConnectEnv = {
  platform: NodeJS.Platform;
  home: string;
  /** Windows の %APPDATA% / %LOCALAPPDATA% */
  appData?: string;
  localAppData?: string;
  codexHome?: string;
  node: string;
  script: string;
  /** CLI の場所を探す（見つからなければ undefined） */
  findCli: (name: "claude" | "codex") => Promise<string | undefined>;
  /** Claude Desktop が起動中か */
  isClaudeDesktopRunning: () => Promise<boolean>;
  /** CLI を実行する（失敗は throw） */
  run: (bin: string, args: string[]) => Promise<void>;
};

/** 同梱の MCP の場所（sidecar/server.mjs の隣の mcp/） */
function bundledScriptPath(): string {
  const override = process.env.GRAPHIUM_MCP_SCRIPT?.trim();
  if (override) return override;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "mcp", "graphium-mcp.mjs");
}

function cliCandidates(name: "claude" | "codex", home: string): string[] {
  if (name === "claude") {
    return [
      join(home, ".claude/local/claude"),
      join(home, ".local/bin/claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ];
  }
  return [join(home, ".local/bin/codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
}

async function findCliDefault(name: "claude" | "codex"): Promise<string | undefined> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [name], { timeout: 3000, windowsHide: true });
      // claude.cmd / codex.cmd など、実行できる拡張子のものを優先する
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0];
    } catch {
      return undefined;
    }
  }
  return detectCliBinaryAsync(name, cliCandidates(name, homedir()));
}

async function isClaudeDesktopRunningDefault(): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      // pgrep -x Claude は起動中でも拾えないことがあった（実機で確認）。実行ファイルのパスで見る
      const { stdout } = await execFileAsync("ps", ["-axo", "comm="], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
      return stdout.split("\n").some((l) => /\/Claude\.app\/Contents\/MacOS\/Claude$/.test(l.trim()));
    }
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Claude.exe", "/NH"], {
        timeout: 5000,
        windowsHide: true,
      });
      return /claude\.exe/i.test(stdout);
    }
  } catch {
    /* 見つからない */
  }
  return false;
}

/** Windows のコマンドライン 1 引数分の引用（cmd.exe 経由で .cmd を呼ぶため） */
function quoteWin(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

async function runDefault(bin: string, args: string[], node: string): Promise<void> {
  // claude / codex の npm 版は `#!/usr/bin/env node` のスクリプト。GUI から起動したアプリの PATH には
  // node が無いことがあるので、CLI の隣（nvm なら同じ bin）と同梱の node の場所を PATH の頭に足す
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const prefix = [dirname(bin), dirname(node)].join(delimiter);
  env[pathKey] = env[pathKey] ? `${prefix}${delimiter}${env[pathKey]}` : prefix;

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const line = [bin, ...args].map(quoteWin).join(" ");
    await execFileAsync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
      env,
      timeout: 30_000,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    return;
  }
  await execFileAsync(bin, args, { env, timeout: 30_000, windowsHide: true });
}

export function defaultEnv(): AssistantConnectEnv {
  const node = process.execPath;
  return {
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    codexHome: process.env.CODEX_HOME,
    node,
    script: bundledScriptPath(),
    findCli: findCliDefault,
    isClaudeDesktopRunning: isClaudeDesktopRunningDefault,
    run: (bin, args) => runDefault(bin, args, node),
  };
}

// ── 設定ファイルの場所 ───────────────────────────────────────

/** Claude Desktop の設定ファイル */
export function claudeDesktopConfigPath(env: AssistantConnectEnv): string {
  const file = "claude_desktop_config.json";
  if (env.platform === "darwin") return join(env.home, "Library", "Application Support", "Claude", file);
  if (env.platform === "win32") {
    const roaming = env.appData ?? join(env.home, "AppData", "Roaming");
    const classic = join(roaming, "Claude", file);
    // Microsoft Store（MSIX）版は %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude に置く
    const local = env.localAppData ?? join(env.home, "AppData", "Local");
    try {
      for (const dir of readdirSync(join(local, "Packages"))) {
        if (!/^Claude_/i.test(dir)) continue;
        const candidate = join(local, "Packages", dir, "LocalCache", "Roaming", "Claude", file);
        if (existsSync(dirname(candidate))) return candidate;
      }
    } catch {
      /* Packages が無い */
    }
    return classic;
  }
  return join(env.home, ".config", "Claude", file);
}

/** Claude Code のユーザー設定（--scope user の登録先） */
function claudeCodeConfigPath(env: AssistantConnectEnv): string {
  return join(env.home, ".claude.json");
}

/** Codex の設定（CLI・IDE 拡張・アプリで共通） */
function codexConfigPath(env: AssistantConnectEnv): string {
  return join(env.codexHome?.trim() || join(env.home, ".codex"), "config.toml");
}

// ── 状態の読み取り ──────────────────────────────────────────

/** 文字列（設定の中身）が同梱の script を指しているか。TOML / JSON のエスケープ（\\）も見る */
function mentionsScript(text: string, script: string): boolean {
  return text.includes(script) || text.includes(script.replace(/\\/g, "\\\\"));
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonEntryStatus(config: unknown, script: string): "idle" | "registered" | "outdated" {
  if (!config || typeof config !== "object") return "idle";
  const servers = (config as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object") return "idle";
  const entry = (servers as Record<string, unknown>)[SERVER_NAME];
  if (!entry) return "idle";
  return mentionsScript(JSON.stringify(entry), script) ? "registered" : "outdated";
}

/** config.toml の [mcp_servers.graphium] の節だけを取り出す */
function codexSection(toml: string): string | null {
  const lines = toml.split(/\r?\n/);
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME})\\s*\\]\\s*$`);
  const start = lines.findIndex((l) => header.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  // 次の表見出し（[x] / [[x]]）まで。graphium の下位の表（[mcp_servers.graphium.env]）は含める
  const end = rest.findIndex((l) => /^\s*\[/.test(l) && !new RegExp(`mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME})\\.`).test(l));
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
}

function safeRead<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function buildSnippets(env: AssistantConnectEnv): AssistantConnectStatus["snippets"] {
  const q = (s: string) => `"${s}"`;
  return {
    "claude-code": `claude mcp add --scope user ${SERVER_NAME} -- ${q(env.node)} ${q(env.script)}`,
    codex: `codex mcp add ${SERVER_NAME} -- ${q(env.node)} ${q(env.script)}`,
    json: JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: env.node, args: [env.script] } } }, null, 2),
  };
}

export async function getAssistantConnectStatus(env: AssistantConnectEnv = defaultEnv()): Promise<AssistantConnectStatus> {
  const available = existsSync(env.script);
  const snippets = buildSnippets(env);
  if (!available) {
    return {
      available,
      node: env.node,
      script: env.script,
      rows: { "claude-desktop": "idle", "claude-code": "idle", codex: "idle" },
      snippets,
    };
  }

  // 設定ファイルが壊れていても状態の表示は止めない（登録のときに理由つきで断る）
  const desktop = safeRead(() => jsonEntryStatus(readJson(claudeDesktopConfigPath(env)), env.script), "idle" as const);
  const code = safeRead(() => jsonEntryStatus(readJson(claudeCodeConfigPath(env)), env.script), "idle" as const);
  const codexText = safeRead(() => {
    const p = codexConfigPath(env);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }, "");
  const section = codexSection(codexText);
  const codex = section === null ? "idle" : mentionsScript(section, env.script) ? "registered" : "outdated";

  const [claudeCli, codexCli] = await Promise.all([env.findCli("claude"), env.findCli("codex")]);
  return {
    available,
    node: env.node,
    script: env.script,
    rows: {
      "claude-desktop": desktop,
      // CLI が無くても、すでに同梱版で登録されていればそれを見せる
      "claude-code": code === "registered" || claudeCli ? code : "no-cli",
      codex: codex === "registered" || codexCli ? codex : "no-cli",
    },
    snippets,
  };
}

// ── 登録 ──────────────────────────────────────────────────

/** Claude Desktop の設定ファイルに graphium を足す（ほかの項目は触らない） */
function writeClaudeDesktopConfig(env: AssistantConnectEnv): void {
  const path = claudeDesktopConfigPath(env);
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AssistantConnectError(
          "CONFIG_INVALID",
          `Claude の設定ファイルを読めませんでした（JSON の形が壊れています）: ${path}`,
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new AssistantConnectError("CONFIG_INVALID", `Claude の設定ファイルの形が想定と違います: ${path}`);
      }
      config = parsed as Record<string, unknown>;
    }
    copyFileSync(path, `${path}.graphium-backup`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  servers[SERVER_NAME] = { command: env.node, args: [env.script] };
  config.mcpServers = servers;
  // 途中で落ちても元のファイルを壊さないよう、隣に書いてから置き換える
  const tmp = `${path}.graphium-tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** CLI の失敗を、利用者に見せる 1 行にする */
function cliErrorMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  const detail = (e.stderr || e.message || String(err)).trim().split(/\r?\n/).slice(-3).join(" ");
  return detail.slice(0, 400);
}

/**
 * 登録する。返り値は登録後の行の状態（needs-quit / no-cli は登録しなかったことを表す）。
 * 失敗は AssistantConnectError で投げる。
 */
export async function registerAssistant(
  client: AssistantClientId,
  env: AssistantConnectEnv = defaultEnv(),
): Promise<AssistantRowStatus> {
  if (!existsSync(env.script)) {
    throw new AssistantConnectError("NOT_AVAILABLE", "この版には登録できる MCP サーバーが入っていません（デスクトップ版でだけ使えます）");
  }

  if (client === "claude-desktop") {
    if (await env.isClaudeDesktopRunning()) return "needs-quit";
    writeClaudeDesktopConfig(env);
    return "registered";
  }

  const cliName = client === "claude-code" ? "claude" : "codex";
  const bin = await env.findCli(cliName);
  if (!bin) return "no-cli";

  // 以前の登録（手でビルドした版など）があれば外してから足す。無いときの失敗は無視する
  const scope = client === "claude-code" ? ["--scope", "user"] : [];
  try {
    await env.run(bin, ["mcp", "remove", ...scope, SERVER_NAME]);
  } catch {
    /* 未登録 */
  }
  try {
    await env.run(bin, ["mcp", "add", ...scope, SERVER_NAME, "--", env.node, env.script]);
  } catch (err) {
    throw new AssistantConnectError("CLI_FAILED", cliErrorMessage(err));
  }
  return "registered";
}
