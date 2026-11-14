// @vitest-environment jsdom
//
// 改訂で「今回読んでいない資料の文」が丸ごと消えたときの検出と 1 回だけの書き直し、
// References の「引用中を先に・引用していない資料に注記」を確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceBackedWikiDocument,
  citedSourceIds,
  droppedOtherSourceCitations,
  reviseTopicFromSource,
} from "./wiki-service";

const PREV = [
  "## 要点",
  "- 発酵は 65% の湿度で行った。[[source:old]]",
  "- 焼成は 230 度。[[source:keep]]",
].join("\n");

describe("citedSourceIds / droppedOtherSourceCitations", () => {
  it("引用の印が無ければ null（言い切れない）", () => {
    expect(citedSourceIds("ただの文。")).toBeNull();
    expect([...citedSourceIds(PREV)!]).toEqual(["old", "keep"]);
  });

  it("今回読んでいない資料の引用が消えたら、その資料と前の行を返す", () => {
    const next = "## 要点\n- 発酵は 70% の湿度で行った。[[source:new]]\n- 焼成は 230 度。[[source:keep]]";
    expect(droppedOtherSourceCitations(PREV, next, "new")).toEqual({
      sourceIds: ["old"],
      lines: ["- 発酵は 65% の湿度で行った。[[source:old]]"],
    });
  });

  it("今回読み直した資料の引用が消えるのは検出しない（取り込み直しで言わなくなった）", () => {
    const next = "## 要点\n- 焼成は 230 度。[[source:keep]]";
    expect(droppedOtherSourceCitations(PREV, next, "old").sourceIds).toEqual([]);
  });
});

describe("References: 引用中を先に、引用していない資料に注記", () => {
  it("本文で引用していない資料は後ろに回り、注記が付く", () => {
    const doc = buildSourceBackedWikiDocument(
      "topic",
      "パン",
      "## 要点\n- 焼成は 230 度。[[source:b]]",
      [{ id: "a", title: "古い記録" }, { id: "b", title: "焼成の記録" }],
      null,
      undefined,
      "ja",
    );
    const blocks = doc.pages[0].blocks as any[];
    const refIdx = blocks.findIndex((b) => b.type === "heading" && b.content?.[0]?.text === "References");
    const rows = blocks.slice(refIdx + 1).map((b) => (b.content as any[]).map((c) => c.text).join(""));
    expect(rows).toEqual(["@焼成の記録", "@古い記録（読んだ資料。今の本文では引用していない）"]);
    // 読んだ事実（PROV の元）は全件残す
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["a", "b"]);
  });
});

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("reviseTopicFromSource: 他の資料の文を消したら 1 回だけ書き直させる", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const SRC = { id: "new", title: "新しい試行", text: "70% だった" };
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const dropped = "## 要点\n- 発酵は 70% の湿度で行った。[[source:new]]\n- 焼成は 230 度。[[source:keep]]";
  const kept = `${dropped}\n- 発酵は 65% の湿度で行った。[[source:old]]\n\n## 食い違い・未解決\n- 湿度が 65% と 70% で違う。[[source:old]][[source:new]]`;

  it("消えた文を keepSentences で渡し、2 回目の本文を採る", async () => {
    fetchMock
      .mockImplementationOnce(async () => okResponse({ body: dropped }))
      .mockImplementationOnce(async () => okResponse({ body: kept }));
    const out = await reviseTopicFromSource("パン", PREV, SRC, "ja");
    expect(out).toBe(kept);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.keepSentences).toEqual(["- 発酵は 65% の湿度で行った。[[source:old]]"]);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(first.keepSentences).toBeUndefined();
  });

  it("書き直しが失敗したら 1 回目の本文を返し、onError は呼ばない", async () => {
    fetchMock
      .mockImplementationOnce(async () => okResponse({ body: dropped }))
      .mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }) as unknown as Response);
    const onError = vi.fn();
    const out = await reviseTopicFromSource("パン", PREV, SRC, "ja", undefined, undefined, undefined, undefined, undefined, onError);
    expect(out).toBe(dropped);
    expect(onError).not.toHaveBeenCalled();
  });

  it("消えていなければ 1 回で終わる", async () => {
    fetchMock.mockImplementationOnce(async () => okResponse({ body: kept }));
    expect(await reviseTopicFromSource("パン", PREV, SRC, "ja")).toBe(kept);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
