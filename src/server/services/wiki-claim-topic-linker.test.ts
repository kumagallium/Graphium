import { describe, expect, it } from "vitest";
import {
  buildClaimTopicLinkerSystemPrompt,
  buildClaimTopicLinkerUserMessage,
  CLAIM_LINK_MAX_TEXT_CHARS,
  MAX_TOPICS_PER_CLAIM,
  parseClaimTopicLinkerOutput,
} from "./wiki-claim-topic-linker";

const claims = [
  { id: "claim-a", title: "知見 A" },
  { id: "claim-b", title: "知見 B" },
];
const topics = [
  { id: "topic-1", title: "トピック 1", oneLiner: "定義 1" },
  { id: "topic-2", title: "トピック 2" },
  { id: "topic-3", title: "トピック 3" },
  { id: "topic-4", title: "トピック 4" },
];
const parse = (value: unknown) => parseClaimTopicLinkerOutput(JSON.stringify(value), claims, topics);

describe("buildClaimTopicLinkerUserMessage", () => {
  it("id を見せず、番号と題・定義の冒頭だけを渡す", () => {
    const message = buildClaimTopicLinkerUserMessage(claims, topics);
    expect(message).toContain("- T1: トピック 1 — 定義 1");
    expect(message).toContain("- T2: トピック 2\n");
    expect(message).toContain("- C2: 知見 B");
    expect(message).not.toContain("topic-1");
    expect(message).not.toContain("claim-a");
  });

  it("長い題は切り、改行は 1 行に畳む", () => {
    const message = buildClaimTopicLinkerUserMessage(
      [{ id: "c", title: `一行目\n${"あ".repeat(CLAIM_LINK_MAX_TEXT_CHARS + 50)}` }],
      [{ id: "t", title: "題" }],
    );
    const line = message.split("\n").find((l) => l.startsWith("- C1:"))!;
    expect(line).toContain("一行目 あ");
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(CLAIM_LINK_MAX_TEXT_CHARS + "- C1: …".length);
  });
});

describe("buildClaimTopicLinkerSystemPrompt", () => {
  it("上限と、語が出るだけでは選ばない決まりを伝える", () => {
    const prompt = buildClaimTopicLinkerSystemPrompt();
    expect(prompt).toContain(`0 to ${MAX_TOPICS_PER_CLAIM} topics`);
    expect(prompt).toContain("merely because its word appears");
  });
});

describe("parseClaimTopicLinkerOutput", () => {
  it("番号を元の id に戻す。空の答えは links に入らない", () => {
    expect(parse({ links: [{ claim: "C1", topics: ["T2", "T1"] }, { claim: "C2", topics: [] }] })).toEqual({
      links: { "claim-a": ["topic-2", "topic-1"] },
      rejected: 0,
    });
  });

  it("コードフェンスと小文字の番号を受け付ける", () => {
    const text = "```json\n{\"links\":[{\"claim\":\"c1\",\"topics\":[\"t3\"]}]}\n```";
    expect(parseClaimTopicLinkerOutput(text, claims, topics)).toEqual({
      links: { "claim-a": ["topic-3"] },
      rejected: 0,
    });
  });

  it("集合の外のトピック番号はその番号だけ捨てて数える", () => {
    expect(parse({ links: [{ claim: "C1", topics: ["T9", "T1", "topic-2", 3] }] })).toEqual({
      links: { "claim-a": ["topic-1"] },
      rejected: 3,
    });
  });

  it("集合の外の知見・同じ知見の 2 回目・配列でない topics は答えごと捨てて数える", () => {
    expect(parse({
      links: [
        { claim: "C9", topics: ["T1"] },
        { claim: "C1", topics: ["T1"] },
        { claim: "C1", topics: ["T2"] },
        { claim: "C2", topics: "T1" },
        null,
      ],
    })).toEqual({ links: { "claim-a": ["topic-1"] }, rejected: 4 });
  });

  it("上限を超えた答えはその知見の答えごと捨てて数える", () => {
    expect(parse({ links: [{ claim: "C1", topics: ["T1", "T2", "T3", "T4"] }] })).toEqual({
      links: {},
      rejected: 1,
    });
  });

  it("同じトピックの重複は 1 件に畳み、上限の数にも入れない", () => {
    expect(parse({ links: [{ claim: "C1", topics: ["T1", "T1", "T2", "T3", "t1"] }] })).toEqual({
      links: { "claim-a": ["topic-1", "topic-2", "topic-3"] },
      rejected: 0,
    });
  });

  it("__proto__ という id の知見も普通の鍵として返す", () => {
    const parsed = parseClaimTopicLinkerOutput(
      JSON.stringify({ links: [{ claim: "C1", topics: ["T1"] }] }),
      [{ id: "__proto__", title: "知見" }],
      topics,
    );
    expect(Object.keys(parsed!.links)).toEqual(["__proto__"]);
    expect(JSON.parse(JSON.stringify(parsed!.links))).toEqual(JSON.parse('{"__proto__":["topic-1"]}'));
  });

  it("壊れた JSON と links の無い答えは undefined", () => {
    expect(parseClaimTopicLinkerOutput("not json", claims, topics)).toBeUndefined();
    expect(parse({ result: [] })).toBeUndefined();
  });
});
