// assistant-connect（外の AI アシスタントへの登録）の回帰テスト。
// 設定ファイルは一時 home に置き、CLI と Claude の起動判定は差し替える。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claudeDesktopConfigPath,
  getAssistantConnectStatus,
  registerAssistant,
  type AssistantConnectEnv,
} from "./assistant-connect";

describe("assistant-connect", () => {
  let home: string;
  let script: string;
  let runs: string[][];

  const makeEnv = (overrides: Partial<AssistantConnectEnv> = {}): AssistantConnectEnv => ({
    platform: "darwin",
    home,
    node: "/Applications/Graphium.app/Contents/Resources/sidecar/node",
    script,
    findCli: async (name) => `/opt/homebrew/bin/${name}`,
    isClaudeDesktopRunning: async () => false,
    run: async (bin, args) => {
      runs.push([bin, ...args]);
    },
    ...overrides,
  });

  const desktopConfig = () => join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "graphium-assistant-connect-"));
    const resources = join(home, "Graphium.app", "Resources");
    mkdirSync(join(resources, "mcp"), { recursive: true });
    script = join(resources, "mcp", "graphium-mcp.mjs");
    writeFileSync(script, "// mcp", "utf8");
    runs = [];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("同梱の MCP が無ければ使えない（dev・Web 版）", async () => {
    rmSync(script);
    const status = await getAssistantConnectStatus(makeEnv());
    expect(status.available).toBe(false);
    await expect(registerAssistant("claude-desktop", makeEnv())).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });

  it("貼り付け用の文字列は同梱の node と script を引用付きで含む", async () => {
    const status = await getAssistantConnectStatus(makeEnv());
    expect(status.snippets["claude-code"]).toBe(
      `claude mcp add --scope user graphium -- "/Applications/Graphium.app/Contents/Resources/sidecar/node" "${script}"`,
    );
    expect(status.snippets.codex).toContain(`codex mcp add graphium -- "`);
    expect(JSON.parse(status.snippets.json)).toEqual({
      mcpServers: { graphium: { command: "/Applications/Graphium.app/Contents/Resources/sidecar/node", args: [script] } },
    });
  });

  describe("Claude Desktop", () => {
    it("設定ファイルが無ければ作って graphium を足す", async () => {
      expect(await registerAssistant("claude-desktop", makeEnv())).toBe("registered");
      const config = JSON.parse(readFileSync(desktopConfig(), "utf8"));
      expect(config.mcpServers.graphium.args).toEqual([script]);
      expect((await getAssistantConnectStatus(makeEnv())).rows["claude-desktop"]).toBe("registered");
    });

    it("ほかの項目は残し、元の内容をバックアップに残す", async () => {
      mkdirSync(join(desktopConfig(), ".."), { recursive: true });
      const original = { preferences: { theme: "dark" }, mcpServers: { other: { command: "x" } } };
      writeFileSync(desktopConfig(), JSON.stringify(original), "utf8");

      await registerAssistant("claude-desktop", makeEnv());
      const config = JSON.parse(readFileSync(desktopConfig(), "utf8"));
      expect(config.preferences).toEqual({ theme: "dark" });
      expect(config.mcpServers.other).toEqual({ command: "x" });
      expect(config.mcpServers.graphium.command).toBe("/Applications/Graphium.app/Contents/Resources/sidecar/node");
      expect(JSON.parse(readFileSync(`${desktopConfig()}.graphium-backup`, "utf8"))).toEqual(original);
      expect(existsSync(`${desktopConfig()}.graphium-tmp`)).toBe(false);
    });

    it("Claude が起動中なら書かずに needs-quit", async () => {
      const env = makeEnv({ isClaudeDesktopRunning: async () => true });
      expect(await registerAssistant("claude-desktop", env)).toBe("needs-quit");
      expect(existsSync(desktopConfig())).toBe(false);
    });

    it("壊れた JSON は上書きしない", async () => {
      mkdirSync(join(desktopConfig(), ".."), { recursive: true });
      writeFileSync(desktopConfig(), "{ broken", "utf8");
      await expect(registerAssistant("claude-desktop", makeEnv())).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(readFileSync(desktopConfig(), "utf8")).toBe("{ broken");
      // 状態の表示は止めない
      expect((await getAssistantConnectStatus(makeEnv())).rows["claude-desktop"]).toBe("idle");
    });

    it("別の場所の graphium は outdated", async () => {
      mkdirSync(join(desktopConfig(), ".."), { recursive: true });
      writeFileSync(
        desktopConfig(),
        JSON.stringify({ mcpServers: { graphium: { command: "node", args: ["/Users/me/Graphium/dist-mcp/graphium-mcp.mjs"] } } }),
        "utf8",
      );
      expect((await getAssistantConnectStatus(makeEnv())).rows["claude-desktop"]).toBe("outdated");
    });

    it("Windows は %APPDATA%\\Claude、Store 版があればそちらを使う", () => {
      const appData = join(home, "Roaming");
      const localAppData = join(home, "Local");
      const env = makeEnv({ platform: "win32", appData, localAppData });
      expect(claudeDesktopConfigPath(env)).toBe(join(appData, "Claude", "claude_desktop_config.json"));

      const store = join(localAppData, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
      mkdirSync(store, { recursive: true });
      expect(claudeDesktopConfigPath(env)).toBe(join(store, "claude_desktop_config.json"));
    });
  });

  describe("Claude Code / Codex", () => {
    it("CLI で以前の登録を外してから足す", async () => {
      expect(await registerAssistant("claude-code", makeEnv())).toBe("registered");
      expect(await registerAssistant("codex", makeEnv())).toBe("registered");
      const node = "/Applications/Graphium.app/Contents/Resources/sidecar/node";
      expect(runs).toEqual([
        ["/opt/homebrew/bin/claude", "mcp", "remove", "--scope", "user", "graphium"],
        ["/opt/homebrew/bin/claude", "mcp", "add", "--scope", "user", "graphium", "--", node, script],
        ["/opt/homebrew/bin/codex", "mcp", "remove", "graphium"],
        ["/opt/homebrew/bin/codex", "mcp", "add", "graphium", "--", node, script],
      ]);
    });

    it("remove の失敗（未登録）は無視し、add の失敗は理由つきで返す", async () => {
      const env = makeEnv({
        run: async (_bin, args) => {
          if (args[1] === "remove") throw new Error("No MCP server found");
          throw Object.assign(new Error("exit 1"), { stderr: "Invalid configuration\n" });
        },
      });
      await expect(registerAssistant("codex", env)).rejects.toMatchObject({
        code: "CLI_FAILED",
        message: "Invalid configuration",
      });
    });

    it("CLI が無ければ no-cli（登録しない）。ただし同梱版で登録済みなら registered を見せる", async () => {
      const env = makeEnv({ findCli: async () => undefined });
      expect(await registerAssistant("claude-code", env)).toBe("no-cli");
      expect(runs).toEqual([]);
      expect((await getAssistantConnectStatus(env)).rows["claude-code"]).toBe("no-cli");

      writeFileSync(
        join(home, ".claude.json"),
        JSON.stringify({ mcpServers: { graphium: { type: "stdio", command: "node", args: [script] } } }),
        "utf8",
      );
      expect((await getAssistantConnectStatus(env)).rows["claude-code"]).toBe("registered");
    });

    it("Codex の config.toml の [mcp_servers.graphium] を読む", async () => {
      const codexDir = join(home, ".codex");
      mkdirSync(codexDir, { recursive: true });
      const toml = (args: string) =>
        [
          'model = "gpt-5"',
          "",
          "[mcp_servers.graphium]",
          'command = "node"',
          `args = [${args}]`,
          "",
          "[mcp_servers.other]",
          `command = "${script}"`,
        ].join("\n");

      writeFileSync(join(codexDir, "config.toml"), toml(`"${script}"`), "utf8");
      expect((await getAssistantConnectStatus(makeEnv())).rows.codex).toBe("registered");

      // 別の節に同じパスがあっても、graphium の節が別の場所なら outdated
      writeFileSync(join(codexDir, "config.toml"), toml('"/old/graphium-mcp.mjs"'), "utf8");
      expect((await getAssistantConnectStatus(makeEnv())).rows.codex).toBe("outdated");

      writeFileSync(join(codexDir, "config.toml"), 'model = "gpt-5"\n', "utf8");
      expect((await getAssistantConnectStatus(makeEnv())).rows.codex).toBe("idle");
    });
  });
});
