import { describe, expect, it } from "vitest";
import {
  ASTERISM_MCP_CANDIDATE_URLS,
  buildAsterismMcpEntry,
  findReachableAsterism,
  hasAsterismMcpServer,
} from "./asterism-mcp-preset";
import type { McpServerEntry } from "./store";

describe("findReachableAsterism", () => {
  it("候補を順に握手し、最初に答えた URL を asterism として返す", async () => {
    const asked: string[] = [];
    const probe = async (e: McpServerEntry) => {
      asked.push(e.type === "remote" ? e.url : "");
      return e.type === "remote" && e.url.includes(":8080/") ? 14 : null;
    };
    const found = await findReachableAsterism(probe, { newId: () => "id-1" });
    expect(asked).toEqual([...ASTERISM_MCP_CANDIDATE_URLS]);
    expect(found).toEqual({
      entry: {
        type: "remote",
        id: "id-1",
        name: "asterism",
        url: "http://127.0.0.1:8080/mcp",
        transport: "streamable-http",
        enabled: true,
      },
      toolCount: 14,
    });
  });

  it("最初の候補が答えたら後は聞かない", async () => {
    const asked: string[] = [];
    const probe = async (e: McpServerEntry) => {
      asked.push(e.type === "remote" ? e.url : "");
      return 3;
    };
    const found = await findReachableAsterism(probe, { newId: () => "id-2" });
    expect(asked).toEqual([ASTERISM_MCP_CANDIDATE_URLS[0]]);
    expect(found?.entry.id).toBe("id-2");
  });

  it("どれも答えなければ null", async () => {
    expect(await findReachableAsterism(async () => null)).toBeNull();
  });
});

describe("hasAsterismMcpServer", () => {
  it("名前が asterism の登録があるときだけ true", () => {
    expect(hasAsterismMcpServer([])).toBe(false);
    expect(hasAsterismMcpServer([buildAsterismMcpEntry("http://127.0.0.1:8765/mcp", "x")])).toBe(true);
    const other: McpServerEntry = {
      type: "remote",
      id: "y",
      name: "tavily",
      url: "https://example.com/mcp",
      transport: "streamable-http",
      enabled: true,
    };
    expect(hasAsterismMcpServer([other])).toBe(false);
  });
});
