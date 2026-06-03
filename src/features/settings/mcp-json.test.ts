// parseMcpServersJson のテスト
// README からコピペされる標準 mcpServers 形式 JSON を正しく取り込めるかを検証

import { describe, it, expect } from "vitest";
import { parseMcpServersJson } from "./store";

describe("parseMcpServersJson", () => {
  it("完全形 { mcpServers: {...} } から stdio サーバーを取り込む", () => {
    const json = JSON.stringify({
      mcpServers: {
        zotlink: {
          command: "/opt/homebrew/bin/zotlink",
          args: [],
          env: { ZOTLINK_ZOTERO_ROOT: "/Users/me/Zotero" },
        },
      },
    });
    const { servers, error } = parseMcpServersJson(json);
    expect(error).toBeUndefined();
    expect(servers).toHaveLength(1);
    const s = servers[0];
    expect(s.type).toBe("stdio");
    expect(s.name).toBe("zotlink");
    if (s.type === "stdio") {
      expect(s.command).toBe("/opt/homebrew/bin/zotlink");
      expect(s.args).toEqual([]);
      expect(s.env).toEqual({ ZOTLINK_ZOTERO_ROOT: "/Users/me/Zotero" });
    }
    expect(s.enabled).toBe(true);
    expect(s.id).toBeTruthy();
  });

  it("ラッパー無し { name: cfg } 形式も取り込む", () => {
    const json = JSON.stringify({
      filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/notes"] },
    });
    const { servers } = parseMcpServersJson(json);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("filesystem");
    if (servers[0].type === "stdio") {
      expect(servers[0].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "~/notes"]);
    }
  });

  it("複数サーバーを一括で取り込む", () => {
    const json = JSON.stringify({
      mcpServers: {
        a: { command: "npx", args: ["a"] },
        b: { command: "uvx", args: ["b"] },
      },
    });
    const { servers } = parseMcpServersJson(json);
    expect(servers.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("remote (url + type) を取り込み、transport を正規化する", () => {
    const json = JSON.stringify({
      mcpServers: {
        api: { url: "https://example.com/mcp", type: "http" },
      },
    });
    const { servers } = parseMcpServersJson(json);
    expect(servers).toHaveLength(1);
    const s = servers[0];
    expect(s.type).toBe("remote");
    if (s.type === "remote") {
      expect(s.url).toBe("https://example.com/mcp");
      expect(s.transport).toBe("streamable-http");
    }
  });

  it("remote の Authorization ヘッダーから Bearer トークンを抽出する", () => {
    const json = JSON.stringify({
      mcpServers: {
        api: { url: "https://example.com/sse", headers: { Authorization: "Bearer secret-token" } },
      },
    });
    const { servers } = parseMcpServersJson(json);
    expect(servers[0].type).toBe("remote");
    if (servers[0].type === "remote") {
      expect(servers[0].transport).toBe("sse");
      expect(servers[0].apiKey).toBe("secret-token");
    }
  });

  it("名前なし単体の stdio は command の basename を名前にする", () => {
    const json = JSON.stringify({ command: "/opt/homebrew/bin/zotlink", args: [] });
    const { servers } = parseMcpServersJson(json);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("zotlink");
  });

  it("不正な JSON は invalid-json を返す", () => {
    const { servers, error } = parseMcpServersJson("{ not json");
    expect(servers).toHaveLength(0);
    expect(error).toBe("invalid-json");
  });

  it("サーバーが 1 つも無ければ no-servers を返す", () => {
    expect(parseMcpServersJson("{}").error).toBe("no-servers");
    expect(parseMcpServersJson("").error).toBe("no-servers");
    // command も url も無いエントリは捨てる
    expect(parseMcpServersJson(JSON.stringify({ mcpServers: { x: { foo: 1 } } })).error).toBe("no-servers");
  });
});
