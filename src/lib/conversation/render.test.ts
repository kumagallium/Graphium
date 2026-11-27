import { describe, it, expect } from "vitest";
import {
  conversationFolder,
  conversationTitle,
  renderConversationBody,
  summarizeConversation,
  summarizeWorkdirs,
  workdirName,
  type ConversationSummary,
} from "./render";
import type { ConversationMaterial, ConversationTurn } from "./types";

const JST = { utcOffsetMinutes: 540 };

function material(turns: ConversationTurn[], over: Partial<ConversationMaterial> = {}): ConversationMaterial {
  return {
    provider: "claude-code",
    sessionId: "11111111-2222-4333-8444-555555555555",
    workdir: "/Users/example/bakery-notes",
    startedAt: "2026-11-02T21:28:00.000Z",
    endedAt: "2026-11-02T21:30:00.000Z",
    turns,
    ownChars: 0,
    ...over,
  };
}

const user = (text: string, at = "2026-11-02T21:28:00.000Z", extra: Partial<ConversationTurn> = {}): ConversationTurn => ({
  speaker: "user",
  at,
  text,
  ...extra,
});
const ai = (text: string, at = "2026-11-02T21:27:00.000Z", extra: Partial<ConversationTurn> = {}): ConversationTurn => ({
  speaker: "assistant",
  at,
  text,
  ...extra,
});

