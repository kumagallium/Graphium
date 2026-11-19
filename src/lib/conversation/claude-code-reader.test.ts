import { describe, it, expect } from "vitest";
import { excerptAssistantText, readClaudeCodeSession } from "./claude-code-reader";

const SID = "11111111-2222-4333-8444-555555555555";
const CWD = "/Users/example/bakery-notes";

let seq = 0;

type LineOpts = {
  content?: unknown;
  at?: string;
  uuid?: string | null;
  cwd?: string;
  sessionId?: string;
  extra?: Record<string, unknown>;
};

/** 本人の発言の記録 1 行（既定は origin: human） */
function userLine(o: LineOpts = {}): string {
  const rec: Record<string, unknown> = {
    type: "user",
    uuid: o.uuid === null ? undefined : (o.uuid ?? `u-${++seq}`),
    sessionId: o.sessionId ?? SID,
    cwd: o.cwd ?? CWD,
    timestamp: o.at ?? "2026-11-03T00:00:00.000Z",
    origin: { kind: "human" },
    message: { role: "user", content: o.content ?? "お願いします" },
    ...(o.extra ?? {}),
  };
  return JSON.stringify(rec);
}

/** AI の返答の記録 1 行 */
function assistantLine(o: LineOpts = {}): string {
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: o.uuid === null ? undefined : (o.uuid ?? `a-${++seq}`),
    sessionId: o.sessionId ?? SID,
    cwd: o.cwd ?? CWD,
    timestamp: o.at ?? "2026-11-03T00:00:01.000Z",
    message: { role: "assistant", content: o.content ?? "了解です" },
    ...(o.extra ?? {}),
  };
  return JSON.stringify(rec);
}

const read = (lines: string[], opts: { includeAssistant?: boolean } = {}) =>
  readClaudeCodeSession(lines, { sessionId: SID, ...opts });

const userTexts = (lines: string[]) =>
  (read(lines)?.turns ?? []).filter((t) => t.speaker === "user").map((t) => t.text);

