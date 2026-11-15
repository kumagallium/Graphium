import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createGraphiumMcpServer } from "./create-server";
import { SERVER_INSTRUCTIONS } from "./server-instructions";

describe("SERVER_INSTRUCTIONS", () => {
  it("空でなく、保存に使う道具の名前を含む", () => {
    expect(SERVER_INSTRUCTIONS.trim().length).toBeGreaterThan(0);
    expect(SERVER_INSTRUCTIONS).toContain("create_note");
    expect(SERVER_INSTRUCTIONS).toContain("save_answer");
  });

  it("黙って保存しない・1 回まで・利用者の言語の決まりを含む", () => {
    expect(SERVER_INSTRUCTIONS).toContain("頼まれていないのに保存しない");
    expect(SERVER_INSTRUCTIONS).toContain("1 回まで");
    expect(SERVER_INSTRUCTIONS).toContain("利用者の言語");
  });

  it("聞く・聞かないが割れないための決まりを含む", () => {
    // 迷う場面は聞かない側に倒す
    expect(SERVER_INSTRUCTIONS).toContain("迷ったら聞かない");
    // 断られたあとは、話題が変わっても聞かない（「同じ話題で 1 回」と衝突させない）
    expect(SERVER_INSTRUCTIONS).toContain("断られたら、話題が変わっても");
    // 道具の結果に無い場所を作り話にしない
    expect(SERVER_INSTRUCTIONS).toContain("道具の結果に無いことは言わない");
    // 会話の保存は create_note。save_answer（自動で改訂される層）へは頼まれたときだけ
    expect(SERVER_INSTRUCTIONS).toContain("ただの「保存して」も create_note");
    // 断られたあとの「また聞いてよい」は、断られていない会話だけ
    expect(SERVER_INSTRUCTIONS).toContain("これは断られていない会話に限る");
    // モデル ID を推測で書かせない
    expect(SERVER_INSTRUCTIONS).toContain("分からなければ省く");
  });

  it("長すぎない（2,000 文字以下）", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
  });
});

describe("createGraphiumMcpServer", () => {
  it("initialize の応答に instructions が入る", async () => {
    const server = createGraphiumMcpServer("0.0.0-test");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    await client.close();
  });
});
