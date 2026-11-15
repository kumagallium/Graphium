// 外の AI アシスタント（Claude Desktop / Claude Code / Codex / ChatGPT デスクトップアプリ）に、デスクトップ版へ同梱した
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
//   - Claude Code: CLI（claude mcp add）を呼ぶ。設定ファイルの形は CLI に任せる。
//     CLI が見つからなければ、貼り付けるコマンドを画面に出してもらう（no-cli）
//   - Codex / ChatGPT デスクトップアプリ: どちらも ~/.codex/config.toml の [mcp_servers.*] を読むので
//     登録は共通。codex CLI（ChatGPT.app 同梱のものを含む）があれば codex mcp add を呼び、
//     無ければ config.toml の [mcp_servers.graphium] の command と args だけを直接書き換える。
//     節の中のほかの設定・下位の表・ほかの節・コメントは変えず、元の権限を引き継ぐ。
//     書き換える前の内容は .graphium-backup に残す
//
// 状態の読み取りは設定ファイルを読むだけ（CLI は起動しない）。graphium が同梱の script を
// 指していれば registered、別の場所（手でビルドした版など）なら outdated。

import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { detectCliBinaryAsync } from "./cli-binary-resolver.js";

const execFileAsync = promisify(execFile);

export const ASSISTANT_CLIENTS = ["claude-desktop", "claude-code", "codex", "chatgpt"] as const;
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
  return [
    join(home, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    // ChatGPT のデスクトップアプリに同梱の Codex CLI
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    join(home, "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
  ];
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
  const start = lines.findIndex((l) => GRAPHIUM_MAIN_HEADER.test(l));
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
      rows: { "claude-desktop": "idle", "claude-code": "idle", codex: "idle", chatgpt: "idle" },
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

  const claudeCli = await env.findCli("claude");
  return {
    available,
    node: env.node,
    script: env.script,
    rows: {
      "claude-desktop": desktop,
      // CLI が無くても、すでに同梱版で登録されていればそれを見せる
      "claude-code": code === "registered" || claudeCli ? code : "no-cli",
      // Codex / ChatGPT は CLI が無くても config.toml を直接書けるので no-cli にしない
      codex,
      chatgpt: codex,
    },
    snippets,
  };
}

// ── 登録 ──────────────────────────────────────────────────

/** Claude Desktop の設定ファイルに graphium を足す（ほかの項目は触らない） */
function writeClaudeDesktopConfig(env: AssistantConnectEnv): void {
  const configured = claudeDesktopConfigPath(env);
  // dotfiles へのシンボリックリンクなら、リンクを残してリンク先を書き換える（Codex 側と同じ）
  const path = existsSync(configured) ? realpathSync(configured) : configured;
  let config: Record<string, unknown> = {};
  // 新しく作るときは本人だけが読める権限にする（ほかの MCP の API キーが入ることがある）
  let mode = 0o600;
  if (existsSync(path)) {
    mode = statSync(path).mode & 0o777;
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
  // 元の権限を引き継ぐ（umask 任せにすると 0600 のファイルが 0644 になる）
  const tmp = `${path}.graphium-tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** TOML のリテラル文字列（' で囲む。\ はそのまま入る）。' や改行を含むときだけ基本文字列にする */
function tomlString(value: string): string {
  if (!/['\r\n]/.test(value)) return `'${value}'`;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

const GRAPHIUM_KEY = `(?:"${SERVER_NAME}"|'${SERVER_NAME}'|${SERVER_NAME})`;

/** [mcp_servers.graphium] の見出しか（下位の表は含まない。見出しの後ろのコメントは許す） */
const GRAPHIUM_MAIN_HEADER = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${GRAPHIUM_KEY}\\s*\\]\\s*(?:#.*)?$`);

/**
 * config.toml の本文で、[mcp_servers.graphium] の command と args だけを書き換える。
 * 節の中のほかの設定（enabled など）、下位の表（[mcp_servers.graphium.env] など）、
 * ほかの節、コメント、空行には触れない。節が無ければ末尾に足す。
 * graphium をインラインテーブルやドット付きのキーで書いている設定は、安全に直せないので断る。
 */
export function upsertGraphiumToml(text: string, node: string, script: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  // 末尾の改行で出る空要素は、最後に付け直す
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const assignments = [`command = ${tomlString(node)}`, `args = [${tomlString(script)}]`];
  const dottedFromRoot = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${GRAPHIUM_KEY}\\s*[.=]`);
  const keyInServers = new RegExp(`^\\s*${GRAPHIUM_KEY}\\s*[.=]`);
  const mcpServersHeader = /^\s*\[\s*mcp_servers\s*\]\s*(?:#.*)?$/;

  const out: string[] = [];
  let table: "root" | "servers" | "graphium" | "other" = "root";
  let found = false;
  let skippingArray = 0; // 複数行にわたる args = [ … ] を読み飛ばしている間の [ の深さ
  for (const line of lines) {
    if (skippingArray > 0) {
      skippingArray += bracketDelta(line);
      continue;
    }
    if (/^\s*\[/.test(line)) {
      if (GRAPHIUM_MAIN_HEADER.test(line)) {
        table = "graphium";
        found = true;
        out.push(line, ...assignments);
        continue;
      }
      table = mcpServersHeader.test(line) ? "servers" : "other";
      out.push(line);
      continue;
    }
    if ((table === "root" && dottedFromRoot.test(line)) || (table === "servers" && keyInServers.test(line))) {
      throw new AssistantConnectError(
        "CONFIG_UNSUPPORTED",
        "config.toml の graphium の書き方（1 行の表やドット付きのキー）は、ここからは書き換えられません。設定ファイルの graphium の行を消してから、もう一度押してください。",
      );
    }
    if (table === "graphium" && /^\s*(?:command|"command"|args|"args")\s*=/.test(line)) {
      // 古い command / args は捨てる（新しい値は見出しの直後に書いた）
      if (/^\s*"?args"?\s*=/.test(line)) {
        const depth = bracketDelta(line);
        if (depth > 0) skippingArray = depth;
      }
      continue;
    }
    out.push(line);
  }
  if (!found) {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(`[mcp_servers.${SERVER_NAME}]`, ...assignments);
  }
  return `${out.join(eol)}${eol}`;
}

/** 1 行の中の [ と ] の差（文字列の中の括弧は数えない。コメント以降は見ない） */
function bracketDelta(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#") break;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
  }
  return depth;
}

/** Codex / ChatGPT 共通の config.toml に graphium を書く（CLI が無いとき） */
function writeCodexConfig(env: AssistantConnectEnv): void {
  const configured = codexConfigPath(env);
  try {
    // dotfiles へのシンボリックリンクなら、リンクを残してリンク先を書き換える
    const path = existsSync(configured) ? realpathSync(configured) : configured;
    let text = "";
    // 新しく作るときは本人だけが読める権限にする（ほかの MCP の API キーが入ることがある）
    let mode = 0o600;
    if (existsSync(path)) {
      text = readFileSync(path, "utf8");
      mode = statSync(path).mode & 0o777;
      copyFileSync(path, `${path}.graphium-backup`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
    const next = upsertGraphiumToml(text, env.node, env.script);
    // 途中で落ちても元のファイルを壊さないよう、隣に書いてから置き換える。元の権限を引き継ぐ
    const tmp = `${path}.graphium-tmp`;
    writeFileSync(tmp, next, { encoding: "utf8", mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    if (err instanceof AssistantConnectError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AssistantConnectError("CONFIG_WRITE_FAILED", `Codex の設定ファイルを書き換えられませんでした: ${configured}（${message}）`);
  }
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

  const isClaudeCode = client === "claude-code";
  const bin = await env.findCli(isClaudeCode ? "claude" : "codex");
  if (!bin) {
    if (isClaudeCode) return "no-cli";
    // Codex / ChatGPT: CLI が無くても設定ファイルを直接書く
    writeCodexConfig(env);
    return "registered";
  }

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
