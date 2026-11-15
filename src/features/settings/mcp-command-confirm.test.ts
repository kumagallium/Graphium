// stdio の実行コマンドを見せる表示文（純粋関数）のテスト

import { describe, it, expect } from "vitest";
import {
  MCP_CONFIRM_MAX_CHARS,
  buildCommandSummary,
  escapeForDisplay,
  formatCommandLine,
  needsStdioConfirm,
} from "./mcp-command-confirm";
import type { McpServerEntry, McpStdioServer } from "./store";

const stdio = (over: Partial<McpStdioServer> = {}): McpStdioServer => ({
  type: "stdio",
  id: "1",
  name: "srv",
  command: "npx",
  args: [],
  enabled: true,
  ...over,
});
const RLO = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0);

describe("formatCommandLine", () => {
  it("command と args を空白でつなぐ", () => {
    expect(formatCommandLine(stdio({ args: ["-y", "tavily-mcp"] }))).toBe("npx -y tavily-mcp");
  });
  it("空白入りの引数は境目が分かるよう引用符で囲む", () => {
    expect(formatCommandLine(stdio({ args: ["-y", "a b", ""] }))).toBe('npx -y "a b" ""');
  });
  it("300 文字を超えたら切って … を付ける", () => {
    const line = formatCommandLine(stdio({ args: ["x".repeat(500)] }));
    expect(Array.from(line)).toHaveLength(MCP_CONFIRM_MAX_CHARS + 1);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("escapeForDisplay", () => {
  it("改行・制御文字・双方向制御文字を \\uXXXX に置き換える", () => {
    const out = escapeForDisplay(`a\nb${NUL}c${RLO}d`);
    expect(out).toBe("a\\u000Ab\\u0000c\\u202Ed");
    expect(out.includes(RLO) || out.includes(NUL) || out.includes("\n")).toBe(false);
  });
  it("Hangul filler・Braille 空白・ソフトハイフン・タグ文字・異体字セレクタも置き換える", () => {
    const out = escapeForDisplay("a\u3164\u2800\u00ad\u{e0041}\ufe0f\u180eb");
    expect(out).toBe("a\\u3164\\u2800\\u00AD\\u{E0041}\\uFE0F\\u180Eb");
  });
  it("バックスラッシュは \\\\ にし、置き換え表記と見分けられる", () => {
    expect(escapeForDisplay("\\u202E")).toBe("\\\\u202E");
    expect(escapeForDisplay(RLO)).toBe("\\u202E");
    expect(formatCommandLine(stdio({ args: ["a b\\"] }))).toBe('npx "a b\\\\"');
  });
  it("コマンドと引数の両方に効く", () => {
    const line = formatCommandLine(stdio({ command: `rm${RLO}`, args: ["a\nb"] }));
    expect(line).toBe('rm\\u202E "a\\u000Ab"');
  });
  it("半角スペース以外の空白（NBSP・全角スペースなど）も見える形にする", () => {
    expect(escapeForDisplay("a\u00a0b\u3000c\u2003d e")).toBe("a\\u00A0b\\u3000c\\u2003d e");
    // 実行ファイル名の末尾に紛れた NBSP も、囲んだうえで見える
    expect(formatCommandLine(stdio({ command: "node\u00a0" }))).toBe('"node\\u00A0"');
  });
  it("空白を含む command は、どこまでが実行ファイルか分かるよう囲む", () => {
    expect(formatCommandLine(stdio({ command: "C:\\Program Files\\node.exe", args: ["x"] }))).toBe(
      '"C:\\\\Program Files\\\\node.exe" x',
    );
  });
});

describe("buildCommandSummary", () => {
  it("env は名前だけ出し、値は出さない", () => {
    const text = buildCommandSummary([stdio({ env: { API_KEY: "secret-value", B: "x" } })]);
    expect(text).toBe("npx\nenv: API_KEY, B");
    expect(text).not.toContain("secret-value");
  });
  it("1 件ならサーバー名は付けない", () => {
    expect(buildCommandSummary([stdio()])).toBe("npx");
  });
  it("複数件はサーバー名つきで全部並べる（件数で打ち切らない）", () => {
    const list = Array.from({ length: 12 }, (_, i) => stdio({ name: `s${i}`, command: `cmd${i}` }));
    const text = buildCommandSummary(list);
    for (let i = 0; i < 12; i++) expect(text).toContain(`s${i}:\ncmd${i}`);
  });
  it("サーバー名の制御文字も置き換える", () => {
    const text = buildCommandSummary([stdio({ name: "a\nb" }), stdio({ name: "c" })]);
    expect(text).toContain("a\\u000Ab:");
  });
});

describe("needsStdioConfirm", () => {
  const remote: McpServerEntry = { type: "remote", id: "r", name: "r", url: "https://x", transport: "sse", enabled: true };
  it("remote は出さない", () => {
    expect(needsStdioConfirm(undefined, remote)).toBe(false);
  });
  it("新しい stdio は出す", () => {
    expect(needsStdioConfirm(undefined, stdio())).toBe(true);
    expect(needsStdioConfirm(remote, stdio())).toBe(true);
  });
  it("command・args・env が同じなら出さない（名前・有効/無効の変更）", () => {
    const old = stdio({ args: ["a"], env: { K: "v" } });
    expect(needsStdioConfirm(old, { ...old, name: "renamed", enabled: false })).toBe(false);
  });
  it("command・args・env のどれかが変われば出す", () => {
    const old = stdio({ args: ["a"], env: { K: "v" } });
    expect(needsStdioConfirm(old, { ...old, command: "uvx" })).toBe(true);
    expect(needsStdioConfirm(old, { ...old, args: ["b"] })).toBe(true);
    expect(needsStdioConfirm(old, { ...old, env: { K: "w" } })).toBe(true);
    expect(needsStdioConfirm(old, { ...old, env: undefined })).toBe(true);
  });
});