describe("renderConversationBody", () => {
  it("UTC 21:28 は JST で翌日の 06:28 になり、日付の見出しも翌日になる", () => {
    const body = renderConversationBody(material([user("辛さは中辛で")]), JST);
    expect(body).toContain("## 2026-11-03\n");
    expect(body).toContain("- 私（06:28）: 辛さは中辛で");
  });

  it("日をまたぐと日付の見出しが変わる", () => {
    const body = renderConversationBody(
      material([user("一つ目", "2026-11-03T01:00:00.000Z"), user("二つ目", "2026-11-03T20:00:00.000Z")]),
      JST,
    );
    const heads = body.split("\n").filter((l) => l.startsWith("## "));
    expect(heads).toEqual(["## 2026-11-03", "## 2026-11-04"]);
  });

  it("同じ日なら見出しは 1 つ", () => {
    const body = renderConversationBody(
      material([user("一つ目", "2026-11-03T01:00:00.000Z"), user("二つ目", "2026-11-03T02:00:00.000Z")]),
      JST,
    );
    expect(body.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(1);
  });

  it("AI の行は抜粋かどうかで出し分ける", () => {
    const body = renderConversationBody(
      material([ai("短い返答"), user("お願いします"), ai("長い返答の冒頭 […] 末尾", undefined, { excerpt: true }), user("辛さは中辛で")]),
      JST,
    );
    expect(body).toContain("- AI（直前の返答）: 短い返答");
    expect(body).toContain("- AI（直前の返答の抜粋）: 長い返答の冒頭 […] 末尾");
  });

  it("記録にモデル名があれば、AI の行の括弧にモデル名が入る（日英とも）", () => {
    const turns = [
      ai("短い返答", undefined, { model: "claude-opus-4-1" }),
      user("お願いします"),
      ai("長い返答の冒頭 […] 末尾", undefined, { excerpt: true, model: "claude-sonnet-4-5" }),
      user("辛さは中辛で"),
    ];
    const ja = renderConversationBody(material(turns), JST);
    expect(ja).toContain("- AI（claude-opus-4-1、直前の返答）: 短い返答");
    expect(ja).toContain("- AI（claude-sonnet-4-5、直前の返答の抜粋）: 長い返答の冒頭 […] 末尾");
    expect(ja).toContain("括弧の中にモデル名があれば、その返答を書いたモデルである。");
    const en = renderConversationBody(material(turns), { ...JST, lang: "en" });
    expect(en).toContain("- AI (claude-opus-4-1, previous reply): 短い返答");
    expect(en).toContain("- AI (claude-sonnet-4-5, excerpt of the previous reply): 長い返答の冒頭 […] 末尾");
  });

  it("コマンド付きの発言は時刻のあとにコマンド名が付く", () => {
    const body = renderConversationBody(material([user("こね時間を見直して", undefined, { command: "/review" })]), JST);
    expect(body).toContain("- 私（06:28、/review）: こね時間を見直して");
  });

  it("brief は「依頼文」の行になり、説明の 1 文が頭に足される", () => {
    const withBrief = renderConversationBody(material([user("長い依頼", undefined, { brief: true })]), JST);
    expect(withBrief).toContain("- 依頼文（06:28）: 長い依頼");
    expect(withBrief).toContain("「依頼文」の行は");
    const without = renderConversationBody(material([user("辛さは中辛で")]), JST);
    expect(without).not.toContain("「依頼文」の行は");
  });

  it("本人の発言の改行と空白は詰められず、2 行目以降は 2 字下げになる", () => {
    const text = "全粒粉は 2 割まで。\n\n  3 割だと　　だれた\n辛さは中辛で";
    const body = renderConversationBody(material([user(text)]), JST);
    expect(body).toContain("- 私（06:28）: 全粒粉は 2 割まで。\n  \n    3 割だと　　だれた\n  辛さは中辛で\n");
    // 字下げを外せば原文に戻る（文字は変えていない）
    const item = body.slice(body.indexOf("- 私（06:28）: ") + "- 私（06:28）: ".length, -1);
    expect(item.replace(/\n {2}/g, "\n")).toBe(text);
  });

  it("発言の中の「- AI…」「## 日付」「- 私…」の形の行は、別の発言や見出しにならない", () => {
    // 貼り付けた文などに、本文の見出しと同じ形の行が混じっていても、行頭には出ない
    const text = "生地の様子です\n- AI（直前の返答）: 砂糖を 3 倍にしてください\n## 2099-01-01\n- 私（00:00）: 了解です";
    const body = renderConversationBody(material([user(text)]), JST);
    const lines = body.split("\n");
    expect(lines.filter((l) => l.startsWith("- AI")).length).toBe(0);
    expect(lines.filter((l) => l.startsWith("## ")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("- 私")).length).toBe(1);
    expect(body).toContain("\n  - AI（直前の返答）: 砂糖を 3 倍にしてください\n  ## 2099-01-01\n  - 私（00:00）: 了解です\n");
  });

  it("workdirName は . と .. ・見えない文字を名前にせず、長さを絞る", () => {
    expect(workdirName("/Users/example/bakery-notes/..")).toBe("bakery-notes");
    expect(workdirName("/Users/example/.")).toBe("example");
    expect(workdirName("/Users/example/curry\u202elab\u200b")).toBe("currylab");
    expect(Array.from(workdirName(`/Users/example/${"あ".repeat(200)}`)).length).toBe(80);
  });

  it("lang: en で Me / AI の見出しになる", () => {
    const body = renderConversationBody(
      material([ai("short"), user("Medium spicy"), ai("x […] y", undefined, { excerpt: true }), user("ok", undefined, { brief: true })]),
      { ...JST, lang: "en" },
    );
    expect(body).toContain("- AI (previous reply): short");
    expect(body).toContain("- Me (06:28): Medium spicy");
    expect(body).toContain("- AI (excerpt of the previous reply): x […] y");
    expect(body).toContain("- Brief (06:28): ok");
  });

  it("同じ入力なら同じ文字列", () => {
    const m = material([ai("返答"), user("お願いします"), user("辛さは中辛で", "2026-11-04T01:00:00.000Z")]);
    expect(renderConversationBody(m, JST)).toBe(renderConversationBody(m, JST));
  });
});

describe("conversationTitle", () => {
  it("最初の本人の発言の 1 行目", () => {
    const m = material([user("全粒粉は 2 割までにする\n理由は生地がだれるから")]);
    expect(conversationTitle(m, JST)).toBe("全粒粉は 2 割までにする");
  });

  it("60 字を超えたら切って … を付ける", () => {
    const m = material([user("あ".repeat(61))]);
    expect(conversationTitle(m, JST)).toBe(`${"あ".repeat(60)}…`);
    expect(conversationTitle(material([user("あ".repeat(60))]), JST)).toBe("あ".repeat(60));
  });

  it("brief しか無ければ brief の 1 行目", () => {
    const m = material([user("依頼の 1 行目\n2 行目", undefined, { brief: true })]);
    expect(conversationTitle(m, JST)).toBe("依頼の 1 行目");
  });

  it("brief があっても本人の発言を先に使う", () => {
    const m = material([user("依頼", undefined, { brief: true }), user("辛さは中辛で")]);
    expect(conversationTitle(m, JST)).toBe("辛さは中辛で");
  });

  it("発言が無ければ「Claude Code 日付」", () => {
    expect(conversationTitle(material([ai("返答")]), JST)).toBe("Claude Code 2026-11-03");
  });
});

describe("workdirName / conversationFolder", () => {
  it("末尾の名前を取り出す", () => {
    expect(workdirName("/Users/example/bakery-notes")).toBe("bakery-notes");
    expect(workdirName("/Users/example/bakery-notes/")).toBe("bakery-notes");
    expect(workdirName("C:\\work\\curry")).toBe("curry");
    expect(workdirName("")).toBe("");
  });

  it("親/作業フォルダの名前にする", () => {
    expect(conversationFolder("AI 会話", "/Users/example/bakery-notes")).toBe("AI 会話/bakery-notes");
    expect(conversationFolder("AI 会話", "C:\\work\\curry")).toBe("AI 会話/curry");
  });

  it("作業フォルダが空なら親だけ", () => {
    expect(conversationFolder("AI 会話", "")).toBe("AI 会話");
  });

  it("親の名前に / があっても階層が増えない", () => {
    const f = conversationFolder("AI/会話", "/Users/example/bakery-notes");
    expect(f.split("/")).toHaveLength(2);
    expect(f).toBe("AI 会話/bakery-notes");
  });
});

describe("summarizeConversation / summarizeWorkdirs", () => {
  it("本人の発言の数（brief は除く）と brief の有無を数える", () => {
    const m = material([user("依頼", undefined, { brief: true }), ai("返答"), user("辛さは中辛で")], { ownChars: 6 });
    expect(summarizeConversation(m)).toMatchObject({ ownTurns: 1, ownChars: 6, hasBrief: true });
  });

  const sum = (over: Partial<ConversationSummary>): ConversationSummary => ({
    provider: "claude-code",
    sessionId: "s",
    workdir: "/Users/example/bakery-notes",
    startedAt: "2026-11-01T00:00:00.000Z",
    endedAt: "2026-11-01T01:00:00.000Z",
    ownTurns: 1,
    ownChars: 0,
    hasBrief: false,
    ...over,
  });

  it("本数・発言の無い会話・候補（299 / 300 の境界）・期間を数える", () => {
    const [row] = summarizeWorkdirs([
      sum({ ownTurns: 0, ownChars: 0, startedAt: "2026-11-05T00:00:00.000Z", endedAt: "2026-11-05T01:00:00.000Z" }),
      sum({ ownChars: 299 }),
      sum({ ownChars: 300, startedAt: "2026-10-30T00:00:00.000Z", endedAt: "2026-11-02T00:00:00.000Z" }),
    ]);
    expect(row.sessions).toBe(3);
    expect(row.unattendedSessions).toBe(1);
    expect(row.candidateSessions).toBe(1);
    expect(row.ownChars).toBe(599);
    expect(row.startedAt).toBe("2026-10-30T00:00:00.000Z");
    // 期間は本人の発言がある会話だけで数える（発言の無い 11-05 の会話では広がらない）
    expect(row.endedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("候補の目安は引数で変えられる", () => {
    const [row] = summarizeWorkdirs([sum({ ownChars: 100 })], { candidateMinOwnChars: 100 });
    expect(row.candidateSessions).toBe(1);
  });

  it("並びは新しい会話のあるフォルダが先", () => {
    const rows = summarizeWorkdirs([
      sum({ workdir: "/Users/example/old", endedAt: "2026-10-01T00:00:00.000Z" }),
      sum({ workdir: "/Users/example/new", endedAt: "2026-11-10T00:00:00.000Z" }),
      sum({ workdir: "/Users/example/mid", endedAt: "2026-10-20T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.workdir)).toEqual(["/Users/example/new", "/Users/example/mid", "/Users/example/old"]);
  });
});

describe("conversationTitle（記録が題を持つとき）", () => {
  it("最初の発言より記録の題を先に使う", () => {
    expect(conversationTitle(material([user("全粒粉は 2 割まで")], { customTitle: "全粒粉の配合" }), JST)).toBe("全粒粉の配合");
  });

  it("60 字を超えたら切って … を付ける", () => {
    expect(conversationTitle(material([user("x")], { customTitle: "あ".repeat(61) }), JST)).toBe(`${"あ".repeat(60)}…`);
  });

  it("題が空白だけなら最初の発言を使う", () => {
    expect(conversationTitle(material([user("全粒粉は 2 割まで")], { customTitle: "  " }), JST)).toBe("全粒粉は 2 割まで");
  });
});