describe("本人の発言", () => {
  it("原文のまま入る（改行・連続した空白・全角空白が一字も変わらない）", () => {
    const text = "全粒粉は 2 割までにする。\n\n  3 割だと　　生地がだれたので\n\t辛さは中辛で  ";
    const m = read([userLine({ content: text })]);
    // 前後の空白だけは trim される仕様。中身は一字も変わらない
    expect(m?.turns).toHaveLength(1);
    expect(m?.turns[0].text).toBe(text.trim());
    expect(m?.turns[0].text).toContain("\n\n  3 割だと　　生地");
  });

  it("content が配列でも読める", () => {
    expect(userTexts([userLine({ content: [{ type: "text", text: "辛さは中辛で" }] })])).toEqual(["辛さは中辛で"]);
  });

  it("文字と画像が混じる配列は文字だけを取る", () => {
    const content = [
      { type: "text", text: "この焼き色で合ってる？" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ];
    expect(userTexts([userLine({ content })])).toEqual(["この焼き色で合ってる？"]);
  });

  it.each(["isMeta", "isCompactSummary", "isSidechain"])("%s が立った記録は入らない", (flag) => {
    const lines = [userLine({ content: "入らない文", extra: { [flag]: true } }), userLine({ content: "入る文" })];
    const texts = userTexts(lines);
    expect(texts).toEqual(["入る文"]);
  });

  it("content に tool_result を含む記録は入らない", () => {
    const content = [{ type: "tool_result", tool_use_id: "t1", content: "出力" }];
    expect(userTexts([userLine({ content }), userLine({ content: "入る文" })])).toEqual(["入る文"]);
  });

  it("トップレベルに toolUseResult を持つ行は入らない", () => {
    const l = userLine({ content: "入らない文", extra: { toolUseResult: { stdout: "x" } } });
    expect(userTexts([l, userLine({ content: "入る文" })])).toEqual(["入る文"]);
  });

  it.each([
    ["短い", "完了しました"],
    ["長い", "完了しました。".repeat(300)],
  ])("origin.kind が task-notification の記録は入らない（%s）", (_l, text) => {
    const l = userLine({ content: text, extra: { origin: { kind: "task-notification" } } });
    expect(userTexts([l, userLine({ content: "入る文" })])).toEqual(["入る文"]);
  });

  it("「Caveat:」で始まっていても、機械の定型文でなければ本人の発言として入る", () => {
    const m = readClaudeCodeSession([userLine({ content: "Caveat: 酵母が足りないかもしれない" })], { sessionId: SID });
    expect(m?.turns.map((t) => t.text)).toEqual(["Caveat: 酵母が足りないかもしれない"]);
  });

  it("HTML のタグで始まる本人の発言は、閉じタグがあっても入る（機械の包みと取り違えない）", () => {
    const text = "<p>焼き色が薄い</p> のときの直し方を教えて";
    const m = readClaudeCodeSession([userLine({ content: text })], { sessionId: SID });
    expect(m?.turns.map((t) => t.text)).toEqual([text]);
  });

  it("頭の機械の包みは取り除き、あとに続く本人の文を残す", () => {
    const m = readClaudeCodeSession(
      [userLine({ content: "<artifact-view-context>窯の温度の表</artifact-view-context>\n\n230℃ の行を直して" })],
      { sessionId: SID },
    );
    expect(m?.turns.map((t) => t.text)).toEqual(["230℃ の行を直して"]);
  });

  it("機械の包みが続くだけの記録は入らない", () => {
    const m = readClaudeCodeSession(
      [userLine({ content: "<bash-input>ls</bash-input>\n<bash-stdout>dough.md</bash-stdout>" })],
      { sessionId: SID },
    );
    expect(m?.turns).toEqual([]);
  });

  it("コマンド名が先に来る形（AI に送られないローカルコマンド）は、引数があっても入らない", () => {
    const m = readClaudeCodeSession(
      [
        userLine({
          content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>small</command-args>",
        }),
      ],
      { sessionId: SID },
    );
    expect(m?.turns).toEqual([]);
  });

  it("時刻は ISO 8601 にそろえ、日付の形で始まらない値は使わない", () => {
    const m = readClaudeCodeSession(
      [
        userLine({ content: "辛さは中辛で", at: "Jan 1 2020 (<b>x</b>)" }),
        userLine({ content: "ご飯は少なめで", at: "2026-11-03T09:00:00+09:00" }),
      ],
      { sessionId: SID },
    );
    expect(m?.turns.map((t) => t.at)).toEqual(["", "2026-11-03T00:00:00.000Z"]);
    expect(m?.startedAt).toBe("2026-11-03T00:00:00.000Z");
  });

  it("origin が無い記録は、機械の書き出しでなければ入る", () => {
    const l = userLine({ content: "辛さは中辛で", extra: { origin: undefined } });
    expect(userTexts([l])).toEqual(["辛さは中辛で"]);
  });
});

describe("機械が差し込んだ区間", () => {
  it("system-reminder と pasted_content の中は取り除き、外側の本人の文は残す", () => {
    const content =
      '焼き時間を見直して<system-reminder>内部の注意書き</system-reminder>\n<pasted_content id="x">貼った表の中身</pasted_content>お願いします';
    const t = userTexts([userLine({ content })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toContain("焼き時間を見直して");
    expect(t[0]).toContain("お願いします");
    expect(t[0]).not.toContain("内部の注意書き");
    expect(t[0]).not.toContain("貼った表の中身");
  });

  it("全部が取り除かれて空になったら入らない", () => {
    const content = "<system-reminder>注意書きだけ</system-reminder>";
    expect(userTexts([userLine({ content })])).toEqual([]);
  });

  it("閉じていない system-reminder はそのまま残る", () => {
    const content = "<system-reminder>閉じ忘れの文 辛さは中辛で";
    expect(userTexts([userLine({ content })])).toEqual([content]);
  });

  it.each([
    "[Request interrupted by user]",
    "This session is being continued from a previous conversation.",
    "Caveat: The messages below were generated by the user while running local commands.",
    "Background (from the session on the oven)",
  ])("機械の書き出し（%s）で始まるものは入らない", (content) => {
    expect(userTexts([userLine({ content })])).toEqual([]);
  });

  it("閉じタグのある包みは入らない", () => {
    expect(userTexts([userLine({ content: "<local-command-stdout>ok</local-command-stdout>" })])).toEqual([]);
  });

  it("閉じタグの無い文は入る", () => {
    expect(userTexts([userLine({ content: "<div> が崩れる" })])).toEqual(["<div> が崩れる"]);
  });
});

describe("スラッシュコマンド", () => {
  const cmd = (args: string) =>
    `<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>${args}</command-args>`;

  it("text が引数、command が /review になる", () => {
    const m = read([userLine({ content: cmd("こね時間を見直して") })]);
    expect(m?.turns).toHaveLength(1);
    expect(m?.turns[0]).toMatchObject({ speaker: "user", text: "こね時間を見直して", command: "/review" });
  });

  it("引数が空なら入らない", () => {
    expect(userTexts([userLine({ content: cmd("") })])).toEqual([]);
  });
});

describe("会話の最初の長い発言（brief）", () => {
  it("最初の発言が 701 字なら brief が付き、ownChars に数えない", () => {
    const m = read([userLine({ content: "あ".repeat(701) }), userLine({ content: "辛さは中辛で" })]);
    expect(m?.turns[0].brief).toBe(true);
    expect(m?.turns[1].brief).toBeUndefined();
    expect(m?.ownChars).toBe("辛さは中辛で".length);
  });

  it("最初の発言が 700 字ちょうどなら brief は付かない", () => {
    const m = read([userLine({ content: "あ".repeat(700) })]);
    expect(m?.turns[0].brief).toBeUndefined();
    expect(m?.ownChars).toBe(700);
  });

  it("2 つ目以降の発言は 2,000 字でも brief にならず、全文が入り、ownChars に数える（700 字で一律に捨てない）", () => {
    const long = "い".repeat(2000);
    const m = read([userLine({ content: "お願いします" }), userLine({ content: long })]);
    expect(m?.turns[1].brief).toBeUndefined();
    expect(m?.turns[1].text).toBe(long);
    expect(m?.ownChars).toBe("お願いします".length + 2000);
  });
});

describe("AI の返答", () => {
  it("直前の返答（最後の 1 件）だけが、本人の発言の前に入る", () => {
    const m = read([
      userLine({ content: "全粒粉は 2 割までにする" }),
      assistantLine({ content: "一つ目の返答" }),
      assistantLine({ content: "二つ目の返答" }),
      userLine({ content: "お願いします" }),
    ]);
    expect(m?.turns.map((t) => [t.speaker, t.text])).toEqual([
      ["user", "全粒粉は 2 割までにする"],
      ["assistant", "二つ目の返答"],
      ["user", "お願いします"],
    ]);
  });

  it("520 字以下は全文で excerpt が付かない", () => {
    const text = "あ".repeat(520);
    const m = read([assistantLine({ content: text }), userLine()]);
    expect(m?.turns[0]).toMatchObject({ speaker: "assistant", text });
    expect(m?.turns[0].excerpt).toBeUndefined();
  });

  it("521 字以上は冒頭 200 字 + 省略の印 + 末尾 300 字で excerpt: true", () => {
    const text = "あ".repeat(250) + "い".repeat(271);
    expect(text).toHaveLength(521);
    const m = read([assistantLine({ content: text }), userLine()]);
    expect(m?.turns[0].excerpt).toBe(true);
    expect(m?.turns[0].text).toBe(`${text.slice(0, 200)} […] ${text.slice(-300)}`);
  });

  it("空白・改行は 1 つの空白に詰まる", () => {
    const m = read([assistantLine({ content: "焼き色は\n\n  薄め\t です" }), userLine()]);
    expect(m?.turns[0].text).toBe("焼き色は 薄め です");
  });

  it("tool_use / thinking のブロックは入らない", () => {
    const content = [
      { type: "thinking", thinking: "内心の考え" },
      { type: "tool_use", id: "t1", name: "Read", input: { path: "x" } },
      { type: "text", text: "見てみます" },
    ];
    const m = read([assistantLine({ content }), userLine()]);
    expect(m?.turns[0].text).toBe("見てみます");
  });

  it("最後の本人の発言より後ろの AI の返答は入らない", () => {
    const m = read([userLine({ content: "お願いします" }), assistantLine({ content: "末尾の返答" })]);
    expect(m?.turns).toHaveLength(1);
    expect(m?.turns[0].speaker).toBe("user");
  });

  it("includeAssistant: false では AI の行が入らず、本人の発言と ownChars は同じ", () => {
    const lines = [
      userLine({ content: "全粒粉は 2 割までにする" }),
      assistantLine({ content: "返答" }),
      userLine({ content: "お願いします" }),
    ];
    const withAi = read(lines);
    const without = read(lines, { includeAssistant: false });
    expect(without?.turns.every((t) => t.speaker === "user")).toBe(true);
    expect(without?.turns.map((t) => t.text)).toEqual(withAi?.turns.filter((t) => t.speaker === "user").map((t) => t.text));
    expect(without?.ownChars).toBe(withAi?.ownChars);
  });
});

describe("excerptAssistantText の絵文字", () => {
  const BROKEN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("冒頭の切れ目にサロゲートペアが来ても孤立サロゲートを作らない", () => {
    // 199 字のあとに絵文字（200・201 字目）が来る
    const text = "あ".repeat(199) + "🍞" + "い".repeat(400);
    const r = excerptAssistantText(text);
    expect(r.excerpt).toBe(true);
    expect(BROKEN.test(r.text)).toBe(false);
  });

  it("末尾の切れ目にサロゲートペアが来ても孤立サロゲートを作らない", () => {
    // 末尾 300 字の先頭が絵文字の後ろ半分になる位置
    const text = "あ".repeat(400) + "🍛" + "い".repeat(299);
    const r = excerptAssistantText(text);
    expect(r.excerpt).toBe(true);
    expect(BROKEN.test(r.text)).toBe(false);
  });
});

describe("行の扱い", () => {
  it("同じ uuid の行が 2 回あっても 1 回だけ入る", () => {
    const l = userLine({ content: "辛さは中辛で", uuid: "dup-1" });
    expect(userTexts([l, l])).toEqual(["辛さは中辛で"]);
  });

  it("壊れた JSON・空行・{ で始まらない行・type が別の行は飛ばす", () => {
    const lines = [
      '{"type":"user","message":',
      "",
      "plain text",
      "  " + userLine({ content: "先頭が空白の行" }),
      JSON.stringify({ type: "summary", summary: "要約" }),
      userLine({ content: "辛さは中辛で" }),
    ];
    expect(userTexts(lines)).toEqual(["辛さは中辛で"]);
  });
});

describe("sessionId・作業フォルダ・時刻", () => {
  it("渡した sessionId が優先される", () => {
    const m = readClaudeCodeSession([userLine({ sessionId: "from-record" })], { sessionId: "from-option" });
    expect(m?.sessionId).toBe("from-option");
  });

  it("渡さなければ記録の中の sessionId を使う", () => {
    expect(readClaudeCodeSession([userLine({ sessionId: "from-record" })])?.sessionId).toBe("from-record");
  });

  it("形が不正な sessionId なら null", () => {
    expect(readClaudeCodeSession([userLine()], { sessionId: "a/b" })).toBeNull();
  });

  it("本筋の記録が 1 つも無い（全部 isSidechain）なら null", () => {
    const l = userLine({ extra: { isSidechain: true } });
    expect(read([l, l.replace(/"uuid":"[^"]*"/, '"uuid":"other"')])).toBeNull();
  });

  it("workdir から、向きを変える文字・見えない文字を落とす", () => {
    const m = read([userLine({ content: "中辛で", cwd: "/Users/example/curry\u202elab\u200b/\u2066notes" })]);
    expect(m?.workdir).toBe("/Users/example/currylab/notes");
  });

  it("workdir は最初の記録の cwd", () => {
    const m = read([
      userLine({ cwd: "/Users/example/bakery-notes" }),
      userLine({ cwd: "/Users/example/curry-lab" }),
    ]);
    expect(m?.workdir).toBe("/Users/example/bakery-notes");
  });

  it("startedAt / endedAt は時刻の最小・最大（行の順が前後していても）", () => {
    const m = read([
      userLine({ at: "2026-11-03T05:00:00.000Z" }),
      userLine({ at: "2026-11-03T01:00:00.000Z" }),
      userLine({ at: "2026-11-03T09:00:00.000Z" }),
      userLine({ at: "2026-11-03T03:00:00.000Z" }),
    ]);
    expect(m?.startedAt).toBe("2026-11-03T01:00:00.000Z");
    expect(m?.endedAt).toBe("2026-11-03T09:00:00.000Z");
  });
});

describe("会話の題（custom-title の行）", () => {
  const titleLine = (customTitle: unknown) => JSON.stringify({ type: "custom-title", customTitle, sessionId: SID });

  it("題を読み、複数あれば最後のものを使う", () => {
    const m = read([titleLine("最初の題"), userLine({ content: "生地を見直したい" }), titleLine("全粒粉の配合の見直し")]);
    expect(m?.customTitle).toBe("全粒粉の配合の見直し");
  });

  it("題の行が無ければ customTitle を持たない", () => {
    expect(read([userLine()])).not.toHaveProperty("customTitle");
  });

  it("空の題や文字列でない題では、前の題を消さない", () => {
    const m = read([titleLine("カレーの辛さ"), titleLine("   "), titleLine(42), userLine()]);
    expect(m?.customTitle).toBe("カレーの辛さ");
  });

  it("改行は空白にし、向きを変える文字・見えない文字を落とす", () => {
    expect(read([titleLine("中辛の\n配合‮​メモ"), userLine()])?.customTitle).toBe("中辛の 配合メモ");
  });

  it("画面に出ないタグ文字・異体字セレクタも落とす", () => {
    expect(read([titleLine("中辛\u{e0041}\u{e0042}の\ufe0f配合"), userLine()])?.customTitle).toBe("中辛の配合");
  });

  it("題の行だけの記録は会話にならない", () => {
    expect(read([titleLine("題だけ")])).toBeNull();
  });

  it("発言の中に同じ文字があっても題にならず、発言として残る", () => {
    const text = '記録の "custom-title" の行を見て';
    const m = read([userLine({ content: text })]);
    expect(m?.customTitle).toBeUndefined();
    expect(m?.turns[0].text).toBe(text);
  });
});

describe("この会話で作ったノート（createdNoteIds）", () => {
  const N1 = "aaaaaaaa-1111-4222-8333-444444444441";
  const N2 = "bbbbbbbb-1111-4222-8333-444444444442";
  const FAKE = "ffffffff-1111-4222-8333-444444444449";
  const TOOL = "mcp__graphium__create_note";

  /** create_note の結果の文（タイトル → noteId →（フォルダ）→ ファイル の順） */
  const okText = (id: string, title = "パンの発酵は 6 時間で止める", folder?: string) =>
    [`ノートを作成しました`, `タイトル: ${title}`, `noteId: ${id}`, ...(folder ? [`フォルダ: ${folder}`] : []), `ファイル: /Users/example/Graphium/notes/${id}.json`].join("\n");

  const toolUse = (id: string, name: string) =>
    assistantLine({ content: [{ type: "tool_use", id, name, input: { title: "パンの発酵" } }] });
  const toolResult = (id: string, content: unknown, isError = false) =>
    userLine({
      content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }],
      extra: { toolUseResult: "x" },
    });
  const created = (name: string, text: unknown, isError = false) =>
    read([userLine({ content: "ノートにして" }), toolUse("t1", name), toolResult("t1", text, isError)]);

  it("create_note の結果の文から noteId を取る（文字列でも text の配列でも）", () => {
    const m = read([
      userLine({ content: "発酵の結論をノートにして" }),
      toolUse("t1", TOOL),
      toolResult("t1", okText(N1)),
      toolUse("t2", TOOL),
      toolResult("t2", [{ type: "text", text: okText(N2) }]),
    ]);
    expect(m?.createdNoteIds).toEqual([N1, N2]);
  });

  it("エラーの結果は取らない", () => {
    const m = created(TOOL, okText(N1), true);
    expect(m).not.toBeNull();
    expect("createdNoteIds" in (m ?? {})).toBe(false);
  });

  it("get_note など、ほかの道具の出力にある noteId は取らない", () => {
    const m = read([
      userLine({ content: "さっきのノートを見て" }),
      toolUse("t1", "mcp__graphium__get_note"),
      toolResult("t1", okText(N1)),
      toolUse("t2", TOOL),
      toolResult("t2", okText(N2)),
    ]);
    expect(m?.createdNoteIds).toEqual([N2]);
  });

  it("道具の名前は mcp__graphium__create_note と plugin 形式だけ", () => {
    expect(created("mcp__plugin_graphium_graphium__create_note", okText(N1))?.createdNoteIds).toEqual([N1]);
    expect("createdNoteIds" in (created("mcp__other__graphium_create_note", okText(N1)) ?? {})).toBe(false);
    expect("createdNoteIds" in (created("xgraphium__create_note", okText(N1)) ?? {})).toBe(false);
    expect("createdNoteIds" in (created("mcp__graphium__create_note_draft", okText(N1)) ?? {})).toBe(false);
  });

  it("同じ noteId は 1 つにし、出てきた順に並べる", () => {
    const m = read([
      userLine({ content: "ノートにして" }),
      toolUse("t1", TOOL),
      toolResult("t1", okText(N2)),
      toolUse("t2", TOOL),
      toolResult("t2", okText(N1)),
      toolUse("t3", TOOL),
      toolResult("t3", okText(N2)),
    ]);
    expect(m?.createdNoteIds).toEqual([N2, N1]);
  });

  it("題に noteId の行を入れても、偽の id は採らず本物を採る", () => {
    expect(created(TOOL, okText(N1, `カレー\nnoteId: ${FAKE}`))?.createdNoteIds).toEqual([N1]);
  });

  it("題に改行と「ファイル:」の行を入れても、偽の id は採らず本物を採る", () => {
    const title = `カレー\nnoteId: ${FAKE}\nファイル: /x/notes/${FAKE}.json`;
    expect(created(TOOL, okText(N1, title))?.createdNoteIds).toEqual([N1]);
  });

  it("フォルダ名に同じものを入れても、偽の id は採らず本物を採る", () => {
    const folder = `パン\nnoteId: ${FAKE}\nファイル: C:\\x\\notes\\${FAKE}.json`;
    expect(created(TOOL, okText(N1, "発酵", folder))?.createdNoteIds).toEqual([N1]);
  });

  it("noteId の行かファイルの行のどちらかが無ければ採らない", () => {
    const noFile = `タイトル: カレー\nnoteId: ${N1}`;
    const noId = `タイトル: カレー\nファイル: /x/notes/${N1}.json`;
    const mismatch = `タイトル: カレー\nnoteId: ${FAKE}\nファイル: /x/notes/${N1}.json`;
    for (const text of [noFile, noId, mismatch]) {
      expect("createdNoteIds" in (created(TOOL, text) ?? {})).toBe(false);
    }
  });

  it("道具の出力は本文（発言・返答）に入れない", () => {
    const m = read([
      userLine({ content: "発酵の結論をノートにして" }),
      toolUse("t1", TOOL),
      toolResult("t1", okText(N1, "secret-body")),
      assistantLine({ content: "ノートにしました" }),
      userLine({ content: "ありがとう" }),
    ]);
    expect(JSON.stringify(m?.turns)).not.toContain(N1);
    expect(JSON.stringify(m?.turns)).not.toContain("secret-body");
  });

  it("create_note が無い会話はキーごと省く", () => {
    const m = read([userLine({ content: "こんにちは" }), assistantLine()]);
    expect(m).not.toBeNull();
    expect("createdNoteIds" in (m ?? {})).toBe(false);
  });
});
