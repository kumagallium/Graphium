// claude-account のユニットテスト
//
// claude-subscription の認証は CLI（claude）側にあり、Graphium は .claude.json の
// oauthAccount キャッシュを読んで「どのアカウントで推論されるか」を表示するだけ。
// パースの頑健性（壊れた JSON・フィールド欠け・空文字）と、CLAUDE_CONFIG_DIR
// 経由のファイル解決、CLAUDE_CODE_OAUTH_TOKEN の検出を検証する。

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaudeCliAccount,
  readClaudeCliAccount,
  isClaudeTokenFromEnv,
} from "./claude-account.js";

const FULL_ACCOUNT_JSON = JSON.stringify({
  numStartups: 42,
  oauthAccount: {
    accountUuid: "uuid-1",
    emailAddress: "user@example.com",
    organizationName: "Example Team",
    organizationType: "claude_team",
    organizationRole: "member",
  },
});

describe("parseClaudeCliAccount", () => {
  it("oauthAccount から email / organization / organizationType を抽出する", () => {
    expect(parseClaudeCliAccount(FULL_ACCOUNT_JSON)).toEqual({
      email: "user@example.com",
      organization: "Example Team",
      organizationType: "claude_team",
    });
  });

  it("oauthAccount が無ければ null", () => {
    expect(parseClaudeCliAccount(JSON.stringify({ numStartups: 1 }))).toBeNull();
  });

  it("壊れた JSON は null（throw しない）", () => {
    expect(parseClaudeCliAccount("{not json")).toBeNull();
  });

  it("oauthAccount がオブジェクトでなければ null", () => {
    expect(parseClaudeCliAccount(JSON.stringify({ oauthAccount: "str" }))).toBeNull();
    expect(parseClaudeCliAccount(JSON.stringify({ oauthAccount: [1, 2] }))).toBeNull();
  });

  it("emailAddress だけでも表示対象になる（organization は null）", () => {
    const raw = JSON.stringify({ oauthAccount: { emailAddress: "solo@example.com" } });
    expect(parseClaudeCliAccount(raw)).toEqual({
      email: "solo@example.com",
      organization: null,
      organizationType: null,
    });
  });

  it("email も organization も空なら null（表示価値なし）", () => {
    const raw = JSON.stringify({
      oauthAccount: { emailAddress: "  ", organizationName: "", accountUuid: "u" },
    });
    expect(parseClaudeCliAccount(raw)).toBeNull();
  });
});

describe("readClaudeCliAccount", () => {
  const origConfigDir = process.env.CLAUDE_CONFIG_DIR;
  let tempDir: string | null = null;

  afterEach(() => {
    if (origConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = origConfigDir;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("CLAUDE_CONFIG_DIR 配下の .claude.json を最優先で読む", () => {
    tempDir = mkdtempSync(join(tmpdir(), "graphium-claude-account-"));
    writeFileSync(join(tempDir, ".claude.json"), FULL_ACCOUNT_JSON, "utf-8");
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    expect(readClaudeCliAccount()).toEqual({
      email: "user@example.com",
      organization: "Example Team",
      organizationType: "claude_team",
    });
  });

  it("CLAUDE_CONFIG_DIR 配下が壊れた JSON でも throw しない", () => {
    tempDir = mkdtempSync(join(tmpdir(), "graphium-claude-account-"));
    writeFileSync(join(tempDir, ".claude.json"), "{broken", "utf-8");
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    // 壊れたファイルはスキップされ、ホーム側の実ファイル有無で結果が変わるため
    // 「throw しないこと」だけを検証する（CI / 各開発機どちらでも安定）
    expect(() => readClaudeCliAccount()).not.toThrow();
  });
});

describe("isClaudeTokenFromEnv", () => {
  const orig = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  afterEach(() => {
    if (orig === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = orig;
  });

  it("未設定なら false", () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    expect(isClaudeTokenFromEnv()).toBe(false);
  });

  it("空白のみなら false", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "   ";
    expect(isClaudeTokenFromEnv()).toBe(false);
  });

  it("設定されていれば true", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-xxx";
    expect(isClaudeTokenFromEnv()).toBe(true);
  });
});
