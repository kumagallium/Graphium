import { describe, expect, it } from "vitest";
import {
  FRAME_SOURCE_MAX_CHARS,
  buildFrameBackfillSystemPrompt,
  buildFrameBackfillUserMessage,
  parseFrameBackfillOutput,
  truncateSources,
  type FrameBackfillClaim,
} from "./frame-backfill.js";

const SRC =
  "ボールミル粉砕は κ_lat を下げるが Cu 空孔経由で S も下げる。粉砕時間は 2 時間に決めた。試料 A の κ_lat は 1.2 W/mK だった。";

const claim = (over: Partial<FrameBackfillClaim> & { id: string }): FrameBackfillClaim => ({
  title: "t",
  body: "b",
  siblingTitles: [],
  ...over,
});

const wrap = (frames: unknown[]) => "```json\n" + JSON.stringify({ frames }) + "\n```";

describe("truncateSources", () => {
  it("上限以下はそのまま、超えた出典は切って id を返す", () => {
    const long = "あ".repeat(FRAME_SOURCE_MAX_CHARS + 10);
    const r = truncateSources([
      { id: "a", title: "A", content: "short" },
      { id: "b", title: "B", content: long },
    ]);
    expect(r.truncatedSources).toEqual(["b"]);
    expect(r.sources[0].content).toBe("short");
    expect(r.sources[1].content.length).toBe(FRAME_SOURCE_MAX_CHARS);
  });
});

describe("prompt", () => {
  it("system prompt に Do NOT invent が含まれる", () => {
    expect(buildFrameBackfillSystemPrompt()).toContain("Do NOT invent");
  });
  it("user message に出典と claim が入る", () => {
    const m = buildFrameBackfillUserMessage(
      [{ id: "s1", title: "S", content: "本文" }],
      [claim({ id: "c1", claimRole: ["decision"], siblingTitles: [{ title: "兄弟", id: "c2" }] })],
    );
    expect(m).toContain("## Sources");
    expect(m).toContain("id: s1");
    expect(m).toContain("## Claims");
    expect(m).toContain("claimRole: decision");
    expect(m).toContain("- 兄弟");
  });
});

describe("parseFrameBackfillOutput", () => {
  it("判断・規則・観察を 1 件ずつ残す", () => {
    const claims = [
      claim({ id: "d", claimRole: ["decision"] }),
      claim({ id: "r" }),
      claim({ id: "o", epistemicStatus: "observation" }),
    ];
    const out = wrap([
      { id: "d", decisionFrame: { triggerTitles: [], action: "粉砕時間は 2 時間に決めた", rationale: null } },
      {
        id: "r",
        statementForm: "general",
        ruleFrame: {
          conditions: [{ item: "ボールミル粉砕", comparator: "present", span: "ボールミル粉砕は κ_lat を下げる" }],
          consequences: [{ item: "κ_lat", comparator: "decreases", span: "ボールミル粉砕は κ_lat を下げる" }],
        },
      },
      {
        id: "o",
        statementForm: "instance",
        observationFrame: {
          featureOfInterest: "試料 A",
          results: [{ item: "κ_lat", value: 1.2, unit: "W/mK", span: "試料 A の κ_lat は 1.2 W/mK だった" }],
        },
      },
    ]);
    const r = parseFrameBackfillOutput(out, claims, [SRC]);
    expect(r.frames).toHaveLength(3);
    expect(r.frames[0].decisionFrame?.action).toBe("粉砕時間は 2 時間に決めた");
    expect(r.frames[1].ruleFrame?.conditions).toHaveLength(1);
    expect(r.frames[2].observationFrame?.featureOfInterest).toBe("試料 A");
    expect(r.droppedFrames).toBe(0);
  });

  it("捏造された rationale は null になり dropped に数える", () => {
    const r = parseFrameBackfillOutput(
      wrap([
        {
          id: "d",
          decisionFrame: {
            triggerTitles: [],
            action: "粉砕時間は 2 時間に決めた",
            rationale: "原文に無い理由がここに書かれている",
          },
        },
      ]),
      [claim({ id: "d", claimRole: ["decision"] })],
      [SRC],
    );
    expect(r.frames[0].decisionFrame?.rationale).toBeNull();
    expect(r.droppedFrames).toBe(1);
  });

  it("request に無い id は捨てる", () => {
    const r = parseFrameBackfillOutput(
      wrap([{ id: "zzz", decisionFrame: { triggerTitles: [], action: "粉砕時間は 2 時間に決めた", rationale: null } }]),
      [claim({ id: "d", claimRole: ["decision"] })],
      [SRC],
    );
    expect(r.frames).toHaveLength(0);
  });

  it("droppedFrames を合算する", () => {
    const r = parseFrameBackfillOutput(
      wrap([
        { id: "a", decisionFrame: { triggerTitles: [], action: "存在しない引用文字列です", rationale: null } },
        { id: "b", statementForm: "general", ruleFrame: { conditions: [{ item: "x", span: "存在しない span です" }], consequences: [] } },
      ]),
      [claim({ id: "a", claimRole: ["decision"] }), claim({ id: "b" })],
      [SRC],
    );
    expect(r.droppedFrames).toBe(2);
    expect(r.frames.every((f) => !f.decisionFrame && !f.ruleFrame)).toBe(true);
  });

  it("壊れた JSON は空を返す", () => {
    expect(parseFrameBackfillOutput("not json", [claim({ id: "a" })], [SRC])).toEqual({
      frames: [],
      droppedFrames: 0,
    });
  });
});
