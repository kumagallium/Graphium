import { describe, it, expect } from "vitest";
import { parseConversationBody } from "./conversation-body";

const BODY = [
  "この資料は、私（利用者）と AI（Claude Code）の会話の記録である。",
  "「私」の行は本人の発言の原文である。",
  "",
  "## 2026-10-05",
  "",
  "- AI（直前の返答の抜粋）: ライ麦サワー種は温度に敏感です",
  "- 私（09:12）: 酸味は控えめにしたいので、6 時間で止めます",
  "  生地は 24 度で置きます",
  "",
  "  最後の確認です",
  "- 依頼文（09:00）: カレーの煮込み時間を決めたい",
  "",
  "## 2026-10-06",
  "",
  "- 私（09:20、/review）: 焼き時間を見直して",
].join("\n");

describe("parseConversationBody", () => {
  it("説明・日付・発言に分ける", () => {
    const b = parseConversationBody(BODY);
    expect(b.map((x) => x.kind)).toEqual(["lead", "date", "turn", "turn", "turn", "date", "turn"]);
    expect(b[0]).toEqual({
      kind: "lead",
      text: "この資料は、私（利用者）と AI（Claude Code）の会話の記録である。\n「私」の行は本人の発言の原文である。",
    });
    expect(b[1]).toEqual({ kind: "date", text: "2026-10-05" });
  });

  it("AI の行と本人の側の行を見出しで分ける", () => {
    const t = parseConversationBody(BODY).filter((x) => x.kind === "turn");
    expect(t.map((x) => (x.kind === "turn" ? x.side : ""))).toEqual(["ai", "me", "me", "me"]);
    expect(t[0]).toMatchObject({ label: "AI（直前の返答の抜粋）", body: "ライ麦サワー種は温度に敏感です" });
    expect(t[3]).toMatchObject({ label: "私（09:20、/review）", body: "焼き時間を見直して" });
  });

  it("複数行の発言は 2 字下げを外すと原文に戻る（空行も保つ）", () => {
    const t = parseConversationBody(BODY).filter((x) => x.kind === "turn");
    expect(t[1]).toMatchObject({
      body: "酸味は控えめにしたいので、6 時間で止めます\n生地は 24 度で置きます\n\n最後の確認です",
    });
  });

  it("<script> や <img onerror> は文字のまま残る", () => {
    const evil = '## 2026-10-05\n\n- 私（09:12）: <script>alert(1)</script>\n  <img src=x onerror=alert(1)>';
    const t = parseConversationBody(evil).find((x) => x.kind === "turn");
    expect(t).toMatchObject({ body: "<script>alert(1)</script>\n<img src=x onerror=alert(1)>" });
  });

  it("壊れた形の行も本人の側として落とさない", () => {
    const b = parseConversationBody("## 2026-10-05\n\n- コロンの無い行\n- 私：全角コロン\nただの行");
    const t = b.filter((x) => x.kind === "turn");
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.kind === "turn" && x.side === "me")).toBe(true);
    expect(t[0]).toMatchObject({ label: "", body: "コロンの無い行" });
    expect(t[2]).toMatchObject({ body: "ただの行" });
  });

  it("英語の見出し", () => {
    const b = parseConversationBody(
      "Lead.\n\n## 2026-10-05\n\n- AI (previous reply): Rye sourdough\n- Me (09:12): Stop at 6 hours\n- Brief (09:00): Plan the curry",
    ).filter((x) => x.kind === "turn");
    expect(b.map((x) => (x.kind === "turn" ? x.side : ""))).toEqual(["ai", "me", "me"]);
  });

  it("説明の途中に空行が大量に並んでいても、時間が跳ね上がらない（線形）", () => {
    // 端の空行落としを正規表現でやると、途中の長い空行の並びで 2 乗の時間になる
    const body = `説明の 1 行目${"\n".repeat(80_000)}説明の 2 行目\n\n## 2026-10-05\n\n- 私（09:12）: 中辛で`;
    const t0 = performance.now();
    const blocks = parseConversationBody(body);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(blocks[0].kind).toBe("lead");
    expect(blocks[blocks.length - 1]).toEqual(expect.objectContaining({ kind: "turn", body: "中辛で" }));
  });

  it("説明だけ・空の本文でも落ちない", () => {
    expect(parseConversationBody("説明だけ")).toEqual([{ kind: "lead", text: "説明だけ" }]);
    expect(parseConversationBody("")).toEqual([]);
  });
});
